import type { CallHandler, InterceptorContext, RequestContext } from '@fluojs/http';
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

  it('unrefs the fallback eviction timer and clears it after response commit', async () => {
    // Given
    class ProductController {
      @CacheEvict('/products')
      refresh() {}
    }

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { interceptor } = createInterceptor();
    const requestContext = createRequestContext('POST', '/products/refresh');
    const context = createContext(ProductController, 'refresh', requestContext);
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    // When
    const value = await interceptor.intercept(context, next);
    const fallbackTimer = setTimeoutSpy.mock.results.at(-1)?.value;
    const keepsProcessAlive = fallbackTimer?.hasRef();
    await requestContext.response.send(value);

    // Then
    expect(keepsProcessAlive).toBe(false);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(fallbackTimer);
  });
});
