import { Scope as ScopeDecorator } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import type {
  FrameworkRequest,
  FrameworkResponse,
  FrameworkResponseStream,
  Middleware,
} from '../index.js';
import { Controller, createDispatcher, createHandlerMapping, Sse } from '../index.js';

interface BlockingDrainStream extends FrameworkResponseStream {
  closeCalls: number;
  drainCalls: number;
  emitClose(): void;
}

type StreamingResponse = FrameworkResponse & { stream: BlockingDrainStream };

interface CancellationCase {
  readonly label: string;
  readonly prepare: (request: FrameworkRequest, response: StreamingResponse) => () => void;
}

interface BackpressureResponseOptions {
  readonly afterFailure?: () => void;
  readonly drainFailure?: unknown;
  readonly onDrainStart?: () => void;
  readonly writeFailure?: unknown;
}

interface FailureCase {
  readonly createOptions: (error: Error) => BackpressureResponseOptions;
  readonly drainCalls: number;
  readonly label: string;
}

const CANCELLATION_CASES = [
  {
    label: 'the request aborts',
    prepare(request: FrameworkRequest) {
      const controller = new AbortController();
      request.signal = controller.signal;
      return () => controller.abort(new Error('client disconnected'));
    },
  },
  {
    label: 'the response stream closes',
    prepare(_request: FrameworkRequest, response: StreamingResponse) {
      return () => response.stream.emitClose();
    },
  },
] as const satisfies readonly CancellationCase[];

const FAILURE_CASES = [
  {
    createOptions(error: Error) {
      return { writeFailure: error };
    },
    drainCalls: 0,
    label: 'write',
  },
  {
    createOptions(error: Error) {
      return { drainFailure: error };
    },
    drainCalls: 1,
    label: 'drain',
  },
] as const satisfies readonly FailureCase[];

class CountingContainer extends Container {
  requestScopeDisposeCount = 0;

  override createRequestScope(): Container {
    const scope = super.createRequestScope();
    const dispose = scope.dispose.bind(scope);

    scope.dispose = async () => {
      this.requestScopeDisposeCount += 1;
      await dispose();
    };

    return scope;
  }
}

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createBackpressureResponse(options: BackpressureResponseOptions = {}): StreamingResponse {
  const closeListeners: Array<() => void> = [];
  const blockedDrain = new Promise<void>(() => undefined);
  let closed = false;

  const stream: BlockingDrainStream = {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      this.closeCalls += 1;
    },
    closeCalls: 0,
    drainCalls: 0,
    emitClose() {
      for (const listener of [...closeListeners]) {
        listener();
      }
    },
    get closed() {
      return closed;
    },
    onClose(listener) {
      closeListeners.push(listener);
      return () => {
        const index = closeListeners.indexOf(listener);
        if (index >= 0) {
          closeListeners.splice(index, 1);
        }
      };
    },
    waitForDrain() {
      this.drainCalls += 1;
      options.onDrainStart?.();

      if (options.drainFailure) {
        const rejectedDrain = Promise.reject(options.drainFailure);
        options.afterFailure?.();
        return rejectedDrain;
      }

      return blockedDrain;
    },
    write() {
      if (options.writeFailure) {
        queueMicrotask(() => options.afterFailure?.());
        throw options.writeFailure;
      }

      return false;
    },
  };

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

