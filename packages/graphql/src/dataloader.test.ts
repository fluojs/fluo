import { describe, expect, it } from 'vitest';

import { createRequestScopedDataLoaderFactory, getRequestScopedDataLoader } from './dataloader.js';
import type { GraphQLContext } from './types.js';

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
