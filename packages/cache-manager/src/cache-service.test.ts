import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryStore } from './stores/memory-store.js';
import { RedisStore } from './stores/redis-store.js';
import { CacheService } from './service.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

const baseOptions: NormalizedCacheModuleOptions = {
  isGlobal: false,
  keyPrefix: 'fluo:cache:',
  store: 'memory',
  ttl: 0,
  httpKeyStrategy: 'route',
  principalScopeResolver: undefined,
};

class MockRedisClient {
  readonly storage = new Map<string, string>();
  private readonly expiry = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const expiresAt = this.expiry.get(key);

    if (expiresAt !== undefined && Date.now() >= expiresAt) {
      this.storage.delete(key);
      this.expiry.delete(key);
      return null;
    }

    return this.storage.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK'> {
    this.storage.set(key, value);

    const exIndex = args.indexOf('EX');

    if (exIndex >= 0) {
      const ttlSeconds = Number(args[exIndex + 1]);

      if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
        this.expiry.set(key, Date.now() + ttlSeconds * 1000);
      }
    } else {
      this.expiry.delete(key);
    }

    return 'OK';
  }

  async del(key: string, ...keys: string[]): Promise<number> {
    const allKeys = [key, ...keys];
    let deleted = 0;

    for (const current of allKeys) {
      if (this.storage.delete(current)) {
        deleted += 1;
      }
    }

    return deleted;
  }

  async scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]> {
    if (cursor !== '0') {
      return ['0', []];
    }

    const matchIndex = args.indexOf('MATCH');
    const rawPattern = matchIndex >= 0 ? args[matchIndex + 1] : '*';
    const pattern = typeof rawPattern === 'string' ? rawPattern : '*';
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;

    return ['0', Array.from(this.storage.keys()).filter((key) => key.startsWith(prefix))];
  }
}

function createCacheService(store: CacheStore, options: Partial<NormalizedCacheModuleOptions> = {}) {
  const mergedOptions: NormalizedCacheModuleOptions = {
    ...baseOptions,
    ...options,
  };

  return new CacheService(store, mergedOptions);
}

