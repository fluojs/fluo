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
