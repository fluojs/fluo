import { defineModule, FluoFactory } from '@fluojs/runtime';
import Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRedisClientToken, RedisModule } from './index.js';
import type { RedisLifecycleOptions } from './types.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createApplication(name: string | undefined, lifecycle: RedisLifecycleOptions = {}) {
  class AppModule {}
  defineModule(AppModule, {
    imports: [RedisModule.forRoot({ host: '127.0.0.1', lifecycle, ...(name === undefined ? {} : { name }) })],
  });
  return FluoFactory.create(AppModule);
}

describe('Redis lifecycle completion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Keep ioredis's real event emitter while controlling the command and socket boundaries.
    vi.spyOn(Redis.prototype, 'connect').mockImplementation(async function (this: Redis) {
      this.status = 'ready';
    });
    vi.spyOn(Redis.prototype, 'quit').mockImplementation(async function (this: Redis) {
      this.status = 'end';
      return 'OK';
    });
    vi.spyOn(Redis.prototype, 'disconnect').mockImplementation(function (this: Redis) {
      this.status = 'end';
      this.emit('end');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each([undefined, 'cache'])('client %s', (name) => {
    it.each(['rejection', 'timeout'] as const)(
      'app.close: QUIT %s and asynchronous disconnect -> waits for terminal closure',
      async (failure) => {
        const app = await createApplication(name, { quitTimeoutMs: 25 });
        const client = await app.container.resolve<Redis>(getRedisClientToken(name));
        const quit = createDeferred<'OK'>();
        const disconnected = createDeferred<void>();
        const onClose = vi.fn();
        const onEnd = vi.fn();
        client.on('close', onClose);
        client.on('end', onEnd);
        vi.mocked(client.quit).mockReturnValue(quit.promise);
        vi.mocked(client.disconnect).mockImplementation(() => disconnected.resolve(undefined));
        let settled = false;

        const closing = app.close();
        const outcome = closing.then(
          () => { settled = true; },
          (error: unknown) => { settled = true; return error; },
        );
        if (failure === 'rejection') {
          quit.reject(new Error('QUIT rejected'));
        }
        await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 25 : 0);
        await disconnected.promise;

        expect(client.status).toBe('ready');
        expect(settled).toBe(false);
        expect(client.listenerCount('close')).toBe(2);
        expect(client.listenerCount('end')).toBe(2);
        client.status = 'close';
        client.emit('close');
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);
        client.status = 'end';
        client.emit('end');
        await expect(outcome).resolves.toBeUndefined();
        expect(onClose).toHaveBeenCalledOnce();
        expect(onEnd).toHaveBeenCalledOnce();
        expect(client.listeners('close')).toEqual([onClose]);
        expect(client.listeners('end')).toEqual([onEnd]);
        expect(vi.getTimerCount()).toBe(0);

        // The abandoned QUIT must remain observed even after fallback has finished.
        if (failure === 'timeout') {
          quit.reject(new Error('late QUIT rejection'));
          await vi.advanceTimersByTimeAsync(0);
        }
      },
    );

    it.each([
      ['rejection', 0],
      ['rejection', 25],
      ['rejection', undefined],
      ['timeout', 25],
    ] as const)(
      'app.close: QUIT %s with timeout %s and unclosed fallback -> rejects within cleanup deadline',
      async (failure, quitTimeoutMs) => {
        const app = await createApplication(name, { quitTimeoutMs });
        const client = await app.container.resolve<Redis>(getRedisClientToken(name));
        const quitError = new Error('original QUIT failure');
        const quit = createDeferred<'OK'>();
        vi.mocked(client.quit).mockReturnValue(quit.promise);
        vi.mocked(client.disconnect).mockImplementation(() => {});
        let settled = false;

        const outcome = app.close().then(
          () => { settled = true; },
          (error: unknown) => { settled = true; return error; },
        );
        if (failure === 'rejection') {
          quit.reject(quitError);
        }
        await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 25 : 0);

        expect(client.disconnect).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(9_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        if (failure === 'rejection') {
          expect(await outcome).toBe(quitError);
        } else {
          expect(await outcome).toEqual(new Error(`Redis client ${name ?? 'default'} quit timed out after 25ms.`));
        }
        expect(client.listenerCount('close')).toBe(0);
        expect(client.listenerCount('end')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it('app.close: graceful QUIT -> resolves without fallback or remaining listeners/timers', async () => {
      const app = await createApplication(name);
      const client = await app.container.resolve<Redis>(getRedisClientToken(name));

      await app.close();

      expect(client.quit).toHaveBeenCalledOnce();
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.listenerCount('close')).toBe(0);
      expect(client.listenerCount('end')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('app.close: disconnect emits close before end synchronously -> keeps the end observer', async () => {
    const app = await createApplication(undefined);
    const client = await app.container.resolve<Redis>(getRedisClientToken());
    vi.mocked(client.quit).mockRejectedValue(new Error('QUIT rejected'));
    vi.mocked(client.disconnect).mockImplementation(() => {
      client.status = 'close';
      client.emit('close');
      client.status = 'end';
      client.emit('end');
    });

    await app.close();

    expect(client.listenerCount('close')).toBe(0);
    expect(client.listenerCount('end')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('app.close: disconnect throws -> preserves the QUIT failure and cleans observers', async () => {
    const app = await createApplication(undefined);
    const client = await app.container.resolve<Redis>(getRedisClientToken());
    const quitError = new Error('QUIT rejected');
    vi.mocked(client.quit).mockRejectedValue(quitError);
    vi.mocked(client.disconnect).mockImplementation(() => { throw new Error('disconnect failed'); });

    await expect(app.close()).rejects.toBe(quitError);

    expect(client.listenerCount('close')).toBe(0);
    expect(client.listenerCount('end')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe.each([2_147_483_647, 2_147_483_648])('timeout %s ms', (timeoutMs) => {
    it('bootstrap: stalled connect -> times out only after the complete interval', async () => {
      vi.mocked(Redis.prototype.connect).mockReturnValue(new Promise(() => {}));
      let settled = false;
      const outcome = createApplication(undefined, { connectTimeoutMs: timeoutMs }).then(
        () => { settled = true; },
        (error: unknown) => { settled = true; return error; },
      );

      await vi.advanceTimersByTimeAsync(timeoutMs - 1);

      expect(settled).toBe(false);
      expect(Redis.prototype.disconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toEqual(new Error(`Redis client default connect timed out after ${String(timeoutMs)}ms.`));
      expect(Redis.prototype.disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('app.close: stalled QUIT -> starts fallback only after the complete interval', async () => {
      const app = await createApplication(undefined, { quitTimeoutMs: timeoutMs });
      vi.mocked(Redis.prototype.quit).mockReturnValue(new Promise(() => {}));
      let settled = false;
      const outcome = app.close().then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(timeoutMs - 1);

      expect(settled).toBe(false);
      expect(Redis.prototype.disconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(Redis.prototype.disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe.each([
    [2_147_483_647, 1],
    [2_147_483_648, 1],
    [2_147_483_648, 2_147_483_647],
    [Number.MAX_VALUE, 2_147_483_647],
  ])('timeout %s ms, settlement at %s ms', (timeoutMs, elapsedMs) => {
    it.each(['resolve', 'reject'] as const)(
      'bootstrap: connect %s before expiry -> cancels every remaining timeout segment',
      async (settlement) => {
        const connect = createDeferred<void>();
        const connectError = new Error('connect rejected');
        vi.mocked(Redis.prototype.connect).mockImplementation(async function (this: Redis) {
          await connect.promise;
          this.status = 'ready';
        });
        const outcome = createApplication(undefined, { connectTimeoutMs: timeoutMs }).then(
          (app) => ({ app, error: undefined }),
          (error: unknown) => ({ app: undefined, error }),
        );

        await vi.advanceTimersByTimeAsync(elapsedMs);
        if (settlement === 'resolve') {
          connect.resolve(undefined);
        } else {
          connect.reject(connectError);
        }
        const result = await outcome;

        expect(result.error).toBe(settlement === 'reject' ? connectError : undefined);
        expect(vi.getTimerCount()).toBe(0);
        await result.app?.close();
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it.each(['resolve', 'reject'] as const)(
      'app.close: QUIT %s before expiry -> cancels every remaining timeout segment',
      async (settlement) => {
        const app = await createApplication(undefined, { quitTimeoutMs: timeoutMs });
        const quit = createDeferred<'OK'>();
        vi.mocked(Redis.prototype.quit).mockReturnValue(quit.promise);
        const outcome = app.close();

        await vi.advanceTimersByTimeAsync(elapsedMs);
        if (settlement === 'resolve') {
          quit.resolve('OK');
        } else {
          quit.reject(new Error('QUIT rejected'));
        }
        await outcome;

        expect(Redis.prototype.disconnect).toHaveBeenCalledTimes(settlement === 'reject' ? 1 : 0);
        expect(vi.getTimerCount()).toBe(0);
      },
    );
  });
});
