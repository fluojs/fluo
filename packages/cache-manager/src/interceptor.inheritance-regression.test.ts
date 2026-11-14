import type { InterceptorContext, RequestContext } from '@fluojs/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CacheEvict, CacheKey, CacheTTL } from './decorators.js';
import { CacheInterceptor } from './interceptor.js';
import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import type { NormalizedCacheModuleOptions } from './types.js';

const cacheOptions: NormalizedCacheModuleOptions = {
  rememberCacheErrors: 'throw',
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 300,
};

function createControllers() {
  class ParentController {
    @CacheKey('parent')
    @CacheTTL(10)
    list() {
      return { owner: 'parent' };
    }

    @CacheEvict(['parent'])
    refresh() {
      return { refreshed: 'parent' };
    }
  }

  class ChildController extends ParentController {
    @CacheKey('child')
    @CacheTTL(20)
    override list() {
      return { owner: 'child' };
    }

    @CacheEvict(['child'])
    override refresh() {
      return { refreshed: 'child' };
    }
  }

  class SiblingController extends ParentController {
    @CacheKey('sibling')
    @CacheTTL(30)
    override list() {
      return { owner: 'sibling' };
    }

    @CacheEvict(['sibling'])
    override refresh() {
      return { refreshed: 'sibling' };
    }
  }

  class DescendantController extends ChildController {
    @CacheKey('descendant')
    @CacheTTL(40)
    override list() {
      return { owner: 'descendant' };
    }

    @CacheEvict(['descendant'])
    override refresh() {
      return { refreshed: 'descendant' };
    }
  }

  class InheritedController extends ParentController {}

  return [
    { token: ParentController, key: 'parent', ttl: 10 },
    { token: ChildController, key: 'child', ttl: 20 },
    { token: SiblingController, key: 'sibling', ttl: 30 },
    { token: DescendantController, key: 'descendant', ttl: 40 },
    { token: InheritedController, key: 'parent', ttl: 10 },
  ];
}

function createContext(
  controllerToken: InterceptorContext['handler']['controllerToken'],
  methodName: string,
  method: 'GET' | 'POST',
): InterceptorContext {
  const headers: Record<string, string | string[]> = {};
  const path = '/items';
  const requestContext: RequestContext = {
    container: {
      async dispose() {},
      async resolve<T>(): Promise<T> {
        throw new Error('Unexpected dependency resolution.');
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
      async send() {
        this.committed = true;
      },
      setHeader(name: string, value: string | string[]) {
        headers[name] = value;
      },
      setStatus() {},
      statusCode: 200,
    },
  };

  return {
    handler: {
      controllerToken,
      metadata: {
        controllerPath: '',
        effectivePath: path,
        effectiveVersion: undefined,
        moduleMiddleware: [],
        moduleType: undefined,
        pathParams: [],
      },
      methodName,
      route: { method, path },
    },
    requestContext,
  };
}

describe('CacheInterceptor decorator inheritance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replays each overridden handler response with its own key and TTL after sibling and descendant declarations', async () => {
    const controllers = createControllers().slice(0, 4);
    const store = new MemoryStore();
    const writes = vi.spyOn(store, 'set');
    const cache = new CacheService(store, cacheOptions);
    const interceptor = new CacheInterceptor(cache, cacheOptions);
    const handlers = controllers.map(({ token }) => {
      const controller = new token();
      return vi.spyOn(controller, 'list');
    });

    try {
      const responses = [];
      for (let round = 0; round < 2; round++) {
        for (const [index, { token }] of controllers.entries()) {
          responses.push(await interceptor.intercept(createContext(token, 'list', 'GET'), {
            handle: async () => handlers[index](),
          }));
        }
      }

      const expected = controllers.map(({ key }) => ({ owner: key }));
      expect(responses).toEqual([...expected, ...expected]);
      for (const handler of handlers) {
        expect(handler).toHaveBeenCalledTimes(1);
      }
      expect(writes.mock.calls).toEqual(controllers.map(({ key, ttl }) => [key, { owner: key }, ttl]));
    } finally {
      await cache.close();
    }
  });

  it.each([0, 1, 2, 3, 4])('evicts only controller %i targets after a successful response commit', async (index) => {
    const controllers = createControllers();
    const { token, key } = controllers[index];
    let resolveEviction!: () => void;
    const eviction = new Promise<void>((resolve) => {
      resolveEviction = resolve;
    });
    const options: NormalizedCacheModuleOptions = {
      ...cacheOptions,
      observer: {
        onCacheOperation(observation) {
          if (observation.operation === 'del') {
            resolveEviction();
          }
        },
      },
    };
    const cache = new CacheService(new MemoryStore(), options);
    const interceptor = new CacheInterceptor(cache, options);
    const keys = ['parent', 'child', 'sibling', 'descendant', 'unrelated'];
    const context = createContext(token, 'refresh', 'POST');
    const originalSend = context.requestContext.response.send;
    const controller = new token();
    const handler = vi.spyOn(controller, 'refresh');

    try {
      for (const target of keys) {
        await cache.set(target, { owner: target });
      }

      const value = await interceptor.intercept(context, { handle: async () => controller.refresh() });

      expect(value).toEqual({ refreshed: key });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(context.requestContext.response.committed).toBe(false);
      for (const target of keys) {
        await expect(cache.get(target)).resolves.toEqual({ owner: target });
      }
      await context.requestContext.response.send(value);
      await eviction;

      expect(context.requestContext.response.committed).toBe(true);
      expect(context.requestContext.response.send).toBe(originalSend);
      expect(vi.getTimerCount()).toBe(0);
      for (const target of keys) {
        await expect(cache.get(target)).resolves.toEqual(target === key ? undefined : { owner: target });
      }
    } finally {
      await cache.close();
    }
  });

  it('inherits unchanged parent keys and TTLs without adding a controller namespace', async () => {
    const controllers = createControllers();
    const parent = controllers[0];
    const inherited = controllers[4];
    const store = new MemoryStore();
    const writes = vi.spyOn(store, 'set');
    const cache = new CacheService(store, cacheOptions);
    const interceptor = new CacheInterceptor(cache, cacheOptions);
    const parentController = new parent.token();
    const inheritedController = new inherited.token();
    const inheritedHandler = vi.spyOn(inheritedController, 'list');
    const parentHandler = vi.spyOn(parentController, 'list');

    try {
      const first = await interceptor.intercept(createContext(inherited.token, 'list', 'GET'), {
        handle: async () => inheritedController.list(),
      });
      const replay = await interceptor.intercept(createContext(parent.token, 'list', 'GET'), {
        handle: async () => parentController.list(),
      });

      expect(first).toEqual({ owner: 'parent' });
      expect(replay).toEqual(first);
      expect(inheritedHandler).toHaveBeenCalledTimes(1);
      expect(parentHandler).not.toHaveBeenCalled();
      expect(writes.mock.calls).toEqual([['parent', { owner: 'parent' }, 10]]);
    } finally {
      await cache.close();
    }
  });
});