describe('managed SSE backpressure cancellation', () => {
  it.each(['write', 'encode', 'drain'] as const)(
    'managed SSE: %s failure -> awaits generator finally before observers and scope disposal',
    async (operation) => {
      // Given
      const failure = { operation };
      const abortController = new AbortController();
      let startCleanup: () => void = () => undefined;
      const cleanupStarted = new Promise<void>((resolve) => {
        startCleanup = resolve;
      });
      let finishCleanup: () => void = () => undefined;
      const cleanupGate = new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
      const onRequestError = vi.fn();
      const onRequestFinish = vi.fn();
      const onError = vi.fn();
      const root = new CountingContainer();
      let cleanupFinished = false;
      let resourceActive = true;
      async function* source() {
        try {
          yield operation === 'encode' ? { toJSON() { throw failure; } } : 'first';
        } finally {
          startCleanup();
          await cleanupGate;
          expect(root.requestScopeDisposeCount).toBe(0);
          expect(resourceActive).toBe(true);
          cleanupFinished = true;
        }
      }
      const iterator = source();
      const iteratorReturn = vi.spyOn(iterator, 'return');

      @ScopeDecorator('request')
      @Controller('/managed-failure-cleanup')
      class ManagedFailureCleanupController {
        onDestroy() {
          resourceActive = false;
        }

        @Sse('/')
        stream() {
          return iterator;
        }
      }

      root.register(ManagedFailureCleanupController);
      const dispatcher = createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: ManagedFailureCleanupController }]),
        observers: [{ onRequestError, onRequestFinish }],
        onError,
        rootContainer: root,
      });
      const request = createRequest('/managed-failure-cleanup');
      request.signal = abortController.signal;
      const response = createBackpressureResponse({
        drainFailure: operation === 'drain' ? failure : undefined,
        writeFailure: operation === 'write' ? failure : undefined,
      });
      const send = vi.spyOn(response, 'send');

      // When
      const dispatch = dispatcher.dispatch(request, response);
      const cleanupBegan = await Promise.race([
        cleanupStarted.then(() => true),
        dispatch.then(() => false),
      ]);
      try {
        // Then
        expect(cleanupBegan).toBe(true);
        expect(response.stream.closeCalls).toBe(1);
        expect(iteratorReturn).toHaveBeenCalledTimes(1);
        expect(root.requestScopeDisposeCount).toBe(0);
        expect(onRequestFinish).not.toHaveBeenCalled();
        expect(onRequestError).not.toHaveBeenCalled();
        abortController.abort();
      } finally {
        finishCleanup();
        await dispatch;
      }
      expect(cleanupFinished).toBe(true);
      expect(onRequestError).toHaveBeenCalledWith(expect.any(Object), failure);
      expect(onError.mock.calls[0]?.[0]).toBe(failure);
      expect(onRequestFinish).toHaveBeenCalledTimes(1);
      expect(root.requestScopeDisposeCount).toBe(1);
      expect(resourceActive).toBe(false);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(['write', 'encode', 'drain'] as const)(
    'managed SSE: %s failure and rejecting return -> reports the original failure exactly once',
    async (operation) => {
      // Given
      const failure = new Error(`${operation} failed`);
      const cleanupFailure = new Error('cleanup failed');
      async function* source() {
        try {
          yield operation === 'encode' ? { toJSON() { throw failure; } } : 'first';
        } finally {
          await Promise.reject(cleanupFailure);
        }
      }
      const iterator = source();
      const iteratorReturn = vi.spyOn(iterator, 'return');
      const onRequestError = vi.fn();
      const onError = vi.fn();

      @Controller('/managed-rejecting-cleanup')
      class ManagedRejectingCleanupController {
        @Sse('/')
        stream() {
          return iterator;
        }
      }

      const dispatcher = createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: ManagedRejectingCleanupController }]),
        observers: [{ onRequestError }],
        onError,
        rootContainer: new Container().register(ManagedRejectingCleanupController),
      });
      const response = createBackpressureResponse({
        drainFailure: operation === 'drain' ? failure : undefined,
        writeFailure: operation === 'write' ? failure : undefined,
      });
      const send = vi.spyOn(response, 'send');

      // When
      await dispatcher.dispatch(createRequest('/managed-rejecting-cleanup'), response);

      // Then
      expect(iteratorReturn).toHaveBeenCalledTimes(1);
      expect(onRequestError).toHaveBeenCalledExactlyOnceWith(expect.any(Object), failure);
      expect(onError.mock.calls[0]?.[0]).toBe(failure);
      expect(response.stream.closeCalls).toBe(1);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('managed SSE: source read rejects undefined and cleanup rejects -> retains the original thrown value', async () => {
    // Given
    const iteratorReturn = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.reject(undefined),
          return: iteratorReturn,
        };
      },
    };
    const onRequestError = vi.fn();
    const onError = vi.fn();

    @Controller('/managed-read-failure')
    class ManagedReadFailureController {
      @Sse('/')
      stream() {
        return source;
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ManagedReadFailureController }]),
      observers: [{ onRequestError }],
      onError,
      rootContainer: new Container().register(ManagedReadFailureController),
    });
    const response = createBackpressureResponse();
    const send = vi.spyOn(response, 'send');

    // When
    await dispatcher.dispatch(createRequest('/managed-read-failure'), response);

    // Then
    expect(iteratorReturn).toHaveBeenCalledTimes(1);
    expect(onRequestError).toHaveBeenCalledExactlyOnceWith(expect.any(Object), undefined);
    expect(onError.mock.calls[0]?.[0]).toBeUndefined();
    expect(response.stream.closeCalls).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('managed SSE: source reports done -> does not call return redundantly', async () => {
    // Given
    async function* source() {
      yield 'first';
    }
    const iterator = source();
    const iteratorReturn = vi.spyOn(iterator, 'return');

    @Controller('/managed-completed')
    class ManagedCompletedController {
      @Sse('/')
      stream() {
        return iterator;
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ManagedCompletedController }]),
      rootContainer: new Container().register(ManagedCompletedController),
    });
    const response = createBackpressureResponse();
    response.stream.write = () => true;

    // When
    await dispatcher.dispatch(createRequest('/managed-completed'), response);

    // Then
    expect(iteratorReturn).not.toHaveBeenCalled();
    expect(response.stream.closeCalls).toBe(1);
  });

  it.each(CANCELLATION_CASES)(
    'does not let a blocked drain delay iterator cleanup or request-scope disposal when $label',
    async ({ prepare }) => {
      // Given
      let iteratorCleanupCalls = 0;
      let startDrain: () => void = () => undefined;
      const drainStarted = new Promise<void>((resolve) => {
        startDrain = resolve;
      });
      const onRequestError = vi.fn();
      const source: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.resolve({ done: false, value: 'first' });
            },
            return() {
              iteratorCleanupCalls += 1;
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      };

      @Controller('/managed-blocked-drain')
      class ManagedBlockedDrainController {
        @Sse('/')
        stream() {
          return source;
        }
      }

      const middleware: Middleware = {
        async handle(_context, next) {
          await next();
        },
      };
      const root = new CountingContainer().register(ManagedBlockedDrainController);
      const dispatcher = createDispatcher({
        appMiddleware: [middleware],
        handlerMapping: createHandlerMapping([{ controllerToken: ManagedBlockedDrainController }]),
        observers: [{ onRequestError }],
        rootContainer: root,
      });
      const request = createRequest('/managed-blocked-drain');
      const response = createBackpressureResponse({ onDrainStart: startDrain });
      const cancel = prepare(request, response);

      // When
      const dispatch = dispatcher.dispatch(request, response);
      await drainStarted;
      cancel();
      await dispatch;

      // Then
      expect(response.stream.drainCalls).toBe(1);
      expect(response.stream.closeCalls).toBe(1);
      expect(iteratorCleanupCalls).toBe(1);
      expect(onRequestError).not.toHaveBeenCalled();
      expect(root.requestScopeDisposeCount).toBe(1);
    },
  );

  it.each(FAILURE_CASES)('preserves the original managed SSE $label error before a later abort', async ({ createOptions, drainCalls, label }) => {
    // Given
    const abortController = new AbortController();
    const failure = new Error(`${label} failed`);
    const onRequestError = vi.fn();

    @Controller('/managed-backpressure-error')
    class ManagedBackpressureErrorController {
      @Sse('/')
      async *stream() {
        yield 'first';
      }
    }

    const root = new Container().register(ManagedBackpressureErrorController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ManagedBackpressureErrorController }]),
      observers: [{ onRequestError }],
      rootContainer: root,
    });
    const request = createRequest('/managed-backpressure-error');
    request.signal = abortController.signal;
    const response = createBackpressureResponse({
      ...createOptions(failure),
      afterFailure: () => abortController.abort(new Error('client disconnected')),
    });

    // When
    await dispatcher.dispatch(request, response);

    // Then
    expect(request.signal.aborted).toBe(true);
    expect(onRequestError).toHaveBeenCalledWith(expect.any(Object), failure);
    expect(response.stream.drainCalls).toBe(drainCalls);
    expect(response.stream.closeCalls).toBe(1);
  });
});
