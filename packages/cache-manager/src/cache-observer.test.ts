import { Controller, type FrameworkRequest, type FrameworkResponse, Get, UseInterceptors } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import type { CacheObservation, CacheObserver, CacheStore, NormalizedCacheModuleOptions } from './types.js';

const baseOptions: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  observer: undefined,
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 60,
};

function createRecordingObserver(): { observations: CacheObservation[]; observer: CacheObserver } {
  const observations: CacheObservation[] = [];

  return {
    observations,
    observer: {
      onCacheOperation(observation) {
        observations.push(observation);
      },
    },
  };
}

function createCacheService(observer: CacheObserver | undefined, store: CacheStore = new MemoryStore()) {
  return new CacheService(store, { ...baseOptions, observer });
}

class ResourceStore extends MemoryStore {
  readonly close = vi.fn(async () => undefined);
}

class FailingStore implements CacheStore {
  async get<T>(_key: string): Promise<T | undefined> {
    throw new Error('store get failed');
  }

  async set<T>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {
    throw new Error('store set failed');
  }

  async del(_key: string): Promise<void> {
    throw new Error('store del failed');
  }

  async reset(): Promise<void> {
    throw new Error('store reset failed');
  }
}

describe('CacheService cache observation', () => {
  it('reports get miss then hit outcomes when an observer is configured', async () => {
    // Given: a cache service with a recording observer and one cached entry.
    const { observations, observer } = createRecordingObserver();
    const cache = createCacheService(observer);

    // When: a missing key is read, written, and read again.
    await cache.get('user:1');
    await cache.set('user:1', { id: 'u1' });
    await cache.get('user:1');

    // Then: each operation is observed with its own outcome.
    expect(observations.map((observation) => [observation.operation, observation.outcome])).toEqual([
      ['get', 'miss'],
      ['set', 'success'],
      ['get', 'hit'],
    ]);
  });

  it('reports remember load and hit outcomes without exposing keys or values', async () => {
    // Given: a cache service with a recording observer.
    const { observations, observer } = createRecordingObserver();
    const cache = createCacheService(observer);

    // When: the same key is loaded through remember twice.
    await cache.remember('report:daily', async () => ({ total: 1 }));
    await cache.remember('report:daily', async () => ({ total: 2 }));

    // Then: the loader miss and the later hit are observed, and no payload leaks into observations.
    const rememberOutcomes = observations
      .filter((observation) => observation.operation === 'remember')
      .map((observation) => observation.outcome);

    expect(rememberOutcomes).toEqual(['miss', 'hit']);
    expect(Object.keys(observations[0] ?? {}).sort()).toEqual(['durationMs', 'operation', 'outcome']);
  });

  it('reports each concurrent remember caller as a miss while sharing one loader', async () => {
    // Given: two concurrent callers using the same loader.
    const { observations, observer } = createRecordingObserver();
    const cache = createCacheService(observer);
    const loader = vi.fn(async () => 'loaded');

    // When: both calls overlap through the serialized store-read boundary.
    await Promise.all([
      cache.remember('shared', loader),
      cache.remember('shared', loader),
    ]);

    // Then: both caller-level operations are misses and the loader ran once.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(observations.map(({ operation, outcome }) => [operation, outcome])).toEqual([
      ['remember', 'miss'],
      ['remember', 'miss'],
    ]);
  });

  it('reports del and reset success outcomes', async () => {
    // Given: a cache service with a recording observer and one cached entry.
    const { observations, observer } = createRecordingObserver();
    const cache = createCacheService(observer);
    await cache.set('user:1', { id: 'u1' });

    // When: the entry is deleted and the store is reset.
    await cache.del('user:1');
    await cache.reset();

    // Then: both invalidation operations are observed as successful.
    expect(observations.map((observation) => [observation.operation, observation.outcome])).toEqual([
      ['set', 'success'],
      ['del', 'success'],
      ['reset', 'success'],
    ]);
  });

  it('reports non-negative numeric durations for every observation', async () => {
    // Given: a cache service with a recording observer.
    const { observations, observer } = createRecordingObserver();
    const cache = createCacheService(observer);

    // When: one write and one read run.
    await cache.set('user:1', { id: 'u1' });
    await cache.get('user:1');

    // Then: every observation carries a finite non-negative duration.
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(Number.isFinite(observation.durationMs)).toBe(true);
      expect(observation.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports error outcomes while preserving documented store failure propagation', async () => {
    // Given: a cache service backed by a store that always throws.
    const { observations, observer } = createRecordingObserver();
    const cache = createCacheService(observer, new FailingStore());

    // When: a read runs against the failing store.
    await expect(cache.get('user:1')).rejects.toThrow('store get failed');

    // Then: the failure is observed as an error outcome.
    expect(observations).toEqual([
      expect.objectContaining({ operation: 'get', outcome: 'error' }),
    ]);
  });

  it('keeps cache results unchanged when the observer throws', async () => {
    // Given: a cache service whose observer always throws.
    const throwingObserver: CacheObserver = {
      onCacheOperation() {
        throw new Error('observer failed');
      },
    };
    const cache = createCacheService(throwingObserver);

    // When: a value is written and read back.
    await cache.set('user:1', { id: 'u1' });

    // Then: the observer failure never changes the cache result.
    await expect(cache.get('user:1')).resolves.toEqual({ id: 'u1' });
  });

  it('keeps cache results unchanged when the observer rejects asynchronously', async () => {
    // Given: a cache service whose observer returns a rejected promise.
    const rejectingObserver: CacheObserver = {
      onCacheOperation() {
        return Promise.reject(new Error('observer rejected'));
      },
    };
    const cache = createCacheService(rejectingObserver);

    // When: a value is written and read back.
    await cache.set('user:1', { id: 'u1' });

    // Then: the rejected observer promise never changes the cache result.
    await expect(cache.get('user:1')).resolves.toEqual({ id: 'u1' });
  });

  it('performs no observation work when no observer is configured', async () => {
    // Given: a cache service configured without an observer.
    const cache = createCacheService(undefined);

    // When: a value is written and read back.
    await cache.set('user:1', { id: 'u1' });

    // Then: the default path still returns cached values.
    await expect(cache.get('user:1')).resolves.toEqual({ id: 'u1' });
  });

  it('reports one close outcome while repeated callers share teardown', async () => {
    // Given: a resource-owning store and a recording observer.
    const { observations, observer } = createRecordingObserver();
    const store = new ResourceStore();
    const cache = createCacheService(observer, store);

    // When: close is requested twice.
    await Promise.all([cache.close(), cache.close()]);

    // Then: teardown and its observation occur once.
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(observations.map(({ operation, outcome }) => [operation, outcome])).toEqual([
      ['close', 'success'],
    ]);
  });
});

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('CacheModule observer wiring', () => {
  it('observes HTTP interceptor cache misses and hits through the real dispatch pipeline', async () => {
    // Given: an application whose cache module is configured with a recording observer.
    const { observations, observer } = createRecordingObserver();
    const listHandler = vi.fn(() => ({ count: 1 }));

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptors(CacheInterceptor)
      list() {
        return listHandler();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ observer, store: 'memory' })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: the same route is dispatched twice.
      await app.dispatch(createRequest('/products'), createResponse());
      await app.dispatch(createRequest('/products'), createResponse());

      // Then: the interceptor read path reports one miss, one write, and one hit.
      expect(listHandler).toHaveBeenCalledTimes(1);
      expect(observations.map((observation) => [observation.operation, observation.outcome])).toEqual([
        ['get', 'miss'],
        ['set', 'success'],
        ['get', 'hit'],
      ]);
    } finally {
      await app.close();
    }
  });

  it('observes store errors that the HTTP interceptor fail-soft path hides from handlers', async () => {
    // Given: an application backed by a failing store and a recording observer.
    const { observations, observer } = createRecordingObserver();

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptors(CacheInterceptor)
      list() {
        return { count: 1 };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ observer, store: new FailingStore() })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: one request is dispatched against the failing store.
      const response = createResponse();
      await app.dispatch(createRequest('/products'), response);

      // Then: the handler result still succeeds while both failures are observed.
      expect(response.body).toEqual({ count: 1 });
      expect(observations.map((observation) => [observation.operation, observation.outcome])).toEqual([
        ['get', 'error'],
        ['set', 'error'],
      ]);
    } finally {
      await app.close();
    }
  });
});
