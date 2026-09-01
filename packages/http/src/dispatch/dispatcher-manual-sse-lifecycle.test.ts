import { Container, Scope } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type {
  AccessLogEvent,
  FrameworkRequest,
  FrameworkResponse,
  FrameworkResponseStream,
  RequestContext,
} from '../index.js';
import {
  Controller,
  createAccessLogObserver,
  createDispatcher,
  createHandlerMapping,
  Sse,
  SseResponse,
} from '../index.js';

interface ManualSseStream extends FrameworkResponseStream {
  closeCalls: number;
  disconnect(): void;
  removeCloseListenerCalls: number;
}

interface ManualSseFixture {
  readonly accessRecords: AccessLogEvent[];
  readonly abortController: AbortController;
  readonly dispatch: Promise<void>;
  readonly dispatcherWaiting: Promise<void>;
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

interface ManualSseFixtureOptions {
  readonly closeError?: Error;
  readonly streamStartsClosed?: boolean;
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

function createStream(closeError?: Error, streamStartsClosed = false): ManualSseStream {
  let closed = streamStartsClosed;
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
    disconnect() {
      closed = true;
    },
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

function createFixture(options: ManualSseFixtureOptions = {}): ManualSseFixture {
  const abortController = new AbortController();
  const accessRecords: AccessLogEvent[] = [];
  const events: string[] = [];
  const stream = createStream(options.closeError, options.streamStartsClosed);
  const response = createResponse(stream);
  const dispatcherWaiting = createDeferred<void>();
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
      const completion = response.completion;

      Object.defineProperty(response, 'completion', {
        configurable: true,
        get() {
          dispatcherWaiting.resolve();
          return completion;
        },
      });

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
      createAccessLogObserver({
        sink: {
          emit(record) {
            accessRecords.push(record);
          },
        },
      }),
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
    accessRecords,
    abortController,
    dispatch: dispatcher.dispatch(createRequest(abortController.signal), response),
    dispatcherWaiting: dispatcherWaiting.promise,
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
      await fixture.dispatcherWaiting;

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
    const fixture = createFixture({ closeError: new Error('stream close failed') });
    const sse = await fixture.sse;
    await fixture.dispatcherWaiting;

    expect(() => sse.close()).toThrow('stream close failed');
    await fixture.dispatch;

    expect(fixture.events).toEqual(['handler', 'success', 'finish', 'destroy']);
    expect(fixture.stream.closeCalls).toBe(1);
    expect(fixture.stream.removeCloseListenerCalls).toBe(1);
  });

  it.each([
    {
      close(fixture: ManualSseFixture): void {
        fixture.abortController.abort(new Error('client disconnected'));
      },
      label: 'the request signal aborts',
    },
    {
      close(fixture: ManualSseFixture): void {
        fixture.stream.close();
      },
      label: 'the raw response stream closes',
    },
  ])('emits one aborted access-log terminal record when $label', async ({ close }) => {
    // Given
    const fixture = createFixture();

    // When
    await fixture.sse;
    await fixture.dispatcherWaiting;
    close(fixture);
    await fixture.dispatch;

    // Then
    expect(fixture.accessRecords.filter((record) => record.event === 'http.access.finish')).toEqual([
      expect.objectContaining({ outcome: 'aborted', status: 200 }),
    ]);
  });

  it('emits one aborted access-log terminal record when raw disconnect precedes writeFrame', async () => {
    // Given
    const fixture = createFixture();
    const sse = await fixture.sse;
    await fixture.dispatcherWaiting;
    fixture.stream.disconnect();

    // When
    expect(sse.send('after raw disconnect')).toBe(false);
    await fixture.dispatch;

    // Then
    expect(fixture.accessRecords.filter((record) => record.event === 'http.access.finish')).toEqual([
      expect.objectContaining({ outcome: 'aborted', status: 200 }),
    ]);
  });

  it('emits one aborted access-log terminal record when the stream is already closed', async () => {
    // Given
    const fixture = createFixture({ streamStartsClosed: true });

    // When
    await fixture.sse;
    await fixture.dispatcherWaiting;
    await fixture.dispatch;

    // Then
    expect(fixture.accessRecords.filter((record) => record.event === 'http.access.finish')).toEqual([
      expect.objectContaining({ outcome: 'aborted', status: 200 }),
    ]);
  });
});
