import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { CacheAtomicUpdate, CacheStore, CacheUpdate, CacheUpdateContext, CacheUpdateOptions, RedisCompatibleClient } from './index.js';
import { CacheService, CacheUpdateError, MemoryStore, RedisStore } from './index.js';
import type { NormalizedCacheModuleOptions } from './types.js';

function deferred() {
  let resolveSignal: (() => void) | undefined;
  let rejectSignal: ((reason: unknown) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveSignal = resolve;
    rejectSignal = reject;
  });
  return {
    promise,
    resolve() {
      if (!resolveSignal) throw new Error('Signal resolver was not initialized.');
      resolveSignal();
    },
    reject(reason: unknown) {
      if (!rejectSignal) throw new Error('Signal rejector was not initialized.');
      rejectSignal(reason);
    },
  };
}

const options: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 60,
};

describe('atomic cache update', () => {
  afterEach(() => vi.useRealTimers());

  it('retains every increment when callers update the same key concurrently', async () => {
    // Given
    const cache = new CacheService(new MemoryStore(), options);

    // When
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        cache.update<number>('counter', async (value) => ({
          action: 'set',
          value: (value ?? 0) + 1,
        })),
      ),
    );

    // Then
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    await expect(cache.get('counter')).resolves.toBe(20);
    await cache.close();
  });

  it('shares store-instance admission without serializing unrelated keys', async () => {
    // Given
    const store = new MemoryStore();
    const first = new CacheService(store, options);
    const second = new CacheService(store, options);
    const entered = deferred();
    const release = deferred();
    const slow = first.update<number>('slow', async (value) => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: (value ?? 0) + 1 };
    });
    await entered.promise;

    // When
    const queued = second.update<number>('slow', (value) => ({ action: 'set', value: (value ?? 0) + 1 }));
    const fast = second.update('fast', () => ({ action: 'set', value: 7 }));

    // Then
    await expect(fast).resolves.toBe(7);
    release.resolve();
    await expect(Promise.all([slow, queued])).resolves.toEqual([1, 2]);
    expect(store.atomicUpdate.scope).toBe('local-process');
    await Promise.all([first.close(), second.close()]);
  });

  it.each(['del', 'reset', 'close'] as const)('invalidates reducers admitted immediately before %s', async (operation) => {
    // Given
    const store = new MemoryStore();
    const cache = new CacheService(store, options);
    const reducer = vi.fn(() => ({ action: 'set' as const, value: 'stale' }));
    const update = cache.update('key', reducer);
    const rejected = expect(update).rejects.toMatchObject({
      code: operation === 'close' ? 'closed' : 'invalidated',
    });

    // When
    const invalidation = operation === 'del' ? cache.del('key') : cache[operation]();

    // Then
    await Promise.all([rejected, invalidation]);
    expect(reducer).not.toHaveBeenCalled();
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it.each(['del', 'reset'] as const)('registers pending facade updates before direct store %s', async (operation) => {
    // Given
    const store = new MemoryStore();
    const cache = new CacheService(store, options);
    const update = cache.update('key', () => ({ action: 'set', value: 'stale' }));
    const rejected = expect(update).rejects.toMatchObject({ code: 'invalidated' });

    // When
    await (operation === 'del' ? store.del('key') : store.reset());

    // Then
    await rejected;
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it.each(['del', 'reset', 'close'] as const)('discards late reducer results and drains queued work at %s', async (operation) => {
    // Given
    const events: string[] = [];
    class OwnedStore extends MemoryStore {
      async close() { events.push('store:close'); }
    }
    const store = new OwnedStore();
    const cache = new CacheService(store, options);
    const entered = deferred();
    const aborted = deferred();
    const release = deferred();
    const update = cache.update('key', async (_value, { signal }) => {
      signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      entered.resolve();
      await release.promise;
      events.push('reducer:settled');
      return { action: 'set', value: 'stale' };
    });
    await entered.promise;
    const queuedReducer = vi.fn(() => ({ action: 'set' as const, value: 'queued' }));
    const queued = cache.update('key', queuedReducer);
    const results = Promise.allSettled([update, queued]);

    // When
    const invalidation = operation === 'del' ? cache.del('key') : cache[operation]();
    await aborted.promise;

    // Then
    expect(events).toEqual([]);
    release.resolve();
    await invalidation;
    expect(await results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: operation === 'close' ? 'closed' : 'invalidated' }) },
      { status: 'rejected', reason: expect.objectContaining({ code: operation === 'close' ? 'closed' : 'invalidated' }) },
    ]);
    expect(queuedReducer).not.toHaveBeenCalled();
    await expect(store.get('key')).resolves.toBeUndefined();
    if (operation === 'close') {
      expect(events).toEqual(['reducer:settled', 'store:close']);
      await expect(cache.update('other', queuedReducer)).rejects.toMatchObject({ code: 'closed' });
    } else {
      await expect(cache.update('key', () => ({ action: 'set', value: 'fresh' }))).resolves.toBe('fresh');
      await cache.close();
    }
  });

  it('uses seconds for missing values and preserves an existing absolute expiry', async () => {
    // Given
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = new CacheService(new MemoryStore(), { ...options, ttl: 0.5 });
    await cache.update('key', () => ({ action: 'set', value: 1 }));
    vi.setSystemTime(1_200);

    // When
    await cache.update<number>('key', (value) => ({ action: 'set', value: (value ?? 0) + 1 }));

    // Then
    vi.setSystemTime(1_499);
    await expect(cache.get('key')).resolves.toBe(2);
    vi.setSystemTime(1_500);
    await expect(cache.get('key')).resolves.toBeUndefined();
    await cache.close();
  });

  it('treats expired values as missing and explicit positive TTL as renewal', async () => {
    // Given
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = new CacheService(new MemoryStore(), options);
    await cache.set('key', 99, 0.1);
    vi.setSystemTime(1_100);
    const reducer = vi.fn((value: number | undefined) => ({ action: 'set' as const, value: value ?? 1, ttlSeconds: 0.25 }));

    // When
    await cache.update('key', reducer);

    // Then
    expect(reducer).toHaveBeenCalledWith(undefined, expect.objectContaining({ attempt: 1 }));
    vi.setSystemTime(1_349);
    await expect(cache.get('key')).resolves.toBe(1);
    vi.setSystemTime(1_350);
    await expect(cache.get('key')).resolves.toBeUndefined();
  });

  it('supports persistent replacement and explicit deletion without confusing falsey values', async () => {
    // Given
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = new CacheService(new MemoryStore(), options);
    await cache.set('key', 'value', 1);

    // When
    await cache.update('key', () => ({ action: 'set', value: null, ttlSeconds: 0 }));
    vi.setSystemTime(1_000_000);
    const persisted = await cache.get('key');
    const deleted = await cache.update('key', () => ({ action: 'delete' }));

    // Then
    expect(persisted).toBeNull();
    expect(deleted).toBeUndefined();
    await expect(cache.get('key')).resolves.toBeUndefined();
  });

  it('refuses to resurrect an entry that expires while its reducer runs', async () => {
    // Given
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = new CacheService(new MemoryStore(), options);
    await cache.set('key', 1, 1);

    // When
    const result = cache.update('key', () => {
      vi.setSystemTime(2_000);
      return { action: 'set', value: 2, ttlSeconds: 10 };
    });

    // Then
    await expect(result).rejects.toMatchObject({ code: 'invalidated' });
    await expect(cache.get('key')).resolves.toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid update TTL %s without changing legacy set behavior', async (ttlSeconds) => {
    // Given
    const cache = new CacheService(new MemoryStore(), options);
    await cache.set('key', 1);

    // When
    const result = cache.update('key', () => ({ action: 'set', value: 2, ttlSeconds }));

    // Then
    await expect(result).rejects.toBeInstanceOf(RangeError);
    await cache.set('key', 3, ttlSeconds);
    await expect(cache.get('key')).resolves.toBe(1);
  });

  it('propagates reducer and store failures and reclaims admission after rejection', async () => {
    // Given
    const store = new MemoryStore();
    const cache = new CacheService(store, options);
    const failure = new Error('reducer failed');

    // When
    const rejected = cache.update('key', () => { throw failure; });

    // Then
    await expect(rejected).rejects.toBe(failure);
    await expect(cache.update('key', () => ({ action: 'set', value: 1 }))).resolves.toBe(1);
    const get = vi.spyOn(store, 'get').mockRejectedValueOnce(failure);
    await expect(cache.update('key', () => ({ action: 'delete' }))).rejects.toBe(failure);
    get.mockRestore();
    await expect(cache.get('key')).resolves.toBe(1);
    expect(Reflect.get(cache, 'updates').size).toBe(0);
    expect(Reflect.get(Reflect.get(store, 'updates'), 'active').size).toBe(0);
    expect(Reflect.get(Reflect.get(store, 'updates'), 'tails').size).toBe(0);
  });

  it('keeps legacy custom stores valid and fails explicitly instead of claiming atomicity', async () => {
    // Given
    const store: CacheStore = {
      async get() { return undefined; },
      async set() {},
      async del() {},
      async reset() {},
    };
    const cache = new CacheService(store, options);

    // When
    const update = cache.update('key', () => ({ action: 'set', value: 1 }));

    // Then
    await expect(update).rejects.toMatchObject({ code: 'unsupported' });
    await expect(cache.set('key', 1)).resolves.toBeUndefined();
    expect(new RedisStore({
      get: async () => null, set: async () => 'OK', del: async () => 0, scan: async () => ['0', []],
    }).atomicUpdate).toBeUndefined();
    expect(() => new RedisStore({
      get: async () => null, set: async () => 'OK', del: async () => 0, scan: async () => ['0', []],
    }, { atomicUpdates: true })).toThrow(CacheUpdateError);
  });

  it('observes an early capability failure while reset holds the admission barrier', async () => {
    // Given
    const entered = deferred();
    const release = deferred();
    class ResetStore extends MemoryStore {
      override async reset() {
        entered.resolve();
        await release.promise;
        await super.reset();
      }
    }
    const cache = new CacheService(new ResetStore(), options);
    const reset = cache.reset();
    await entered.promise;

    // When
    const update = cache.update('key', () => ({ action: 'delete' }), { maxAttempts: 0 });

    // Then: the rejection has an owner before the exclusive operation finishes.
    try {
      await expect(update).rejects.toBeInstanceOf(RangeError);
    } finally {
      release.resolve();
      await reset;
      await cache.close();
    }
  });

  it('cancels before admission and after reducer entry without detaching reducer work', async () => {
    // Given
    const cache = new CacheService(new MemoryStore(), options);
    const controller = new AbortController();
    const entered = deferred();
    const release = deferred();
    const update = cache.update('key', async () => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: 1 };
    }, { signal: controller.signal });
    const result = expect(update).rejects.toMatchObject({ code: 'cancelled' });
    await entered.promise;

    // When
    controller.abort('caller cancellation');
    release.resolve();

    // Then
    await result;
    const reducer = vi.fn(() => ({ action: 'delete' as const }));
    await expect(cache.update('key', reducer, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(reducer).not.toHaveBeenCalled();
    await expect(cache.get('key')).resolves.toBeUndefined();
  });

  it('retries from a fresh snapshot after an ordinary set conflicts', async () => {
    // Given
    const cache = new CacheService(new MemoryStore(), options);
    const entered = deferred();
    const release = deferred();
    const attempts: number[] = [];
    const update = cache.update<number>('key', async (value, { attempt }) => {
      attempts.push(attempt);
      if (attempt === 1) {
        entered.resolve();
        await release.promise;
      }
      return { action: 'set', value: (value ?? 0) + 1 };
    });
    await entered.promise;

    // When
    await cache.set('key', 10);
    release.resolve();

    // Then
    await expect(update).resolves.toBe(11);
    expect(attempts).toEqual([1, 2]);
  });

  it('rejects exhausted conflicts and invalid retry bounds', async () => {
    // Given
    const cache = new CacheService(new MemoryStore(), options);
    const entered = deferred();
    const release = deferred();
    const update = cache.update('key', async () => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: 1 };
    }, { maxAttempts: 1 });
    const rejected = expect(update).rejects.toMatchObject({ code: 'conflict' });
    await entered.promise;

    // When
    await cache.set('key', 10);
    release.resolve();

    // Then
    await rejected;
    await expect(cache.get('key')).resolves.toBe(10);
    for (const maxAttempts of [0, -1, 1.5, Infinity]) {
      await expect(cache.update('key', () => ({ action: 'delete' }), { maxAttempts })).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('exports discriminated mutation types and an optional structural capability', () => {
    // Given / When / Then
    expectTypeOf<Extract<CacheUpdate<number>, { action: 'set' }>['value']>().toEqualTypeOf<number>();
    expectTypeOf<CacheUpdateOptions['signal']>().toEqualTypeOf<AbortSignal | undefined>();
    expectTypeOf<CacheUpdateContext['attempt']>().toEqualTypeOf<number>();
    expectTypeOf<CacheAtomicUpdate['scope']>().toEqualTypeOf<'local-process' | 'distributed'>();
    expectTypeOf<CacheStore['atomicUpdate']>().toEqualTypeOf<CacheAtomicUpdate | undefined>();
    expectTypeOf<Parameters<NonNullable<RedisCompatibleClient['duplicate']>>[0]>().toEqualTypeOf<{
      lazyConnect: boolean;
      retryStrategy: () => null;
      reconnectOnError: () => false;
    }>();
  });
});
