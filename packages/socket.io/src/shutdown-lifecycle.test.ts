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

    Reflect.set(service, 'io', io);

    const closePromise = service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(25);
    await closePromise;

    expect(Reflect.get(service, 'io')).toBe(io);
    expect(loggerEvents).toEqual([
      'Failed to close Socket.IO server within 25ms; retaining managed Socket.IO state for shutdown retry.',
    ]);
  });
});
