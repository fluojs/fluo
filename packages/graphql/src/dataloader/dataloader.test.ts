import DataLoader from 'dataloader';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createDataLoaderMap,
  createRequestScopedDataLoaderFactory,
  getRequestScopedDataLoader,
  OperationScopedDataLoader,
  type RequestScopedDataLoaderAccessor,
  type ResolvedDataLoaders,
} from './dataloader.js';
import type { GraphQLContext } from '../types.js';

function createContext(): GraphQLContext {
  return {
    request: {
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/graphql',
      query: {},
      raw: {},
      url: '/graphql',
    },
  };
}

describe('request-scoped DataLoader helpers', () => {
  it('reuses loader instance for the same operation context and key', () => {
    const context = createContext();

    const first = getRequestScopedDataLoader(context, 'userById', () => ({ id: Symbol('loader') }));
    const second = getRequestScopedDataLoader(context, 'userById', () => ({ id: Symbol('loader') }));

    expect(first).toBe(second);
  });

  it('reuses a cached undefined value for the same operation context and key', () => {
    const context = createContext();
    const createLoader = vi.fn(() => undefined);

    const first = getRequestScopedDataLoader(context, 'userById', createLoader);
    const second = getRequestScopedDataLoader(context, 'userById', createLoader);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(createLoader).toHaveBeenCalledTimes(1);
  });

  it('creates isolated loader instances across different operation contexts', () => {
    const contextA = createContext();
    const contextB = createContext();

    const loaderA = getRequestScopedDataLoader(contextA, 'userById', () => ({ id: Symbol('loader') }));
    const loaderB = getRequestScopedDataLoader(contextB, 'userById', () => ({ id: Symbol('loader') }));

    expect(loaderA).not.toBe(loaderB);
  });

  it('supports pre-bound factory helper', () => {
    const context = createContext();
    const getUserLoader = createRequestScopedDataLoaderFactory('userById', () => ({ id: Symbol('loader') }));

    const first = getUserLoader(context);
    const second = getUserLoader(context);

    expect(first).toBe(second);
  });
});

describe('OperationScopedDataLoader.create', () => {
  it('returns a request-scoped DataLoader through the public accessor', async () => {
    const db = new Map<string, string>([
      ['1', 'Alice'],
      ['2', 'Bob'],
      ['3', 'Charlie'],
    ]);

    const batchFn = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => db.get(id) ?? null),
    );

    const getUserById = OperationScopedDataLoader.create<string, string | null>(batchFn);

    const context = createContext();
    const loader = getUserById(context);

    expect(loader).toBeInstanceOf(DataLoader);

    const [alice, bob] = await Promise.all([loader.load('1'), loader.load('2')]);

    expect(alice).toBe('Alice');
    expect(bob).toBe('Bob');
    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith(['1', '2']);
  });

  it('reuses the same DataLoader instance within a single operation context', () => {
    const getUserById = OperationScopedDataLoader.create<string, string | null>(async (ids) =>
      ids.map(() => null),
    );

    const context = createContext();
    const first = getUserById(context);
    const second = getUserById(context);

    expect(first).toBe(second);
  });

  it('creates isolated DataLoader instances across different operation contexts', () => {
    const getUserById = OperationScopedDataLoader.create<string, string | null>(async (ids) =>
      ids.map(() => null),
    );

    const contextA = createContext();
    const contextB = createContext();

    expect(getUserById(contextA)).not.toBe(getUserById(contextB));
  });

  it('batches multiple .load() calls into a single batch function invocation', async () => {
    const batchFn = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => `value-${id}`),
    );

    const getItem = OperationScopedDataLoader.create<string, string>(batchFn);
    const context = createContext();
    const loader = getItem(context);

    const results = await Promise.all([
      loader.load('a'),
      loader.load('b'),
      loader.load('c'),
    ]);

    expect(results).toEqual(['value-a', 'value-b', 'value-c']);
    expect(batchFn).toHaveBeenCalledTimes(1);
  });

  it('caches individual keys within the same operation', async () => {
    const batchFn = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => `val-${id}`),
    );

    const getItem = OperationScopedDataLoader.create<string, string>(batchFn);
    const context = createContext();
    const loader = getItem(context);

    const first = await loader.load('x');
    const second = await loader.load('x');

    expect(first).toBe('val-x');
    expect(second).toBe('val-x');
    expect(batchFn).toHaveBeenCalledTimes(1);
  });

  it('respects custom DataLoader options', async () => {
    const batchFn = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => `val-${id}`),
    );

    const getItem = OperationScopedDataLoader.create<string, string>(batchFn, { cache: false });
    const context = createContext();
    const loader = getItem(context);

    await loader.load('x');
    await loader.load('x');

    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it('supports explicit cache key for loader deduplication', () => {
    const loaderKey = Symbol('shared-loader');

    const accessorA = OperationScopedDataLoader.create<string, string>(
      async (ids) => ids.map(() => 'a'),
      { key: loaderKey },
    );
    const accessorB = OperationScopedDataLoader.create<string, string>(
      async (ids) => ids.map(() => 'b'),
      { key: loaderKey },
    );

    const context = createContext();

    expect(accessorA(context)).toBe(accessorB(context));
  });
});

