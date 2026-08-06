import type { CallHandler, Interceptor, InterceptorContext, RequestContext } from '@fluojs/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheEvict, CacheKey } from './decorators.js';
import { CacheInterceptor } from './interceptor.js';
import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import type { NormalizedCacheModuleOptions } from './types.js';

const cacheOptions: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 0,
};

function createRequestContext(method: string, path: string): RequestContext {
  const headers: Record<string, string | string[]> = {};

  return {
    container: {
      async dispose() {},
      async resolve<T>(): Promise<T> {
        throw new Error('resolve() should not be called in cache interceptor regression tests.');
      },
    },
    metadata: {},
    request: {
      body: undefined,
      cookies: {},
      headers,
      method,
      params: {},
      path,
      query: {},
      raw: {},
      url: path,
    },
    response: {
      committed: false,
      headers,
      redirect() {},
      send: vi.fn(async function send(this: { committed: boolean }) {
        this.committed = true;
      }),
      setHeader(name: string, value: string | string[]) {
        headers[name] = value;
      },
      setStatus() {},
      statusCode: 200,
    },
  };
}

function createContext(
  controllerToken: InterceptorContext['handler']['controllerToken'],
  methodName: string,
  requestContext: RequestContext,
): InterceptorContext {
  return {
    handler: {
      controllerToken,
      metadata: {
        controllerPath: '',
        effectivePath: requestContext.request.path,
        effectiveVersion: undefined,
        moduleMiddleware: [],
        moduleType: undefined,
        pathParams: [],
      },
      methodName,
      route: {
        method: requestContext.request.method === 'GET' ? 'GET' : 'POST',
        path: requestContext.request.path,
      },
    },
    requestContext,
  };
}

function createInterceptor(): { readonly cache: CacheService; readonly interceptor: CacheInterceptor } {
  const cache = new CacheService(new MemoryStore(), cacheOptions);
  return {
    cache,
    interceptor: new CacheInterceptor(cache, cacheOptions),
  };
}

describe('CacheInterceptor contract regressions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses an empty literal @CacheKey instead of the configured fallback strategy', async () => {
    // Given
    class ProductController {
      @CacheKey('')
      list() {}
    }

    const { cache, interceptor } = createInterceptor();
    const context = createContext(ProductController, 'list', createRequestContext('GET', '/products'));
    const next: CallHandler = {
      handle: vi.fn(async () => ({ source: 'handler' })),
    };

    // When
    await interceptor.intercept(context, next);

    // Then
    await expect(cache.get('')).resolves.toEqual({ source: 'handler' });
    await expect(cache.get('/products')).resolves.toBeUndefined();
  });

  it('preserves cached reads when a resolved sender does not confirm response commit', async () => {
    // Given
    class ProductController {
      @CacheEvict('/products')
      refresh() {}
    }

    const { cache, interceptor } = createInterceptor();
    await cache.set('/products', { version: 'previous' }, 120);
    const requestContext = createRequestContext('POST', '/products/refresh');
    requestContext.response.send = vi.fn(async () => {});
    const context = createContext(ProductController, 'refresh', requestContext);
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    // When
    const value = await interceptor.intercept(context, next);
    await requestContext.response.send(value);

    // Then
    await expect(cache.get('/products')).resolves.toEqual({ version: 'previous' });
  });

  it('preserves cached reads when an outer interceptor delays and then fails response commit', async () => {
    // Given
    vi.useFakeTimers();
    class ProductController {
      @CacheEvict('/products')
      refresh() {}
    }

    const { cache, interceptor } = createInterceptor();
    await cache.set('/products', { version: 'previous' }, 120);
    const requestContext = createRequestContext('POST', '/products/refresh');
    requestContext.response.send = vi.fn(async () => {
      throw new Error('late response commit failed');
    });
    const context = createContext(ProductController, 'refresh', requestContext);
    const handler: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };
    const cacheLayer: CallHandler = {
      handle: () => interceptor.intercept(context, handler),
    };
    const outerInterceptor: Interceptor = {
      async intercept(outerContext: InterceptorContext, next: CallHandler) {
        const value = await next.handle();
        await vi.advanceTimersByTimeAsync(5_000);
        await outerContext.requestContext.response.send(value);
        return value;
      },
    };

    // When
    const dispatch = outerInterceptor.intercept(context, cacheLayer);

    // Then
    await expect(dispatch).rejects.toThrow('late response commit failed');
    await expect(cache.get('/products')).resolves.toEqual({ version: 'previous' });
  });

  it('cancels deferred eviction when request shutdown aborts before response commit', async () => {
    // Given
    class ProductController {
      @CacheEvict('/products')
      refresh() {}
    }

    const { cache, interceptor } = createInterceptor();
    await cache.set('/products', { version: 'previous' }, 120);
    const requestContext = createRequestContext('POST', '/products/refresh');
    const shutdown = new AbortController();
    requestContext.request.signal = shutdown.signal;
    const context = createContext(ProductController, 'refresh', requestContext);
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };
    const value = await interceptor.intercept(context, next);

    // When
    shutdown.abort(new Error('application shutdown'));
    await requestContext.response.send(value);

    // Then
    await expect(cache.get('/products')).resolves.toEqual({ version: 'previous' });
  });
});
