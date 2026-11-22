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

    await expect(closeSocketIoServerWithTimeout(target, 100)).resolves.toEqual({
      kind: 'closed',
    });
    expect(events).toEqual(['detached']);
  });

  it.each(['throw', 'reject'] as const)('rejects close %s failures before timeout and ignores a late callback', async (mode) => {
    vi.useFakeTimers();
    const failure = new Error('close failed');
    let lateCallback: (() => void) | undefined;
    const disconnectSockets = vi.fn();
    const target: SocketIoCloseTarget = {
      close(callback) {
        lateCallback = callback;
        if (mode === 'throw') {
          throw failure;
        }
        return Promise.reject(failure);
      },
      disconnectSockets,
    };

    const result = closeSocketIoServerWithTimeout(target, 25);
    const assertion = expect(result).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
    await assertion;
    lateCallback?.();
    await vi.advanceTimersByTimeAsync(25);
    expect(disconnectSockets).not.toHaveBeenCalled();
  });

  it('observes a late close rejection after callback completion without repeating cleanup', async () => {
    vi.useFakeTimers();
    const disconnectSockets = vi.fn();
    const target: SocketIoCloseTarget = {
      close(callback) {
        callback?.();
        return Promise.reject(new Error('late rejection'));
      },
      disconnectSockets,
    };

    await expect(closeSocketIoServerWithTimeout(target, 25)).resolves.toEqual({
      kind: 'closed',
    });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(25);
    expect(disconnectSockets).not.toHaveBeenCalled();
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