describe('createDataLoaderMap', () => {
  it('returns multiple named DataLoaders from a single definition map', async () => {
    const users = new Map<string, string>([
      ['u1', 'Alice'],
      ['u2', 'Bob'],
    ]);
    const posts = new Map<string, string>([
      ['p1', 'Hello World'],
      ['p2', 'Second Post'],
    ]);

    const userBatch = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => users.get(id) ?? null),
    );
    const postBatch = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => posts.get(id) ?? null),
    );

    const loaders = createDataLoaderMap({
      userById: { batch: userBatch },
      postById: { batch: postBatch },
    });

    const context = createContext();
    const { userById, postById } = loaders(context);

    expect(userById).toBeInstanceOf(DataLoader);
    expect(postById).toBeInstanceOf(DataLoader);

    const [alice, post] = await Promise.all([
      userById.load('u1'),
      postById.load('p1'),
    ]);

    expect(alice).toBe('Alice');
    expect(post).toBe('Hello World');
    expect(userBatch).toHaveBeenCalledTimes(1);
    expect(postBatch).toHaveBeenCalledTimes(1);
  });

  it('returns the same loader instances for the same context', () => {
    const loaders = createDataLoaderMap({
      items: { batch: async (ids: readonly string[]) => ids.map(() => null) },
    });

    const context = createContext();
    const first = loaders(context);
    const second = loaders(context);

    expect(first.items).toBe(second.items);
  });

  it('isolates loaders across different operation contexts', () => {
    const loaders = createDataLoaderMap({
      items: { batch: async (ids: readonly string[]) => ids.map(() => null) },
    });

    const contextA = createContext();
    const contextB = createContext();

    expect(loaders(contextA).items).not.toBe(loaders(contextB).items);
  });
});

