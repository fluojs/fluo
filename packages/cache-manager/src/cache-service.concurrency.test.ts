import { describe, expect, it, vi } from 'vitest';

import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

const cacheOptions: NormalizedCacheModuleOptions = {
  rememberCacheErrors: 'throw',
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
  it('remember bypass releases invalidated read cycles across key churn and reset generations', async () => {
    const backing = new MemoryStore();
    let gates: Array<{ entered: Deferred<void>; release: Deferred<void> }> = [];
    const store: CacheStore = {
      async get<T>(key: string) {
        const gate = gates.shift();
        if (gate) {
          gate.entered.resolve();
          await gate.release.promise;
          throw new Error('read failed');
        }
        return backing.get<T>(key);
      },
      set: (key, value, ttl) => backing.set(key, value, ttl),
      del: (key) => backing.del(key),
      reset: () => backing.reset(),
    };
    const cache = new CacheService(store, { ...cacheOptions, rememberCacheErrors: 'bypass' });

    try {
      for (let index = 0; index < 20; index += 1) {
        const key = `churn:${index}`;
        const firstGate = { entered: createDeferred<void>(), release: createDeferred<void>() };
        const secondGate = { entered: createDeferred<void>(), release: createDeferred<void>() };
        gates = [firstGate, secondGate];
        const first = cache.remember(key, async () => 'first');
        const second = cache.remember(key, async () => 'second');
        const settled = Promise.allSettled([first, second]);

        try {
          await awaitSignal(
            Promise.all([firstGate.entered.promise, secondGate.entered.promise]).then(() => undefined),
            'both failing reads',
          );
          await cache.del(key);
          firstGate.release.resolve();
          await expect(first).resolves.toBe('first');
          // This pending read must retain del's marker after the first loader settles.
          secondGate.release.resolve();
          await expect(second).resolves.toBe('second');
          await expect(backing.get(key)).resolves.toBeUndefined();
          for (const field of ['inflight', 'pendingLoads', 'pendingInvalidations']) {
            expect(Reflect.get(cache, field)).toEqual(new Map());
          }
          expect(Reflect.get(cache, 'invalidatedInflight')).toEqual(new Set());
          await expect(cache.remember(key, async () => 'fresh')).resolves.toBe('fresh');
          await expect(backing.get(key)).resolves.toBe('fresh');
          await cache.reset();
        } finally {
          firstGate.release.resolve();
          secondGate.release.resolve();
          await settled;
        }
      }
    } finally {
      await cache.close();
    }
  });

  it.each([false, true])('remember bypass coalesces mixed reads and shares only write errors (write fails=%s)', async (writeFails) => {
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const readError = new Error('private read');
    const writeError = new Error('private write');
    const observations: Array<{ operation: string; outcome: string; durationMs: number }> = [];
    let reads = 0;
    const store: CacheStore = {
      get() {
        reads += 1;
        return reads === 1 ? Promise.reject(readError) : Promise.resolve(undefined);
      },
      async set() {
        entered.resolve();
        await release.promise;
        if (writeFails) throw writeError;
      },
      async del() {},
      async reset() {},
    };
    const cache = new CacheService(store, {
      ...cacheOptions, rememberCacheErrors: 'bypass',
      observer: { onCacheOperation: (event) => { observations.push(event); } },
    });
    const loader = vi.fn(async () => 'private value');
    const first = cache.remember('private key', loader);
    const firstSettled = Promise.allSettled([first]);
    const second = cache.remember('private key', loader);
    const secondSettled = Promise.allSettled([second]);

    try {
      await awaitSignal(entered.promise, 'shared store write');
      release.resolve();

      expect(await firstSettled).toEqual([{ status: 'fulfilled', value: 'private value' }]);
      expect(await secondSettled).toEqual([{ status: 'fulfilled', value: 'private value' }]);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(observations).toEqual([
        { operation: 'remember', outcome: 'error', durationMs: expect.any(Number) },
        { operation: 'remember', outcome: writeFails ? 'error' : 'miss', durationMs: expect.any(Number) },
      ]);
    } finally {
      release.resolve();
      await Promise.all([firstSettled, secondSettled]);
      await cache.close();
    }
  });

  it.each(['del', 'reset', 'close', 'cleanup failure'] as const)(
    'remember bypass preserves invalidation after a mutating rejected write during %s',
    async (boundary) => {
      const backing = new MemoryStore();
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const writeError = new Error('write failed after mutation');
      const cleanupError = new Error('cleanup failed');
      const events: string[] = [];
      let deletes = 0;
      const store: CacheStore = {
        get: (key) => backing.get(key),
        async set(key, value, ttl) {
          if (value === 'stale') {
            entered.resolve();
            await release.promise;
            await backing.set(key, value, ttl);
            events.push('write failed');
            throw writeError;
          }
          events.push('fresh write');
          await backing.set(key, value, ttl);
        },
        async del(key) {
          deletes += 1;
          if (boundary === 'cleanup failure' && deletes === 2) throw cleanupError;
          await backing.del(key);
        },
        async reset() { events.push('reset'); await backing.reset(); },
        async close() { events.push('close'); },
      };
      const cache = new CacheService(store, { ...cacheOptions, rememberCacheErrors: 'bypass' });
      const pending = cache.remember('key', async () => 'stale');
      const settled = Promise.allSettled([pending]);
      const lifecycle: Promise<unknown>[] = [];

      try {
        await awaitSignal(entered.promise, 'the stale store write');
        await cache.del('key');
        if (boundary === 'reset') {
          lifecycle.push(cache.reset(), cache.set('key', 'fresh'));
        } else if (boundary === 'close') {
          const close = cache.close();
          expect(cache.close()).toBe(close);
          lifecycle.push(close);
        }
        release.resolve();
        await Promise.all(lifecycle);

        expect(await settled).toEqual([boundary === 'cleanup failure'
          ? { status: 'rejected', reason: cleanupError }
          : { status: 'fulfilled', value: 'stale' }]);
        if (boundary === 'del') {
          await expect(backing.get('key')).resolves.toBeUndefined();
          expect(deletes).toBe(2);
        } else if (boundary === 'reset') {
          await expect(backing.get('key')).resolves.toBe('fresh');
          expect(events).toEqual(['write failed', 'reset', 'fresh write']);
          expect(deletes).toBe(1);
        } else if (boundary === 'close') {
          expect(events).toEqual(['write failed', 'close']);
          expect(deletes).toBe(1);
        }
      } finally {
        release.resolve();
        await Promise.allSettled([settled, ...lifecycle]);
        await cache.close();
      }
    },
  );

  it.each(['del', 'reset', 'close'] as const)('remember bypass suppresses late writes after pending read %s', async (boundary) => {
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const loaderEntered = createDeferred<void>();
    const loaderRelease = createDeferred<void>();
    const events: string[] = [];
    const store: CacheStore = {
      async get() {
        entered.resolve();
        await release.promise;
        events.push('read failed');
        throw new Error('read failure');
      },
      set: vi.fn(async () => undefined),
      async del() {},
      async reset() { events.push('reset'); },
      async close() { events.push('close'); },
    };
    const cache = new CacheService(store, { ...cacheOptions, rememberCacheErrors: 'bypass' });
    const pending = cache.remember('key', async () => {
      loaderEntered.resolve();
      await loaderRelease.promise;
      return 'loaded';
    });
    const settled = Promise.allSettled([pending]);
    let boundaryDone: Promise<void> | undefined;

    try {
      await awaitSignal(entered.promise, 'pending store read');
      boundaryDone = boundary === 'del' ? cache.del('key') : cache[boundary]();
      release.resolve();
      await boundaryDone;
      await awaitSignal(loaderEntered.promise, 'origin loader');
      // Close/reset drain the store read, not this still-pending origin loader.
      loaderRelease.resolve();

      expect(await settled).toEqual([{ status: 'fulfilled', value: 'loaded' }]);
      expect(store.set).not.toHaveBeenCalled();
      expect(events).toEqual(boundary === 'del' ? ['read failed'] : ['read failed', boundary]);
    } finally {
      release.resolve();
      loaderRelease.resolve();
      await Promise.allSettled([settled, boundaryDone]);
      await cache.close();
    }
  });

  it.each(['loader', 'store.set'] as const)(
    'remember preserves a post-reset set when old work is paused in %s',
    async (pauseAt) => {
      const backing = new MemoryStore();
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      const store: CacheStore = {
        get: (key) => backing.get(key),
        del: (key) => backing.del(key),
        reset: () => backing.reset(),
        async set(key, value, ttl) {
          if (pauseAt === 'store.set' && value === 'old') {
            entered.resolve();
            await release.promise;
          }
          await backing.set(key, value, ttl);
        },
      };
      const cache = new CacheService(store, cacheOptions);
      const old = cache.remember('key', async () => {
        if (pauseAt === 'loader') {
          entered.resolve();
          await release.promise;
        }
        return 'old';
      });
      const pending: Promise<unknown>[] = [old];

      try {
        await awaitSignal(entered.promise, `old remember to enter ${pauseAt}`);
        const reset = cache.reset();
        const fresh = cache.set('key', 'fresh');
        pending.push(reset, fresh);
        release.resolve();

        await Promise.all(pending);
        await expect(old).resolves.toBe('old');
        await expect(cache.get('key')).resolves.toBe('fresh');
      } finally {
        release.resolve();
        await Promise.allSettled(pending);
        await cache.close();
      }
    },
  );

  it('remember removes a stale write when del runs during store.set without a reset', async () => {
    const backing = new MemoryStore();
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    const store: CacheStore = {
      get: (key) => backing.get(key),
      del: (key) => backing.del(key),
      reset: () => backing.reset(),
      async set(key, value, ttl) {
        entered.resolve();
        await release.promise;
        await backing.set(key, value, ttl);
      },
    };
    const cache = new CacheService(store, cacheOptions);
    const pending = cache.remember('key', async () => 'stale');

    try {
      await awaitSignal(entered.promise, 'the remember write to start');
      await cache.del('key');
      release.resolve();

      await expect(pending).resolves.toBe('stale');
      await expect(cache.get('key')).resolves.toBeUndefined();
    } finally {
      release.resolve();
      await Promise.allSettled([pending]);
      await cache.close();
    }
  });

  it.each(['hit', 'rejection'] as const)(
    'remember reclaims del bookkeeping after overlapping %s reads across key churn',
    async (outcome) => {
      const backing = new MemoryStore();
      const failure = new Error('store get failed');
      let gates: Array<{ entered: Deferred<void>; release: Deferred<void> }> = [];
      const store: CacheStore = {
        async get<T>(key: string) {
          const gate = gates.shift();
          if (gate) {
            gate.entered.resolve();
            await gate.release.promise;
            if (outcome === 'rejection') throw failure;
            return 'cached' as T;
          }
          return backing.get<T>(key);
        },
        del: (key) => backing.del(key),
        reset: () => backing.reset(),
        set: (key, value, ttl) => backing.set(key, value, ttl),
      };
      const cache = new CacheService(store, cacheOptions);

      try {
        for (let index = 0; index < 20; index += 1) {
          const key = `churn:${index}`;
          const firstGate = { entered: createDeferred<void>(), release: createDeferred<void>() };
          const secondGate = { entered: createDeferred<void>(), release: createDeferred<void>() };
          gates = [firstGate, secondGate];
          const unusedLoader = vi.fn(async () => 'unused');
          const first = cache.remember(key, unusedLoader);
          const second = cache.remember(key, unusedLoader);
          const firstSettled = Promise.allSettled([first]);
          const secondSettled = Promise.allSettled([second]);

          try {
            await awaitSignal(
              Promise.all([firstGate.entered.promise, secondGate.entered.promise]).then(() => undefined),
              'both overlapping reads to start',
            );
            await cache.del(key);
            firstGate.release.resolve();
            const expected = outcome === 'hit'
              ? { status: 'fulfilled', value: 'cached' }
              : { status: 'rejected', reason: failure };
            expect(await firstSettled).toEqual([expected]);
            secondGate.release.resolve();
            expect(await secondSettled).toEqual([expected]);
            expect(unusedLoader).not.toHaveBeenCalled();
            for (const field of ['inflight', 'pendingLoads', 'pendingInvalidations']) {
              expect(Reflect.get(cache, field)).toEqual(new Map());
            }
            expect(Reflect.get(cache, 'invalidatedInflight')).toEqual(new Set());

            const loader = vi.fn(async () => 'fresh');
            await expect(cache.remember(key, loader)).resolves.toBe('fresh');
            await expect(cache.get(key)).resolves.toBe('fresh');
            expect(loader).toHaveBeenCalledTimes(1);
          } finally {
            firstGate.release.resolve();
            secondGate.release.resolve();
            await Promise.all([firstSettled, secondSettled]);
          }
        }
      } finally {
        await cache.close();
      }
    },
  );

  it.each(['before reads settle', 'while the first loader runs'] as const)(
    'remember retains del invalidation for a later pending miss when deleted %s',
    async (deleteAt) => {
      const backing = new MemoryStore();
      const firstRead = createDeferred<void>();
      const secondRead = createDeferred<void>();
      const readsEntered = createDeferred<void>();
      const loaderEntered = createDeferred<void>();
      const loaderRelease = createDeferred<void>();
      let reads = 0;
      const store: CacheStore = {
        async get<T>(key: string) {
          reads += 1;
          if (reads <= 2) {
            const release = reads === 1 ? firstRead : secondRead;
            if (reads === 2) readsEntered.resolve();
            await release.promise;
            return undefined;
          }
          return backing.get<T>(key);
        },
        del: (key) => backing.del(key),
        reset: () => backing.reset(),
        set: (key, value, ttl) => backing.set(key, value, ttl),
      };
      const cache = new CacheService(store, cacheOptions);
      const first = cache.remember('key', async () => {
        loaderEntered.resolve();
        await loaderRelease.promise;
        return 'first';
      });
      const second = cache.remember('key', async () => 'second');

      try {
        await awaitSignal(readsEntered.promise, 'both pending misses to start');
        if (deleteAt === 'before reads settle') await cache.del('key');
        firstRead.resolve();
        await awaitSignal(loaderEntered.promise, 'the first loader to start');
        if (deleteAt === 'while the first loader runs') await cache.del('key');
        loaderRelease.resolve();
        await expect(first).resolves.toBe('first');
        secondRead.resolve();

        await expect(second).resolves.toBe('second');
        await expect(cache.get('key')).resolves.toBeUndefined();
        await expect(cache.remember('key', async () => 'fresh')).resolves.toBe('fresh');
        await expect(cache.get('key')).resolves.toBe('fresh');
      } finally {
        firstRead.resolve();
        secondRead.resolve();
        loaderRelease.resolve();
        await Promise.allSettled([first, second]);
        await cache.close();
      }
    },
  );

  it('remember keeps a live invalidated loader when an overlapping hit settles', async () => {
    const backing = new MemoryStore();
    const readEntered = createDeferred<void>();
    const readRelease = createDeferred<void>();
    const loaderEntered = createDeferred<void>();
    const loaderRelease = createDeferred<void>();
    let reads = 0;
    const store: CacheStore = {
      async get<T>(key: string) {
        reads += 1;
        if (reads === 1) {
          readEntered.resolve();
          await readRelease.promise;
          return 'cached' as T;
        }
        return backing.get<T>(key);
      },
      del: (key) => backing.del(key),
      reset: () => backing.reset(),
      set: (key, value, ttl) => backing.set(key, value, ttl),
    };
    const cache = new CacheService(store, cacheOptions);
    const hit = cache.remember('key', async () => 'unused');
    const loader = vi.fn(async () => {
      loaderEntered.resolve();
      await loaderRelease.promise;
      return 'stale';
    });
    const miss = cache.remember('key', loader);
    const pending = [hit, miss];

    try {
      await awaitSignal(readEntered.promise, 'the cache hit read to start');
      await awaitSignal(loaderEntered.promise, 'the same-generation loader to start');
      await cache.del('key');
      readRelease.resolve();
      await expect(hit).resolves.toBe('cached');
      loaderRelease.resolve();

      await expect(miss).resolves.toBe('stale');
      expect(loader).toHaveBeenCalledTimes(1);
      await expect(cache.get('key')).resolves.toBeUndefined();
    } finally {
      readRelease.resolve();
      loaderRelease.resolve();
      await Promise.allSettled(pending);
      await cache.close();
    }
  });

  it.each(['throw', 'bypass'] as const)('remember keeps newer pending invalidation when an old %s generation settles', async (rememberCacheErrors) => {
    const backing = new MemoryStore();
    const oldEntered = createDeferred<void>();
    const oldRelease = createDeferred<void>();
    const newEntered = createDeferred<void>();
    const newRelease = createDeferred<void>();
    let reads = 0;
    const store: CacheStore = {
      async get<T>(key: string) {
        reads += 1;
        if (reads === 2) {
          newEntered.resolve();
          await newRelease.promise;
          if (rememberCacheErrors === 'bypass') throw new Error('read failed');
          return undefined;
        }
        return backing.get<T>(key);
      },
      del: (key) => backing.del(key),
      reset: () => backing.reset(),
      set: (key, value, ttl) => backing.set(key, value, ttl),
    };
    const cache = new CacheService(store, { ...cacheOptions, rememberCacheErrors });
    const old = cache.remember('key', async () => {
      oldEntered.resolve();
      await oldRelease.promise;
      return 'old';
    });
    const pending = [old];

    try {
      await awaitSignal(oldEntered.promise, 'the old loader to start');
      await cache.reset();
      const replacement = cache.remember('key', async () => 'replacement');
      pending.push(replacement);
      await awaitSignal(newEntered.promise, 'the new-generation read to start');
      await cache.del('key');
      oldRelease.resolve();
      await expect(old).resolves.toBe('old');
      newRelease.resolve();

      await expect(replacement).resolves.toBe('replacement');
      await expect(cache.get('key')).resolves.toBeUndefined();
      await expect(cache.remember('key', async () => 'fresh')).resolves.toBe('fresh');
      await expect(cache.get('key')).resolves.toBe('fresh');
    } finally {
      oldRelease.resolve();
      newRelease.resolve();
      await Promise.allSettled(pending);
      await cache.close();
    }
  });

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
