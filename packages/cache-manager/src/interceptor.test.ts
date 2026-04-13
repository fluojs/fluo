import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CallHandler, HttpMethod, InterceptorContext, Principal, RequestContext } from '@fluojs/http';

import { CacheEvict, CacheKey, CacheTTL } from './decorators.js';
import { CacheInterceptor } from './interceptor.js';
import { MemoryStore } from './stores/memory-store.js';
import { CacheService } from './service.js';
import type { NormalizedCacheModuleOptions } from './types.js';

const cacheOptions: NormalizedCacheModuleOptions = {
  isGlobal: false,
  keyPrefix: 'fluo:cache:',
  store: 'memory',
  ttl: 0,
  httpKeyStrategy: 'route',
  principalScopeResolver: undefined,
};

function createRequestContext(
  method: string,
  url: string,
  path = url,
  headers: Record<string, string | string[]> = {},
  principal?: Principal,
): RequestContext {
  const queryStart = url.indexOf('?');
  const query: Record<string, string> = {};

  if (queryStart !== -1) {
    const queryString = url.slice(queryStart + 1);
    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=');
      if (key) {
        query[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    }
  }

  return {
    container: {
      async dispose() {
        return undefined;
      },
      async resolve<T>(_token: unknown): Promise<T> {
        throw new Error('resolve() should not be called in cache interceptor unit tests.');
      },
    },
    metadata: {},
    principal,
    request: {
      body: undefined,
      cookies: {},
      headers,
      method,
      params: {},
      path,
      query,
      raw: {},
      url,
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
      setStatus(_code: number) {},
      statusCode: 200,
    },
  };
}

function createContext(
  controllerToken: Function,
  methodName: string,
  requestContext: RequestContext,
  requestMethod: HttpMethod = 'GET',
): InterceptorContext {
  return {
    handler: {
      controllerToken: controllerToken as InterceptorContext['handler']['controllerToken'],
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
        method: requestMethod,
        path: requestContext.request.path,
      },
    },
    requestContext,
  };
}

function createInterceptor(overrides: Partial<NormalizedCacheModuleOptions> = {}) {
  const options: NormalizedCacheModuleOptions = {
    ...cacheOptions,
    ...overrides,
  };
  const cacheService = new CacheService(new MemoryStore(), options);
  return {
    cacheService,
    interceptor: new CacheInterceptor(cacheService, options),
  };
}

