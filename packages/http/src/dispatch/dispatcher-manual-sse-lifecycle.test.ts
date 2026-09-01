import { Container, Scope } from '@fluojs/di';
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
  Sse,
  SseResponse,
} from '../index.js';

interface ManualSseStream extends FrameworkResponseStream {
  closeCalls: number;
  removeCloseListenerCalls: number;
}

interface ManualSseFixture {
  readonly abortController: AbortController;
  readonly dispatch: Promise<void>;
  readonly events: string[];
  readonly sse: Promise<SseResponse>;
  readonly stream: ManualSseStream;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

interface CloseCase {
  readonly close: (fixture: ManualSseFixture) => Promise<void>;
  readonly events: readonly string[];
  readonly label: string;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

const CLOSE_CASES = [
  {
    async close(fixture: ManualSseFixture): Promise<void> {
      (await fixture.sse).close();
    },
    events: ['handler', 'success', 'finish', 'destroy'],
    label: 'the controller closes it normally',
  },
  {
    async close(fixture: ManualSseFixture): Promise<void> {
      fixture.abortController.abort(new Error('client disconnected'));
    },
    events: ['handler', 'finish', 'destroy'],
    label: 'the request aborts',
  },
  {
    async close(fixture: ManualSseFixture): Promise<void> {
      fixture.stream.close();
    },
    events: ['handler', 'success', 'finish', 'destroy'],
    label: 'the raw response stream closes',
  },
] as const satisfies readonly CloseCase[];

class RequestScopedDisposable {
  constructor(private readonly events: string[]) {}

  onDestroy(): void {
    this.events.push('destroy');
  }
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

function createResponse(stream: ManualSseStream): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
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

function createStream(closeError?: Error): ManualSseStream {
  let closed = false;
  let closeListener: (() => void) | undefined;

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      this.closeCalls += 1;
      closeListener?.();

      if (closeError) {
        throw closeError;
      }
    },
    closeCalls: 0,
    get closed() {
      return closed;
    },
    onClose(listener) {
      closeListener = listener;

      return () => {
        this.removeCloseListenerCalls += 1;
        closeListener = undefined;
      };
    },
    removeCloseListenerCalls: 0,
    write() {
      return true;
    },
  };
}

function createFixture(closeError?: Error): ManualSseFixture {
  const abortController = new AbortController();
  const events: string[] = [];
  const stream = createStream(closeError);
  const response = createResponse(stream);
  let resolveSse: (sse: SseResponse) => void = () => undefined;
  const sse = new Promise<SseResponse>((resolve) => {
    resolveSse = resolve;
  });

  @Controller('/events')
  class ManualSseController {
    @Sse('/')
    async stream(_input: undefined, context: RequestContext): Promise<SseResponse> {
      await context.container.resolve(RequestScopedDisposable);
      const response = new SseResponse(context);

      events.push('handler');
      resolveSse(response);
      return response;
    }
  }

  const root = new Container().register(
    {
      provide: RequestScopedDisposable,
      scope: Scope.REQUEST,
      useFactory: () => new RequestScopedDisposable(events),
    },
    ManualSseController,
  );
  const dispatcher = createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: ManualSseController }]),
    observers: [
      {
        onRequestFinish() {
          events.push('finish');
        },
        onRequestSuccess() {
          events.push('success');
        },
      },
    ],
    rootContainer: root,
  });

  return {
    abortController,
    dispatch: dispatcher.dispatch(createRequest(abortController.signal), response),
    events,
    sse,
    stream,
  };
}

describe('manual SSE lifecycle', () => {
  it.each(CLOSE_CASES)(
    'keeps full-path lifecycle resources active until $label',
    async ({ close, events }) => {
      // Given
      const fixture = createFixture();

      // When
      await fixture.sse;

      // Then
      expect(fixture.events).toEqual(['handler']);

      await close(fixture);
      await fixture.dispatch;

      expect(fixture.events).toEqual(events);
      expect(fixture.stream.closeCalls).toBe(1);
      expect(fixture.stream.removeCloseListenerCalls).toBe(1);
    },
  );

  it('finishes the full request scope after a manual stream close throws', async () => {
    const fixture = createFixture(new Error('stream close failed'));
    const sse = await fixture.sse;

    expect(() => sse.close()).toThrow('stream close failed');
    await fixture.dispatch;

    expect(fixture.events).toEqual(['handler', 'success', 'finish', 'destroy']);
    expect(fixture.stream.closeCalls).toBe(1);
    expect(fixture.stream.removeCloseListenerCalls).toBe(1);
  });
});
