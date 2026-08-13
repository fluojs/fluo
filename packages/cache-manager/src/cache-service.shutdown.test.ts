import { describe, expect, it, vi } from 'vitest';

import { CacheService } from './service.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

const cacheOptions: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 0,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolveDeferred) {
        throw new Error('Deferred resolver was not initialized.');
      }

      resolveDeferred(value);
    },
  };
}

describe('CacheService shutdown ordering', () => {
  it('shares teardown completion across concurrent and repeated close callers', async () => {
    // Given
    const closeDeferred = createDeferred<void>();
    const close = vi.fn(() => closeDeferred.promise);
    const store: CacheStore = {
      close,
      async del() {},
      async get() {
        return undefined;
      },
      async reset() {},
      async set() {},
    };
    const cache = new CacheService(store, cacheOptions);

    // When
    const firstClose = cache.close();
    const concurrentLifecycleClose = cache.onModuleDestroy();

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
    const sharedConcurrentCompletion = concurrentLifecycleClose === firstClose;
    closeDeferred.resolve();
    await Promise.all([firstClose, concurrentLifecycleClose]);
    const repeatedClose = cache.close();

    // Then
    expect(sharedConcurrentCompletion).toBe(true);
    expect(repeatedClose).toBe(firstClose);
    await expect(repeatedClose).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shares teardown failure across concurrent and repeated close callers', async () => {
    // Given
    const failure = new Error('store close failed');
    const close = vi.fn(async () => {
      throw failure;
    });
    const store: CacheStore = {
      close,
      async del() {},
      async get() {
        return undefined;
      },
      async reset() {},
      async set() {},
    };
    const cache = new CacheService(store, cacheOptions);

    // When
    const firstClose = cache.close();
    const concurrentLifecycleClose = cache.onModuleDestroy();
    const concurrentResults = await Promise.allSettled([firstClose, concurrentLifecycleClose]);
    const repeatedClose = cache.close();

    // Then
    expect(concurrentLifecycleClose).toBe(firstClose);
    expect(concurrentResults).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(repeatedClose).toBe(firstClose);
    await expect(repeatedClose).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight store get before closing the store exactly once', async () => {
    // Given
    const events: string[] = [];
    const getDeferred = createDeferred<undefined>();
    const close = vi.fn(async () => {
      events.push('close');
    });
    const store: CacheStore = {
      close,
      async del() {},
      async get() {
        events.push('get:start');
        await getDeferred.promise;
        events.push('get:end');
        return undefined;
      },
      async reset() {},
      async set() {},
    };
    const cache = new CacheService(store, cacheOptions);
    const pendingGet = cache.get('key');

    await vi.waitFor(() => {
      expect(events).toEqual(['get:start']);
    });

    // When
    const pendingClose = cache.close();
    await Promise.resolve();

    // Then
    expect(close).not.toHaveBeenCalled();

    getDeferred.resolve(undefined);
    await expect(pendingGet).resolves.toBeUndefined();
    await pendingClose;
    await cache.close();

    expect(events).toEqual(['get:start', 'get:end', 'close']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight store set before disposing the store exactly once', async () => {
    // Given
    const events: string[] = [];
    const setDeferred = createDeferred<void>();
    const dispose = vi.fn(async () => {
      events.push('dispose');
    });
    const store: CacheStore = {
      async del() {},
      dispose,
      async get() {
        return undefined;
      },
      async reset() {},
      async set() {
        events.push('set:start');
        await setDeferred.promise;
        events.push('set:end');
      },
    };
    const cache = new CacheService(store, cacheOptions);
    const pendingSet = cache.set('key', 'value');

    await vi.waitFor(() => {
      expect(events).toEqual(['set:start']);
    });

    // When
    const pendingClose = cache.close();
    await Promise.resolve();

    // Then
    expect(dispose).not.toHaveBeenCalled();

    setDeferred.resolve();
    await pendingSet;
    await pendingClose;
    await cache.close();

    expect(events).toEqual(['set:start', 'set:end', 'dispose']);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