describe('CacheInterceptor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached GET values on cache hit', async () => {
    class ProductController {
      @CacheTTL(120)
      @CacheKey('GET:/products')
      list() {}
    }

    const { interceptor } = createInterceptor();
    const context = createContext(ProductController, 'list', createRequestContext('GET', '/products?sort=asc'));
    const next: CallHandler = {
      handle: vi.fn(async () => ({ source: 'handler' })),
    };

    const first = await interceptor.intercept(context, next);
    const second = await interceptor.intercept(context, next);

    expect(first).toEqual({ source: 'handler' });
    expect(second).toEqual({ source: 'handler' });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('uses effective route path by default when @CacheKey is absent', async () => {
    class ProductController {
      list() {}
    }

    const { interceptor } = createInterceptor();
    const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2', '/products'));
    const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=9', '/products'));
    const next: CallHandler = {
      handle: vi.fn(async () => ({ count: 1 })),
    };

    await interceptor.intercept(firstContext, next);
    await interceptor.intercept(secondContext, next);

    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('does not perform read-through caching for non-GET handlers', async () => {
    class ProductController {
      @CacheTTL(120)
      @CacheKey('GET:/products')
      update() {}
    }

    const { interceptor } = createInterceptor();
    const context = createContext(ProductController, 'update', createRequestContext('POST', '/products'), 'POST');
    const next: CallHandler = {
      handle: vi.fn(async () => ({ source: 'post-handler' })),
    };

    await interceptor.intercept(context, next);
    await interceptor.intercept(context, next);

    expect(next.handle).toHaveBeenCalledTimes(2);
  });

  it('evicts configured keys after successful non-GET handlers', async () => {
    class ProductController {
      @CacheEvict('GET:/products')
      refresh() {}
    }

    const { cacheService, interceptor } = createInterceptor();
    await cacheService.set('GET:/products', { count: 1 }, 120);

    const context = createContext(ProductController, 'refresh', createRequestContext('POST', '/products/refresh'), 'POST');
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    const value = await interceptor.intercept(context, next);
    await context.requestContext.response.send(value);

    await expect(cacheService.get('GET:/products')).resolves.toBeUndefined();
  });

  it('does not evict keys when non-GET handlers throw', async () => {
    class ProductController {
      @CacheEvict('GET:/products')
      refresh() {}
    }

    const { cacheService, interceptor } = createInterceptor();
    await cacheService.set('GET:/products', { count: 1 }, 120);

    const context = createContext(ProductController, 'refresh', createRequestContext('POST', '/products/refresh'), 'POST');
    const next: CallHandler = {
      handle: vi.fn(async () => {
        throw new Error('refresh failed');
      }),
    };

    await expect(interceptor.intercept(context, next)).rejects.toThrow('refresh failed');
    await expect(cacheService.get('GET:/products')).resolves.toEqual({ count: 1 });
  });

  it('treats ttl=0 as no-expiry caching by default', async () => {
    class ProductController {
      list() {}
    }

    const { interceptor } = createInterceptor({ ttl: 0 });
    const context = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2', '/products'));
    const next: CallHandler = {
      handle: vi.fn(async () => ({ count: 1 })),
    };

    await interceptor.intercept(context, next);
    await interceptor.intercept(context, next);

    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('falls back to handler results when cache reads or writes fail', async () => {
    class ProductController {
      list() {}
    }

    const { cacheService, interceptor } = createInterceptor({ ttl: 30 });
    vi.spyOn(cacheService, 'get').mockRejectedValueOnce(new Error('redis down'));
    vi.spyOn(cacheService, 'set').mockRejectedValueOnce(new Error('redis down'));

    const context = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2', '/products'));
    const next: CallHandler = {
      handle: vi.fn(async () => ({ count: 1 })),
    };

    await expect(interceptor.intercept(context, next)).resolves.toEqual({ count: 1 });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('does not fail successful non-GET handlers when cache eviction fails', async () => {
    class ProductController {
      @CacheEvict('GET:/products')
      refresh() {}
    }

    const { cacheService, interceptor } = createInterceptor();
    vi.spyOn(cacheService, 'del').mockRejectedValueOnce(new Error('redis down'));

    const requestContext = createRequestContext('POST', '/products/refresh');
    const context = createContext(ProductController, 'refresh', requestContext, 'POST');
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    const value = await interceptor.intercept(context, next);
    await requestContext.response.send(value);

    expect(value).toEqual({ refreshed: true });
  });

  it('evicts immediately when the handler already committed the response before returning', async () => {
    class ProductController {
      @CacheEvict('/products')
      refresh() {}
    }

    const { cacheService, interceptor } = createInterceptor();
    await cacheService.set('/products', { count: 1 }, 120);

    const requestContext = createRequestContext('POST', '/products/refresh');
    requestContext.response.committed = true;
    const context = createContext(ProductController, 'refresh', requestContext, 'POST');
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    await interceptor.intercept(context, next);

    await expect(cacheService.get('/products')).resolves.toBeUndefined();
  });

  it('falls back to timed deferred eviction when a successful write never calls response.send', async () => {
    vi.useFakeTimers();

    class ProductController {
      @CacheEvict('GET:/products')
      refresh() {}
    }

    const { cacheService, interceptor } = createInterceptor();
    await cacheService.set('GET:/products', { count: 1 }, 120);

    const requestContext = createRequestContext('POST', '/products/refresh');
    const context = createContext(ProductController, 'refresh', requestContext, 'POST');
    const next: CallHandler = {
      handle: vi.fn(async () => ({ refreshed: true })),
    };

    await expect(interceptor.intercept(context, next)).resolves.toEqual({ refreshed: true });
    await expect(cacheService.get('GET:/products')).resolves.toEqual({ count: 1 });

    await vi.advanceTimersByTimeAsync(4_999);
    await expect(cacheService.get('GET:/products')).resolves.toEqual({ count: 1 });

    await vi.advanceTimersByTimeAsync(1);
    await expect(cacheService.get('GET:/products')).resolves.toBeUndefined();
  });

  describe('httpKeyStrategy', () => {
    it('strategy "route" ignores query parameters in cache key', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: 'route' });
      const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=1', '/products'));
      const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ page: 1 })),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);

      expect(next.handle).toHaveBeenCalledTimes(1);
      expect(await cacheService.get('/products')).toEqual({ page: 1 });
    });

    it('strategy "route" isolates authenticated principals by default', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: 'route' });
      const alice: Principal = { subject: 'alice', issuer: 'issuer-a', claims: {} };
      const bob: Principal = { subject: 'bob', issuer: 'issuer-a', claims: {} };
      const firstContext = createContext(
        ProductController,
        'list',
        createRequestContext('GET', '/products', '/products', {}, alice),
      );
      const secondContext = createContext(
        ProductController,
        'list',
        createRequestContext('GET', '/products', '/products', {}, bob),
      );
      const next: CallHandler = {
        handle: vi
          .fn<CallHandler['handle']>()
          .mockResolvedValueOnce({ owner: 'alice' })
          .mockResolvedValueOnce({ owner: 'bob' }),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('/products|principal:issuer-a:alice')).toEqual({ owner: 'alice' });
      expect(await cacheService.get('/products|principal:issuer-a:bob')).toEqual({ owner: 'bob' });
    });

    it('applies principalScopeResolver to anonymous requests', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({
        httpKeyStrategy: 'route',
        principalScopeResolver: (context) => context.requestContext.metadata.tenantId as string | undefined,
      });
      const firstRequestContext = createRequestContext('GET', '/products', '/products');
      const secondRequestContext = createRequestContext('GET', '/products', '/products');
      firstRequestContext.metadata.tenantId = 'tenant-a';
      secondRequestContext.metadata.tenantId = 'tenant-b';

      const firstContext = createContext(ProductController, 'list', firstRequestContext);
      const secondContext = createContext(ProductController, 'list', secondRequestContext);
      const next: CallHandler = {
        handle: vi
          .fn<CallHandler['handle']>()
          .mockResolvedValueOnce({ tenant: 'tenant-a' })
          .mockResolvedValueOnce({ tenant: 'tenant-b' }),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('/products|principal:tenant-a')).toEqual({ tenant: 'tenant-a' });
      expect(await cacheService.get('/products|principal:tenant-b')).toEqual({ tenant: 'tenant-b' });
    });

    it('falls back to the base key when anonymous principalScopeResolver returns undefined', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({
        httpKeyStrategy: 'route',
        principalScopeResolver: (context) => context.requestContext.metadata.tenantId as string | undefined,
      });
      const anonymousRequestContext = createRequestContext('GET', '/products', '/products');
      const tenantScopedRequestContext = createRequestContext('GET', '/products', '/products');
      tenantScopedRequestContext.metadata.tenantId = 'tenant-a';

      const anonymousContext = createContext(ProductController, 'list', anonymousRequestContext);
      const tenantScopedContext = createContext(ProductController, 'list', tenantScopedRequestContext);
      const next: CallHandler = {
        handle: vi
          .fn<CallHandler['handle']>()
          .mockResolvedValueOnce({ scope: 'base' })
          .mockResolvedValueOnce({ scope: 'tenant-a' }),
      };

      await interceptor.intercept(anonymousContext, next);
      await interceptor.intercept(tenantScopedContext, next);
      await interceptor.intercept(anonymousContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('/products')).toEqual({ scope: 'base' });
      expect(await cacheService.get('/products|principal:tenant-a')).toEqual({ scope: 'tenant-a' });
    });

    it('strategy "route+query" includes sorted query in cache key', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: 'route+query' });
      const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=1&sort=asc', '/products'));
      const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?sort=asc&page=1', '/products'));
      const thirdContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2&sort=asc', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ data: 'response' })),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);
      await interceptor.intercept(thirdContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('/products?page=1&sort=asc')).toEqual({ data: 'response' });
      expect(await cacheService.get('/products?page=2&sort=asc')).toEqual({ data: 'response' });
    });

    it('strategy "route+query" produces same key regardless of query param order', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor } = createInterceptor({ httpKeyStrategy: 'route+query' });
      const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?b=2&a=1', '/products'));
      const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?a=1&b=2', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ data: 'test' })),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);

      expect(next.handle).toHaveBeenCalledTimes(1);
    });

    it('strategy "route+query" treats no-query and empty-query differently from route-only', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: 'route+query' });
      const noQueryContext = createContext(ProductController, 'list', createRequestContext('GET', '/products', '/products'));
      const withQueryContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=1', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ data: 'response' })),
      };

      await interceptor.intercept(noQueryContext, next);
      await interceptor.intercept(withQueryContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('/products')).toEqual({ data: 'response' });
      expect(await cacheService.get('/products?page=1')).toEqual({ data: 'response' });
    });

    it('custom function strategy allows arbitrary key computation', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const customStrategy = (context: InterceptorContext) => {
        const path = context.handler.metadata.effectivePath;
        const tenantId = context.requestContext.request.headers['x-tenant-id'] ?? 'default';
        return `${tenantId}:${path}`;
      };

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: customStrategy });
      const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products', '/products', { 'x-tenant-id': 'tenant-a' }));
      const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products', '/products', { 'x-tenant-id': 'tenant-b' }));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ data: 'response' })),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('tenant-a:/products')).toEqual({ data: 'response' });
      expect(await cacheService.get('tenant-b:/products')).toEqual({ data: 'response' });
    });

    it('@CacheKey decorator overrides httpKeyStrategy', async () => {
      class ProductController {
        @CacheTTL(120)
        @CacheKey('custom-key')
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: 'route+query' });
      const context = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=1', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ data: 'test' })),
      };

      await interceptor.intercept(context, next);
      await interceptor.intercept(context, next);

      expect(next.handle).toHaveBeenCalledTimes(1);
      expect(await cacheService.get('custom-key')).toEqual({ data: 'test' });
      expect(await cacheService.get('/products?page=1')).toBeUndefined();
    });

    it('default strategy still ignores query parameters for unauthenticated requests', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor } = createInterceptor();
      const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=1', '/products'));
      const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ count: 1 })),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);

      expect(next.handle).toHaveBeenCalledTimes(1);
    });

    it('strategy "full" includes sorted query in cache key (equivalent to route+query)', async () => {
      class ProductController {
        @CacheTTL(120)
        list() {}
      }

      const { interceptor, cacheService } = createInterceptor({ httpKeyStrategy: 'full' });
      const firstContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=1&sort=asc', '/products'));
      const secondContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?sort=asc&page=1', '/products'));
      const thirdContext = createContext(ProductController, 'list', createRequestContext('GET', '/products?page=2&sort=asc', '/products'));
      const next: CallHandler = {
        handle: vi.fn(async () => ({ data: 'response' })),
      };

      await interceptor.intercept(firstContext, next);
      await interceptor.intercept(secondContext, next);
      await interceptor.intercept(thirdContext, next);

      expect(next.handle).toHaveBeenCalledTimes(2);
      expect(await cacheService.get('/products?page=1&sort=asc')).toEqual({ data: 'response' });
      expect(await cacheService.get('/products?page=2&sort=asc')).toEqual({ data: 'response' });
    });
  });
});