describe('end-to-end: N+1 batching through first-party DataLoader API', () => {
  it('batches concurrent resolver-like loads into a single DB call', async () => {
    interface User {
      id: string;
      name: string;
    }

    const database: User[] = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '3', name: 'Charlie' },
    ];

    const findManyByIds = vi.fn(async (ids: readonly string[]): Promise<(User | null)[]> => {
      const map = new Map(database.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id) ?? null);
    });

    const getUserById = OperationScopedDataLoader.create<string, User | null>(async (ids) =>
      findManyByIds(ids),
    );

    const context = createContext();

    const resolverCalls = ['1', '2', '3', '1', '2'].map((id) =>
      getUserById(context).load(id),
    );

    const results = await Promise.all(resolverCalls);

    expect(results.map((u) => u?.name)).toEqual([
      'Alice',
      'Bob',
      'Charlie',
      'Alice',
      'Bob',
    ]);

    expect(findManyByIds).toHaveBeenCalledTimes(1);
    expect(findManyByIds).toHaveBeenCalledWith(['1', '2', '3']);
  });

  it('isolates DataLoader state across concurrent operations', async () => {
    const batchFn = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => `result-${id}`),
    );

    const getItem = OperationScopedDataLoader.create<string, string>(batchFn);

    const operationA = createContext();
    const operationB = createContext();

    const [resultA, resultB] = await Promise.all([
      getItem(operationA).load('shared-key'),
      getItem(operationB).load('shared-key'),
    ]);

    expect(resultA).toBe('result-shared-key');
    expect(resultB).toBe('result-shared-key');

    expect(batchFn).toHaveBeenCalledTimes(2);
  });
});

