import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeSocketIoServerWithTimeout, type SocketIoCloseTarget } from './shutdown.internal.js';

describe('Socket.IO shutdown timeout cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detaches the adapter-owned HTTP server before Socket.IO client cleanup runs', async () => {
    const events: string[] = [];
    const target: SocketIoCloseTarget = {
      close(callback) {
        events.push(this.httpServer === undefined ? 'detached' : 'attached');
        callback?.();
      },
      httpServer: { close() {} },
    };

    await expect(closeSocketIoServerWithTimeout(target, 100)).resolves.toEqual({ kind: 'closed' });
    expect(events).toEqual(['detached']);
  });

  it('force-disconnects managed clients before resolving a timed-out close lifecycle', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const target: SocketIoCloseTarget = {
      close() {
        events.push('close-started');
      },
      disconnectSockets(close) {
        events.push(close === true ? 'force-disconnect' : 'soft-disconnect');
      },
      httpServer: { close() {} },
    };

    const closePromise = closeSocketIoServerWithTimeout(target, 25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(closePromise).resolves.toMatchObject({ kind: 'forced' });
    expect(events).toEqual(['close-started', 'force-disconnect']);
    expect(target.httpServer).toBeUndefined();
  });

  it('rejects timed-out shutdown when force-disconnect fails so managed state can be retried', async () => {
    vi.useFakeTimers();
    const failure = new Error('force disconnect failed');
    const target: SocketIoCloseTarget = {
      close() {},
      disconnectSockets() {
        throw failure;
      },
    };

    const closePromise = closeSocketIoServerWithTimeout(target, 25);
    const closeAssertion = expect(closePromise).rejects.toThrow(failure);
    await vi.advanceTimersByTimeAsync(25);

    await closeAssertion;
  });
});
