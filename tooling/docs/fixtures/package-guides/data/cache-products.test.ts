import { type CacheObservation, CacheService } from '@fluojs/cache-manager';
import { FluoFactory } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { createProductsApp, createRecordingStore } from './cache-products.example';

/**
 * Guide fixtures for the Cache manager package guide
 * (apps/docs/content/docs/packages/cache-manager.mdx) - memory-store paths.
 *
 * Evidence scope: these tests run the real CacheModule, CacheService,
 * interceptor, decorators, TTL jitter, and memory store. They do not touch a
 * Redis server; Redis-backed claims are covered by cache-redis.integration.test.ts
 * and the package-owned native suite (packages/cache-manager/test/).
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('cache-manager guide fixtures: read-through remembering', () => {
  it('coalesces concurrent misses into one loader run and serves later calls from the cache', async () => {
    const { ProductsModule, ProductsService } = createProductsApp();
    const context = await FluoFactory.createApplicationContext(ProductsModule);

    try {
      const service = await context.get(ProductsService);
      const entered = deferred();
      const release = deferred();
      let loaderRuns = 0;
      const load = async () => {
        loaderRuns += 1;
        entered.resolve();
        await release.promise;
        return [{ id: 1, name: 'Product A' }] as const;
      };

      const first = service.rememberCatalog(load);
      const second = service.rememberCatalog(load);
      await entered.promise;
      release.resolve();

      const rows = await Promise.all([first, second]);
      expect(rows).toEqual([
        [{ id: 1, name: 'Product A' }],
        [{ id: 1, name: 'Product A' }],
      ]);
      expect(service.loaderRuns).toBe(2);
      expect(loaderRuns).toBe(1);

      // A later call is a cache hit: the loader does not run again.
      await service.rememberCatalog(load);
      expect(loaderRuns).toBe(1);
    } finally {
      await context.close();
    }
  });

  it('invalidates an in-flight remember loader across reset so stale entries cannot repopulate', async () => {
    const { ProductsModule } = createProductsApp();
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);

    try {
      const entered = deferred();
      const release = deferred();
      const load = async () => {
        entered.resolve();
        await release.promise;
        return [{ id: 1, name: 'Product A' }] as const;
      };

      const pending = cache.remember('products:all', load, 300);
      await entered.promise;
      await cache.reset();
      release.resolve();
      await pending;

      await expect(cache.get('products:all')).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });
});

describe('cache-manager guide fixtures: writes, deletes, and lifecycle', () => {
  it('skips invalid TTL writes and treats 0 as a persistent entry', async () => {
    const { ProductsModule } = createProductsApp();
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);

    try {
      await cache.set('persist', 'kept', 0);
      await expect(cache.get('persist')).resolves.toBe('kept');

      await cache.set('invalid', 'dropped', -1);
      await expect(cache.get('invalid')).resolves.toBeUndefined();

      await cache.set('finite', 'kept', 30);
      await expect(cache.get('finite')).resolves.toBe('kept');
    } finally {
      await context.close();
    }
  });

  it('closes the store through the shutdown hook; later reads miss and updates reject as closed', async () => {
    const { ProductsModule, ProductsService } = createProductsApp();
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);
    const service = await context.get(ProductsService);
    await service.incrementCounter('hits');

    await context.close();

    await expect(cache.get('hits')).resolves.toBeUndefined();
    await expect(service.incrementCounter('hits')).rejects.toThrow('closed');
  });
});

describe('cache-manager guide fixtures: atomic updates', () => {
  it('admits concurrent updates for one key in FIFO order and commits both increments', async () => {
    const { ProductsModule, ProductsService } = createProductsApp();
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);

    try {
      const service = await context.get(ProductsService);

      const results = await Promise.all([
        service.incrementCounter('example:counter'),
        service.incrementCounter('example:counter'),
      ]);

      expect(results).toEqual([1, 2]);
      await expect(cache.get('example:counter')).resolves.toBe(2);
    } finally {
      await context.close();
    }
  });

  it('re-runs a pure reducer with a fresh snapshot when a competing write replaces the entry', async () => {
    const { ProductsModule } = createProductsApp();
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);

    try {
      const entered = deferred();
      const release = deferred();
      const attempts: number[] = [];
      const update = cache.update<number>('example:counter', (value, { attempt }) => {
        attempts.push(attempt);
        if (attempt === 1) {
          entered.resolve();
          return release.promise.then(() => ({ action: 'set', value: (value ?? 0) + 1 }));
        }
        return { action: 'set', value: (value ?? 0) + 1 };
      });

      await entered.promise;
      // A competing ordinary write replaces the entry the first attempt read.
      await cache.set('example:counter', 10);
      release.resolve();

      await expect(update).resolves.toBe(11);
      expect(attempts).toEqual([1, 2]);
      await expect(cache.get('example:counter')).resolves.toBe(11);
    } finally {
      await context.close();
    }
  });

  it('rejects updates as unsupported on stores without the atomic capability', async () => {
    const store = createRecordingStore();
    const { ProductsModule } = createProductsApp({ store });
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);

    try {
      await expect(cache.update('k', () => ({ action: 'set' as const, value: 1 }))).rejects.toThrow(
        'unsupported',
      );
      expect(store.entries.size).toBe(0);
    } finally {
      await context.close();
    }
  });
});

describe('cache-manager guide fixtures: TTL jitter and observation', () => {
  it('jitters positive set TTLs once before store handoff and leaves 0 untouched', async () => {
    const store = createRecordingStore();
    const { ProductsModule } = createProductsApp({
      store,
      ttl: 60,
      ttlJitter: { ratio: 0.5, mode: 'shorten', random: () => 0.5 },
    });
    const context = await FluoFactory.createApplicationContext(ProductsModule);
    const cache = await context.get(CacheService);

    try {
      await cache.set('jittered', 'v');
      await cache.set('persistent', 'v', 0);
      await cache.set('invalid', 'v', -5);

      // shorten with sample 0.5 and ratio 0.5: 60 - 60 * 0.5 * 0.5 = 45.
      expect(store.writtenTtls).toEqual([45, 0]);
      await expect(cache.get('invalid')).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it('emits the documented observation taxonomy, never for update, and contains observer failures', async () => {
    const observations: CacheObservation[] = [];
    const { ProductsModule, ProductsService } = createProductsApp({
      observer: {
        onCacheOperation(observation) {
          observations.push(observation);
          throw new Error('observer failures are contained');
        },
      },
    });
    const context = await FluoFactory.createApplicationContext(ProductsModule);

    try {
      const service = await context.get(ProductsService);
      const cache = await context.get(CacheService);

      // remember is reported once per call; its internal read/write are not.
      await service.rememberCatalog(async () => [{ id: 1, name: 'Product A' }]);
      await service.rememberCatalog(async () => [{ id: 2, name: 'Product B' }]);
      // update emits no observations at all.
      await service.incrementCounter('example:counter');
      await cache.set('observed', 'v');
      await cache.del('observed');

      const operations = observations.map((observation) => ({
        operation: observation.operation,
        outcome: observation.outcome,
      }));

      expect(operations).toEqual([
        { operation: 'remember', outcome: 'miss' },
        { operation: 'remember', outcome: 'hit' },
        { operation: 'set', outcome: 'success' },
        { operation: 'del', outcome: 'success' },
      ]);
      expect(observations.every((observation) => typeof observation.durationMs === 'number')).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe('cache-manager guide fixtures: HTTP response caching', () => {
  it('serves the second GET from cache and evicts the entry after a successful POST', async () => {
    const { ProductsModule } = createProductsApp();
    const app = await Test.createApp({ rootModule: ProductsModule });

    try {
      const runs = async () => {
        const response = await app.request('GET', '/products/handler-runs').send();
        return (response.body as { runs: number }).runs;
      };

      await app.request('GET', '/products').send();
      await app.request('GET', '/products').send();
      // The second GET was served from cache: the handler ran once.
      expect(await runs()).toBe(1);

      const post = await app.request('POST', '/products').body({ name: 'Product B' }).send();
      expect(post.status).toBe(201);

      // @CacheEvict removed the cached listing, so the handler runs again.
      const third = await app.request('GET', '/products').send();
      expect(await runs()).toBe(2);
      expect(third.body).toEqual([{ id: 1, name: 'Product A' }, { id: 2, name: 'Product B' }]);

      // The default route+query strategy canonicalizes parameter order, so
      // reordered repeated query values share one cache entry.
      await app.request('GET', '/products').query('tag', ['b', 'a']).send();
      expect(await runs()).toBe(3);
      await app.request('GET', '/products').query('tag', ['a', 'b']).send();
      expect(await runs()).toBe(3);
    } finally {
      await app.close();
    }
  });
});