describe('CacheService — general cache contract (outside HTTP interceptor)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each([
    { name: 'MemoryStore', createStore: () => new MemoryStore() },
    {
      name: 'RedisStore',
      createStore: () => {
        const client = new MockRedisClient();
        return new RedisStore(client, { keyPrefix: 'test:' });
      },
    },
  ])('$name', ({ createStore }) => {
    it('get returns undefined for missing keys', async () => {
      const cache = createCacheService(createStore());

      await expect(cache.get('missing:key')).resolves.toBeUndefined();
    });

    it('set and get round-trip values', async () => {
      const cache = createCacheService(createStore());

      await cache.set('user:1', { id: 'u1', name: 'Alice' });
      await expect(cache.get('user:1')).resolves.toEqual({ id: 'u1', name: 'Alice' });
    });

    it('del removes a single entry', async () => {
      const cache = createCacheService(createStore());

      await cache.set('user:1', { id: 'u1' });
      await cache.set('user:2', { id: 'u2' });

      await cache.del('user:1');

      await expect(cache.get('user:1')).resolves.toBeUndefined();
      await expect(cache.get('user:2')).resolves.toEqual({ id: 'u2' });
    });

    it('reset clears all entries', async () => {
      const cache = createCacheService(createStore());

      await cache.set('a:1', 1);
      await cache.set('a:2', 2);
      await cache.set('b:1', 3);

      await cache.reset();

      await expect(cache.get('a:1')).resolves.toBeUndefined();
      await expect(cache.get('a:2')).resolves.toBeUndefined();
      await expect(cache.get('b:1')).resolves.toBeUndefined();
    });

    it('remember returns cached value on hit', async () => {
      const cache = createCacheService(createStore());
      const loader = vi.fn(async () => ({ computed: true }));

      await cache.set('key', { cached: true });

      const result = await cache.remember('key', loader);

      expect(result).toEqual({ cached: true });
      expect(loader).not.toHaveBeenCalled();
    });

    it('remember loads and caches on miss', async () => {
      const cache = createCacheService(createStore());
      const loader = vi.fn(async () => ({ computed: true }));

      const result = await cache.remember('key', loader);

      expect(result).toEqual({ computed: true });
      expect(loader).toHaveBeenCalledTimes(1);
      await expect(cache.get('key')).resolves.toEqual({ computed: true });
    });

    it('remember uses provided TTL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

      const store = createStore();
      const cache = createCacheService(store, { ttl: 0 });
      const loader = vi.fn(async () => ({ value: 'loaded' }));

      await cache.remember('key', loader, 60);

      vi.advanceTimersByTime(59_000);
      await expect(cache.get('key')).resolves.toEqual({ value: 'loaded' });

      vi.advanceTimersByTime(1_001);
      await expect(cache.get('key')).resolves.toBeUndefined();
    });

    it('does not repopulate a key when del runs while remember is still loading', async () => {
      let resolveLoader: ((value: { computed: boolean }) => void) | undefined;
      const cache = createCacheService(createStore());
      const loader = vi.fn(
        () =>
          new Promise<{ computed: boolean }>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      const pending = cache.remember('key', loader);
      await Promise.resolve();
      await cache.del('key');
      resolveLoader?.({ computed: true });

      await expect(pending).resolves.toEqual({ computed: true });
      await expect(cache.get('key')).resolves.toBeUndefined();
    });

    it('clears invalidation bookkeeping after churn across many deleted in-flight keys', async () => {
      const cache = createCacheService(createStore());
      const resolvers = new Map<string, (value: { computed: string }) => void>();

      const pendingLoads = Array.from({ length: 50 }, (_, index) => {
        const key = `key:${index}`;

        const pending = cache.remember(
          key,
          () =>
            new Promise<{ computed: string }>((resolve) => {
              resolvers.set(key, resolve);
            }),
        );

        return { key, pending };
      });

      await Promise.resolve();

      await Promise.all(pendingLoads.map(async ({ key }) => {
        await cache.del(key);
      }));

      for (const { key } of pendingLoads) {
        resolvers.get(key)?.({ computed: key });
      }

      await Promise.all(pendingLoads.map(({ pending }) => pending));

      const invalidatedInflight = Reflect.get(cache as object, 'invalidatedInflight');
      expect(invalidatedInflight).toBeInstanceOf(Set);
      expect((invalidatedInflight as Set<string>).size).toBe(0);
    });

    it('reset clears in-flight and pending load bookkeeping without repopulating stale values', async () => {
      let resolveLoader: ((value: { computed: boolean }) => void) | undefined;
      const cache = createCacheService(createStore());
      const loader = vi.fn(
        () =>
          new Promise<{ computed: boolean }>((resolve) => {
            resolveLoader = resolve;
          }),
      );

      const pending = cache.remember('key', loader);
      await vi.waitFor(() => {
        expect(loader).toHaveBeenCalledTimes(1);
      });

      await cache.reset();

      const inflight = Reflect.get(cache as object, 'inflight');
      const pendingLoads = Reflect.get(cache as object, 'pendingLoads');
      expect(inflight).toBeInstanceOf(Map);
      expect(pendingLoads).toBeInstanceOf(Map);
      expect((inflight as Map<string, Promise<unknown>>).size).toBe(0);
      expect((pendingLoads as Map<string, number>).size).toBe(0);

      resolveLoader?.({ computed: true });

      await expect(pending).resolves.toEqual({ computed: true });
      await expect(cache.get('key')).resolves.toBeUndefined();
    });

    it('set uses module default TTL when not specified', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

      const store = createStore();
      const cache = createCacheService(store, { ttl: 30 });

      await cache.set('key', { value: 'default-ttl' });

      vi.advanceTimersByTime(29_000);
      await expect(cache.get('key')).resolves.toEqual({ value: 'default-ttl' });

      vi.advanceTimersByTime(1_001);
      await expect(cache.get('key')).resolves.toBeUndefined();
    });

    it('set with explicit TTL overrides module default', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

      const store = createStore();
      const cache = createCacheService(store, { ttl: 60 });

      await cache.set('key', { value: 'override' }, 10);

      vi.advanceTimersByTime(9_000);
      await expect(cache.get('key')).resolves.toEqual({ value: 'override' });

      vi.advanceTimersByTime(1_001);
      await expect(cache.get('key')).resolves.toBeUndefined();
    });

    it('set with TTL=0 means no expiry', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

      const store = createStore();
      const cache = createCacheService(store, { ttl: 60 });

      await cache.set('key', { value: 'no-expiry' }, 0);

      vi.advanceTimersByTime(60_000);
      await expect(cache.get('key')).resolves.toEqual({ value: 'no-expiry' });
    });

    it('set with negative TTL is a no-op', async () => {
      const cache = createCacheService(createStore(), { ttl: 60 });

      await cache.set('key', { value: 'should-not-store' }, -1);

      await expect(cache.get('key')).resolves.toBeUndefined();
    });

    it('set with non-finite TTL is a no-op', async () => {
      const cache = createCacheService(createStore(), { ttl: 60 });

      await cache.set('key', { value: 'nan' }, Number.NaN);
      await cache.set('key2', { value: 'infinity' }, Number.POSITIVE_INFINITY);

      await expect(cache.get('key')).resolves.toBeUndefined();
      await expect(cache.get('key2')).resolves.toBeUndefined();
    });

    it('handles complex nested objects', async () => {
      const cache = createCacheService(createStore());

      const complexObject = {
        users: [
          { id: 1, name: 'Alice', roles: ['admin', 'user'] },
          { id: 2, name: 'Bob', roles: ['user'] },
        ],
        metadata: {
          total: 2,
          page: 1,
          filters: { active: true },
        },
        tags: ['cache', 'test'],
      };

      await cache.set('complex', complexObject);
      await expect(cache.get('complex')).resolves.toEqual(complexObject);
    });

    it('does not leak cached object mutations back into subsequent reads', async () => {
      const cache = createCacheService(createStore());
      const complexObject = {
        metadata: { total: 2 },
        users: [{ id: 1, name: 'Alice' }],
      };

      await cache.set('complex', complexObject);
      complexObject.metadata.total = 99;

      const firstRead = await cache.get<typeof complexObject>('complex');
      expect(firstRead).toEqual({
        metadata: { total: 2 },
        users: [{ id: 1, name: 'Alice' }],
      });

      if (!firstRead) {
        throw new Error('Expected cached value to be defined.');
      }

      firstRead.users[0]!.name = 'Bob';

      await expect(cache.get('complex')).resolves.toEqual({
        metadata: { total: 2 },
        users: [{ id: 1, name: 'Alice' }],
      });
    });

    it('handles multiple independent key namespaces', async () => {
      const cache = createCacheService(createStore());

      await cache.set('user:1', { id: 1 });
      await cache.set('order:1', { id: 1 });
      await cache.set('product:1', { id: 1 });

      await cache.del('user:1');

      await expect(cache.get('user:1')).resolves.toBeUndefined();
      await expect(cache.get('order:1')).resolves.toEqual({ id: 1 });
      await expect(cache.get('product:1')).resolves.toEqual({ id: 1 });
    });
  });

  it('closes a resource-owning store once through the cache service lifecycle hook', async () => {
    class ResourceStore extends MemoryStore {
      close = vi.fn(async () => undefined);
    }

    const store = new ResourceStore();
    const cache = createCacheService(store);

    await cache.onModuleDestroy();
    await cache.close();

    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('accepts dispose as a store teardown alias when close is absent', async () => {
    class DisposableStore extends MemoryStore {
      dispose = vi.fn(async () => undefined);
    }

    const store = new DisposableStore();
    const cache = createCacheService(store);

    await cache.close();

    expect(store.dispose).toHaveBeenCalledTimes(1);
  });
});
