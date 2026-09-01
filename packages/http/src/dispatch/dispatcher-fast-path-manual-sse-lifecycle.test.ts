import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type {
  FrameworkRequest,
  FrameworkResponse,
  FrameworkResponseStream,
  RequestContext,
} from '../index.js';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  getDispatcherFastPathStats,
  Get,
  SseResponse,
} from '../index.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createRequest(signal: AbortSignal): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/events',
    query: {},
    raw: {},
    signal,
    url: '/events',
  };
}

function createResponse(stream: FrameworkResponseStream): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect() {},
    send() {
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
    stream,
  };
}

function createStream(): FrameworkResponseStream & { closeCalls: number } {
  let closed = false;

  return {
    close() {
      closed = true;
      this.closeCalls += 1;
    },
    closeCalls: 0,
    get closed() {
      return closed;
    },
    flush() {},
    onClose() {
      return () => {};
    },
    write() {
      return true;
    },
  };
}

describe('fast-path manual SSE lifecycle', () => {
  it.each([
    {
      close: (_abortController: AbortController, sse: SseResponse) => sse.close(),
      label: 'the manual SSE closes normally',
    },
    {
      close: (abortController: AbortController, _sse: SseResponse) => abortController.abort(new Error('client disconnected')),
      label: 'the client aborts after dispatcher waiting begins',
    },
  ])('keeps a delayed fast-path manual SSE pending until $label', async ({ close }) => {
    const abortController = new AbortController();
    const stream = createStream();
    const dispatcherWaiting = createDeferred<void>();
    const handlerReturned = createDeferred<SseResponse>();

    @Controller('/events')
    class FastManualSseController {
      @Get('/')
      stream(_input: undefined, context: RequestContext): SseResponse {
        const sse = new SseResponse(context);
        const completion = sse.completion;

        Object.defineProperty(sse, 'completion', {
          configurable: true,
          get() {
            dispatcherWaiting.resolve();
            return completion;
          },
        });

        handlerReturned.resolve(sse);
        return sse;
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastManualSseController }]),
      rootContainer: new Container().register(FastManualSseController),
    });
    const dispatch = dispatcher.dispatch(createRequest(abortController.signal), createResponse(stream));
    let dispatchCompleted = false;
    void dispatch.then(() => {
      dispatchCompleted = true;
    });

    const sse = await handlerReturned.promise;
    await dispatcherWaiting.promise;

    expect(getDispatcherFastPathStats(dispatcher)?.routes).toMatchObject([
      { executionPath: 'fast', routeId: 'GET:/events' },
    ]);
    expect(dispatchCompleted).toBe(false);

    close(abortController, sse);
    await dispatch;

    expect(dispatchCompleted).toBe(true);
    expect(stream.closeCalls).toBe(1);
  });
});
