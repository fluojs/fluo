import { readFileSync } from 'node:fs';

import type { CallHandler, InterceptorContext, RequestContext } from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';

import { CacheEvict, CacheKey, CacheTTL, cacheRouteMetadataKey, getCacheTtlMetadata } from './decorators.js';
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
        throw new Error('resolve() should not be called in cache request-pipeline seam tests.');
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

describe('@fluojs/cache-manager request-pipeline metadata seam', () => {
  it('reads decorator and interceptor metadata helpers from @fluojs/core/request-pipeline', () => {
    // Given
    const decoratorsSource = readFileSync(new URL('./decorators.ts', import.meta.url), 'utf8');
    const interceptorSource = readFileSync(new URL('./interceptor.ts', import.meta.url), 'utf8');

    // Then
    expect(decoratorsSource).toContain("from '@fluojs/core/request-pipeline'");
    expect(decoratorsSource).toContain('ensureRequestPipelineMetadataSymbol');
    expect(decoratorsSource).not.toContain("from '@fluojs/core/internal'");
    expect(interceptorSource).toContain("from '@fluojs/core/request-pipeline'");
    expect(interceptorSource).toContain('getRequestPipelineMetadataBag');
    expect(interceptorSource).not.toContain("from '@fluojs/core/internal'");
  });

  it('initializes the standard metadata symbol so cache decorators can write route records', () => {
    // Given
    class ProductController {
      @CacheTTL(45)
      list() {}
    }

    // When
    const bag = (ProductController as unknown as Record<symbol, Record<PropertyKey, unknown> | undefined>)[
      (Symbol as typeof Symbol & { metadata?: symbol }).metadata ?? Symbol.for('fluo.symbol.metadata')
    ];
    const routeMap = bag?.[cacheRouteMetadataKey] as Map<string | symbol, Record<PropertyKey, unknown>> | undefined;

    // Then
    expect(routeMap?.get('list')).toBeDefined();
    expect(getCacheTtlMetadata(routeMap?.get('list') ?? {})).toBe(45);
  });

  it('caches GET responses using @CacheKey metadata inherited from a base controller', async () => {
    // Given
    class BaseProductController {
      @CacheKey('inherited:/products')
      list() {}
    }

    class ProductController extends BaseProductController {}

    const { cache, interceptor } = createInterceptor();
    const context = createContext(ProductController, 'list', createRequestContext('GET', '/products'));
    const next: CallHandler = {
      handle: vi.fn(async () => ({ source: 'handler' })),
    };

    // When
    await interceptor.intercept(context, next);

    // Then
    await expect(cache.get('inherited:/products')).resolves.toEqual({ source: 'handler' });
    await expect(cache.get('/products')).resolves.toBeUndefined();
  });

  it('evicts cache entries using @CacheEvict metadata inherited from a base controller', async () => {
    // Given
    class BaseProductController {
      @CacheEvict('/products')
      refresh() {}
    }

    class ProductController extends BaseProductController {}

    const { cache, interceptor } = createInterceptor();
    await cache.set('/products', { version: 'previous' }, 120);
    const requestContext = createRequestContext('POST', '/products/refresh');
    const context = createContext(ProductController, 'refresh', requestContext);
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    // When
    const value = await interceptor.intercept(context, next);
    await requestContext.response.send(value);

    // Then
    await expect(cache.get('/products')).resolves.toBeUndefined();
  });
});