describe('OperationScopedDataLoader error key eviction and retry', () => {
  it('evicts only keys whose batch result is an Error and allows retry within the same operation', async () => {
    let callCount = 0;
    const batchFn = vi.fn(async (ids: readonly string[]): Promise<(string | Error)[]> => {
      callCount++;
      return ids.map((id) => {
        if (id === 'flaky' && callCount === 1) {
          return new Error('transient error for flaky');
        }
        return `value-${id}`;
      });
    });

    const getResource = OperationScopedDataLoader.create<string, string>(batchFn);
    const context = createContext();
    const loader = getResource(context);

    // Initial batch with 3 keys: ok1, flaky, ok2
    const [resOk1, resFlaky, resOk2] = await Promise.allSettled([
      loader.load('ok1'),
      loader.load('flaky'),
      loader.load('ok2'),
    ]);

    expect(resOk1.status).toBe('fulfilled');
    if (resOk1.status === 'fulfilled') {
      expect(resOk1.value).toBe('value-ok1');
    }

    expect(resFlaky.status).toBe('rejected');
    if (resFlaky.status === 'rejected') {
      expect(resFlaky.reason).toBeInstanceOf(Error);
      expect((resFlaky.reason as Error).message).toBe('transient error for flaky');
    }

    expect(resOk2.status).toBe('fulfilled');
    if (resOk2.status === 'fulfilled') {
      expect(resOk2.value).toBe('value-ok2');
    }

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenLastCalledWith(['ok1', 'flaky', 'ok2']);

    // Successful keys remain cached: no new batch should be dispatched
    const cachedOk1 = await loader.load('ok1');
    const cachedOk2 = await loader.load('ok2');
    expect(cachedOk1).toBe('value-ok1');
    expect(cachedOk2).toBe('value-ok2');
    expect(batchFn).toHaveBeenCalledTimes(1);

    // Flaky key was evicted on error: retrying triggers a second batch containing ONLY flaky
    const retriedFlaky = await loader.load('flaky');
    expect(retriedFlaky).toBe('value-flaky');
    expect(batchFn).toHaveBeenCalledTimes(2);
    expect(batchFn).toHaveBeenLastCalledWith(['flaky']);

    // Subsequent loads for flaky hit the new cached value
    const cachedFlaky = await loader.load('flaky');
    expect(cachedFlaky).toBe('value-flaky');
    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it('preserves rejected whole-batch upstream behavior when batchFn throws', async () => {
    let callCount = 0;
    const batchFn = vi.fn(async (ids: readonly string[]) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('upstream connection failed');
      }
      return ids.map((id) => `recovered-${id}`);
    });

    const getResource = OperationScopedDataLoader.create<string, string>(batchFn);
    const context = createContext();
    const loader = getResource(context);

    const [firstA, firstB] = await Promise.allSettled([
      loader.load('a'),
      loader.load('b'),
    ]);

    expect(firstA.status).toBe('rejected');
    expect(firstB.status).toBe('rejected');
    expect(batchFn).toHaveBeenCalledTimes(1);

    // Upstream DataLoader clears all keys on rejected batch: retry should call batchFn again
    const [retryA, retryB] = await Promise.all([
      loader.load('a'),
      loader.load('b'),
    ]);

    expect(retryA).toBe('recovered-a');
    expect(retryB).toBe('recovered-b');
    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it('preserves error key eviction and retry with custom cacheKeyFn and cacheMap', async () => {
    interface CompositeKey {
      id: string;
      tenant: string;
    }

    const customCacheMap = new Map<string, Promise<string>>();
    let attempts = 0;

    const batchFn = vi.fn(async (keys: readonly CompositeKey[]): Promise<(string | Error)[]> => {
      attempts++;
      return keys.map((key) => {
        if (key.id === 'err' && attempts === 1) {
          return new Error('transient error on err');
        }
        return `${key.tenant}:${key.id}-data`;
      });
    });

    const getResource = OperationScopedDataLoader.create<CompositeKey, string, string>(batchFn, {
      cacheKeyFn: (k) => `${k.tenant}:${k.id}`,
      cacheMap: customCacheMap,
    });

    const context = createContext();
    const loader = getResource(context);

    const keyGood: CompositeKey = { id: 'good', tenant: 't1' };
    const keyErr: CompositeKey = { id: 'err', tenant: 't1' };

    const [rGood, rErr] = await Promise.allSettled([
      loader.load(keyGood),
      loader.load(keyErr),
    ]);

    expect(rGood.status).toBe('fulfilled');
    expect(rErr.status).toBe('rejected');
    expect(batchFn).toHaveBeenCalledTimes(1);

    // CacheMap has good key
    expect(customCacheMap.has('t1:good')).toBe(true);
    // CacheMap does NOT retain err key
    expect(customCacheMap.has('t1:err')).toBe(false);

    // Retry err key: triggers second batch
    const retried = await loader.load(keyErr);
    expect(retried).toBe('t1:err-data');
    expect(batchFn).toHaveBeenCalledTimes(2);
    expect(customCacheMap.has('t1:err')).toBe(true);
  });
});

describe('DataLoader custom cache-key generic C and non-public constructor regressions', () => {
  it('threads custom cache-key generic C through accessor, loader, and map types where C != K', () => {
    interface EntityKey {
      id: string;
      tenantId: string;
    }

    type CacheKeyString = string;

    const batchFn = async (keys: readonly EntityKey[]): Promise<string[]> =>
      keys.map((k) => `${k.tenantId}:${k.id}`);

    const accessor = OperationScopedDataLoader.create<EntityKey, string, CacheKeyString>(batchFn, {
      cacheKeyFn: (key) => `${key.tenantId}:${key.id}`,
    });

    expectTypeOf(accessor).toEqualTypeOf<RequestScopedDataLoaderAccessor<EntityKey, string, CacheKeyString>>();

    const context = createContext();
    const loader = accessor(context);

    expectTypeOf(loader).toEqualTypeOf<DataLoader<EntityKey, string, CacheKeyString>>();

    const definitions = {
      entityById: {
        batch: batchFn,
        options: {
          cacheKeyFn: (key: EntityKey) => `${key.tenantId}:${key.id}`,
        },
      },
    };

    const mapLoaders = createDataLoaderMap(definitions);

    type ExpectedResolved = {
      entityById: DataLoader<EntityKey, string, CacheKeyString>;
    };

    expectTypeOf(mapLoaders(context)).toEqualTypeOf<ExpectedResolved>();
    expectTypeOf<ResolvedDataLoaders<typeof definitions>>().toEqualTypeOf<ExpectedResolved>();
  });

  it('rejects new OperationScopedDataLoader at compile time because constructor is private', () => {
    // @ts-expect-error Constructor of class 'OperationScopedDataLoader' is private and only accessible within the class declaration.
    expect(() => new OperationScopedDataLoader()).toThrow();
  });
});
