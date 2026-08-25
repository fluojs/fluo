import { afterEach, describe, expect, it, vi } from 'vitest';

import { SocketIoLifecycleService } from './adapter.js';

function createDeferred() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function createLogger(events: string[]) {
  return {
    debug() {},
    error(message: string) {
      events.push(message);
    },
    log() {},
    warn() {},
  };
}

describe('SocketIoLifecycleService shutdown state retention', () => {
  it('waits for accepted disconnect work before clearing managed state', async () => {
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger([]) as never,
      {
        async close() {},
        getRealtimeCapability() {
          return { kind: 'server-backed', server: {} };
        },
      } as never,
      { shutdown: { timeoutMs: 100 } },
    );
    const disconnectRelease = createDeferred();
    const disconnectStarted = createDeferred();
    const io = {
      close(callback?: () => void) {
        const work = Reflect.get(service, 'trackGatewayWork').call(service, (async () => {
          disconnectStarted.resolve();
          await disconnectRelease.promise;
        })());
        void work;
        callback?.();
      },
      disconnectSockets() {},
    };

    Reflect.set(service, 'io', io);
    Reflect.set(service, 'attachments', [{ path: '/chat' }]);

    let shutdownSettled = false;
    const shutdown = service.onApplicationShutdown().then(() => {
      shutdownSettled = true;
    });
    await disconnectStarted.promise;

    expect(shutdownSettled).toBe(false);
    expect(Reflect.get(service, 'attachments')).toEqual([{ path: '/chat' }]);

    disconnectRelease.resolve();
    await shutdown;

    expect(Reflect.get(service, 'attachments')).toEqual([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retains managed state when accepted gateway work exceeds the shutdown bound', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger(loggerEvents) as never,
      {
        async close() {},
        getRealtimeCapability() {
          return { kind: 'server-backed', server: {} };
        },
      } as never,
      { shutdown: { timeoutMs: 25 } },
    );
    const gatewayWork = createDeferred();
    const io = {
      close(callback?: () => void) {
        void Reflect.get(service, 'trackGatewayWork').call(service, gatewayWork.promise);
        callback?.();
      },
      disconnectSockets() {},
    };
    const retainedAttachment = { path: '/chat' };

    Reflect.set(service, 'io', io);
    Reflect.set(service, 'attachments', [retainedAttachment]);

    const shutdown = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(25);
    await shutdown;

    expect(Reflect.get(service, 'io')).toBe(io);
    expect(Reflect.get(service, 'attachments')).toEqual([retainedAttachment]);
    expect(loggerEvents).toEqual([
      'Socket.IO gateway work did not drain within 25ms; retaining managed Socket.IO state for shutdown retry.',
    ]);

    gatewayWork.resolve();
  });

  it('retains the managed server reference when timeout force cleanup fails', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger(loggerEvents) as never,
      {
        async close() {},
        getRealtimeCapability() {
          return { kind: 'server-backed', server: {} };
        },
      } as never,
      { shutdown: { timeoutMs: 25 } },
    );
    const io = {
      close() {},
      disconnectSockets() {
        throw new Error('force disconnect failed');
      },
    };
    const retainedSocket = { id: 'socket-1' };
    const retainedAttachment = { path: '/chat' };

    Reflect.set(service, 'io', io);
    Reflect.set(service, 'attachments', [retainedAttachment]);
    (Reflect.get(service, 'socketRegistry') as Map<string, unknown>).set('socket-1', retainedSocket);

    const closePromise = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(25);
    await closePromise;

    expect(Reflect.get(service, 'io')).toBe(io);
    expect(Reflect.get(service, 'attachments')).toEqual([retainedAttachment]);
    expect(Reflect.get(service, 'socketRegistry')).toEqual(new Map([['socket-1', retainedSocket]]));
    expect(loggerEvents).toEqual([
      'Failed to close Socket.IO server within 25ms; retaining managed Socket.IO state for shutdown retry.',
    ]);
  });

  it('shares one terminal timeout attempt across both runtime shutdown hooks', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger(loggerEvents) as never,
      {
        async close() {},
        getRealtimeCapability() {
          return { kind: 'server-backed', server: {} };
        },
      } as never,
      { shutdown: { timeoutMs: 25 } },
    );
    const closeCallbacks: Array<() => void> = [];
    let forceCleanupShouldFail = true;
    const io = {
      close(callback?: () => void) {
        if (callback) {
          closeCallbacks.push(callback);
        }
      },
      disconnectSockets() {
        if (forceCleanupShouldFail) {
          forceCleanupShouldFail = false;
          throw new Error('force disconnect failed');
        }
      },
    };
    const retainedSocket = { id: 'socket-1' };

    Reflect.set(service, 'io', io);
    Reflect.set(service, 'attachments', [{ path: '/chat' }]);
    (Reflect.get(service, 'socketRegistry') as Map<string, unknown>).set('socket-1', retainedSocket);

    const moduleDestroy = service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(25);
    await moduleDestroy;

    const applicationShutdown = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(25);
    await applicationShutdown;

    expect(closeCallbacks).toHaveLength(1);
    expect(Reflect.get(service, 'io')).toBe(io);
    expect(Reflect.get(service, 'socketRegistry')).toEqual(new Map([['socket-1', retainedSocket]]));
    expect(loggerEvents).toEqual([
      'Failed to close Socket.IO server within 25ms; retaining managed Socket.IO state for shutdown retry.',
    ]);
  });

  it('clears retained managed state through a deliberate later retry attempt', async () => {
    vi.useFakeTimers();
    const service = new SocketIoLifecycleService(
      {} as never,
      [] as never,
      createLogger([]) as never,
      {
        async close() {},
        getRealtimeCapability() {
          return { kind: 'server-backed', server: {} };
        },
      } as never,
      { shutdown: { timeoutMs: 25 } },
    );
    const closeCallbacks: Array<() => void> = [];
    const retryCloseRegistered = createDeferred();
    let forceCleanupShouldFail = true;
    const io = {
      close(callback?: () => void) {
        if (callback) {
          closeCallbacks.push(callback);
          if (closeCallbacks.length === 2) {
            retryCloseRegistered.resolve();
          }
        }
      },
      disconnectSockets() {
        if (forceCleanupShouldFail) {
          forceCleanupShouldFail = false;
          throw new Error('force disconnect failed');
        }
      },
    };

    Reflect.set(service, 'io', io);

    const runtimeShutdown = service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(25);
    await runtimeShutdown;

    const retry = service.retryShutdown();
    await retryCloseRegistered.promise;
    const retryCloseCallback = closeCallbacks[1];
    if (!retryCloseCallback) {
      throw new Error('Expected the deliberate retry close callback to be registered.');
    }

    retryCloseCallback();
    await retry;

    expect(Reflect.get(service, 'io')).toBeUndefined();
    expect(closeCallbacks).toHaveLength(2);
  });
});
