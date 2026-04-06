import DataLoader from 'dataloader';
import { describe, expect, it, vi } from 'vitest';

import {
  createDataLoader,
  createDataLoaderMap,
  createRequestScopedDataLoaderFactory,
  getRequestScopedDataLoader,
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

describe('createDataLoader', () => {
  it('returns a request-scoped DataLoader through the public accessor', async () => {
    const db = new Map<string, string>([
      ['1', 'Alice'],
      ['2', 'Bob'],
      ['3', 'Charlie'],
    ]);

    const batchFn = vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => db.get(id) ?? null),
    );

    const getUserById = createDataLoader<string, string | null>(batchFn);

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
    const getUserById = createDataLoader<string, string | null>(async (ids) =>
      ids.map(() => null),
    );

    const context = createContext();
    const first = getUserById(context);
    const second = getUserById(context);

    expect(first).toBe(second);
  });

  it('creates isolated DataLoader instances across different operation contexts', () => {
    const getUserById = createDataLoader<string, string | null>(async (ids) =>
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

    const getItem = createDataLoader<string, string>(batchFn);
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

    const getItem = createDataLoader<string, string>(batchFn);
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

    const getItem = createDataLoader<string, string>(batchFn, { cache: false });
    const context = createContext();
    const loader = getItem(context);

    await loader.load('x');
    await loader.load('x');

    expect(batchFn).toHaveBeenCalledTimes(2);
  });

  it('supports explicit cache key for loader deduplication', () => {
    const loaderKey = Symbol('shared-loader');

    const accessorA = createDataLoader<string, string>(
      async (ids) => ids.map(() => 'a'),
      { key: loaderKey },
    );
    const accessorB = createDataLoader<string, string>(
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

    const getUserById = createDataLoader<string, User | null>(async (ids) =>
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

    const getItem = createDataLoader<string, string>(batchFn);

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
