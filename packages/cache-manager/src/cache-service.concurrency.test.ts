import { describe, expect, it } from 'vitest';

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

async function awaitSignal(signal: Promise<void>, description: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}.`));
    }, 1_000);
  });

  try {
    await Promise.race([signal, bound]);
  } finally {
    clearTimeout(timeout);
  }
}

describe('CacheService store operation concurrency', () => {
  it('starts an unrelated key read while another key read is still pending', async () => {
    // Given
    const events: string[] = [];
    const slowGetStarted = createDeferred<void>();
    const slowGet = createDeferred<undefined>();
    const store: CacheStore = {
      async del() {},
      async get<T>(key: string) {
        events.push(`get:start:${key}`);

        if (key === 'slow') {
          slowGetStarted.resolve();
          await slowGet.promise;
        }

        events.push(`get:end:${key}`);
        return undefined as T | undefined;
      },
      async reset() {},
      async set() {},
    };
    const cache = new CacheService(store, cacheOptions);
    const pendingSlowGet = cache.get('slow');

    await awaitSignal(slowGetStarted.promise, 'the slow store get to start');
    expect(events).toEqual(['get:start:slow']);

    // When
    const pendingFastGet = cache.get('fast');

    // Then
    await expect(pendingFastGet).resolves.toBeUndefined();
    expect(events).toEqual(['get:start:slow', 'get:start:fast', 'get:end:fast']);

    slowGet.resolve(undefined);
    await expect(pendingSlowGet).resolves.toBeUndefined();
  });

  it('starts an unrelated key write and delete while another key write is still pending', async () => {
    // Given
    const events: string[] = [];
    const slowSetStarted = createDeferred<void>();
    const slowSet = createDeferred<void>();
    const store: CacheStore = {
      async del(key: string) {
        events.push(`del:${key}`);
      },
      async get<T>() {
        return undefined as T | undefined;
      },
      async reset() {},
      async set(key: string) {
        events.push(`set:start:${key}`);

        if (key === 'slow') {
          slowSetStarted.resolve();
          await slowSet.promise;
        }

        events.push(`set:end:${key}`);
      },
    };
    const cache = new CacheService(store, cacheOptions);
    const pendingSlowSet = cache.set('slow', 'value');

    await awaitSignal(slowSetStarted.promise, 'the slow store set to start');
    expect(events).toEqual(['set:start:slow']);

    // When
    const pendingFastSet = cache.set('fast', 'value');
    const pendingDelete = cache.del('other');

    // Then
    await Promise.all([pendingFastSet, pendingDelete]);
    expect(events).toEqual(['set:start:slow', 'set:start:fast', 'set:end:fast', 'del:other']);

    slowSet.resolve();
    await pendingSlowSet;
    expect(events).toEqual([
      'set:start:slow',
      'set:start:fast',
      'set:end:fast',
      'del:other',
      'set:end:slow',
    ]);
  });

  it('keeps a failed store operation from blocking later unrelated operations', async () => {
    // Given
    const failure = new Error('store get failed');
    const events: string[] = [];
    const store: CacheStore = {
      async del() {},
      async get<T>(key: string) {
        if (key === 'boom') {
          throw failure;
        }

        events.push(`get:${key}`);
        return undefined as T | undefined;
      },
      async reset() {},
      async set() {},
    };
    const cache = new CacheService(store, cacheOptions);

    // When
    const failing = cache.get('boom');

    // Then
    await expect(failing).rejects.toBe(failure);
    await expect(cache.get('ok')).resolves.toBeUndefined();
    expect(events).toEqual(['get:ok']);
  });
});
