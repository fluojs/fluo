import { afterEach, describe, expect, it, vi } from 'vitest';

import { SocketIoLifecycleService } from './adapter.js';

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
  afterEach(() => {
    vi.useRealTimers();
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

  it('clears retained managed state when a later shutdown retry succeeds on the same service', async () => {
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

    const firstClose = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(25);
    await firstClose;

    expect(Reflect.get(service, 'io')).toBe(io);
    expect(Reflect.get(service, 'socketRegistry')).toEqual(new Map([['socket-1', retainedSocket]]));

    const secondClose = service.onApplicationShutdown();
    expect(closeCallbacks).toHaveLength(2);
    const retryCloseCallback = closeCallbacks[1];
    if (!retryCloseCallback) {
      throw new Error('Expected the retry close callback to be registered.');
    }

    retryCloseCallback();
    await secondClose;

    expect(Reflect.get(service, 'io')).toBeUndefined();
    expect(Reflect.get(service, 'attachments')).toEqual([]);
    expect(Reflect.get(service, 'socketRegistry')).toEqual(new Map());
    expect(loggerEvents).toEqual([
      'Failed to close Socket.IO server within 25ms; retaining managed Socket.IO state for shutdown retry.',
    ]);
  });
});
