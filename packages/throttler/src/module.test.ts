import { beforeEach, describe, expect, it, vi } from 'vitest';

import { metadataSymbol } from '@konekti/core';
import type { GuardContext, HandlerDescriptor, RequestContext } from '@konekti/http';

import { SkipThrottle, Throttle } from './decorators.js';
import { ThrottlerGuard } from './guard.js';
import { createMemoryThrottlerStore } from './store.js';
import type { ThrottlerModuleOptions, ThrottlerStore, ThrottlerStoreEntry } from './types.js';

function createRequestContext(remoteAddress = '127.0.0.1'): RequestContext {
  const headers: Record<string, string | string[]> = {};
  const response = {
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
  };

  return {
    container: {} as RequestContext['container'],
    metadata: {},
    request: {
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/test',
      query: {},
      raw: { socket: { remoteAddress } },
      url: '/test',
    },
    response: response as unknown as RequestContext['response'],
  };
}

function createGuardContext(
  controllerToken: Function,
  methodName: string,
  requestContext: RequestContext,
): GuardContext {
  return {
    handler: {
      controllerToken: controllerToken as HandlerDescriptor['controllerToken'],
      metadata: {} as HandlerDescriptor['metadata'],
      methodName,
      route: {
        method: 'GET',
        path: '/test',
      },
    },
    requestContext,
  };
}

describe('@konekti/throttler decorators', () => {
  it('writes @Throttle method-level metadata into the route map', () => {
    class AuthController {
      @Throttle({ limit: 5, ttl: 60 })
      login() {}
    }

    const bag = (AuthController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('konekti.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const loginRecord = routeMap?.get('login');

    expect(loginRecord?.[Symbol.for('konekti.throttler.throttle')]).toEqual({ limit: 5, ttl: 60 });
  });

  it('writes @Throttle class-level metadata into the class bag', () => {
    @Throttle({ limit: 100, ttl: 60 })
    class ApiController {
      list() {}
    }

    const bag = (ApiController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;

    expect(bag[Symbol.for('konekti.throttler.class-throttle')]).toEqual({ limit: 100, ttl: 60 });
  });

  it('writes @SkipThrottle method-level metadata into the route map', () => {
    class AuthController {
      @SkipThrottle()
      refresh() {}
    }

    const bag = (AuthController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('konekti.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const refreshRecord = routeMap?.get('refresh');

    expect(refreshRecord?.[Symbol.for('konekti.throttler.skip')]).toBe(true);
  });

  it('writes @SkipThrottle class-level metadata into the class bag', () => {
    @SkipThrottle()
    class PublicController {
      get() {}
    }

    const bag = (PublicController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;

    expect(bag[Symbol.for('konekti.throttler.class-skip')]).toBe(true);
  });
});

describe('ThrottlerGuard — in-memory store', () => {
  let options: ThrottlerModuleOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T00:00:00.000Z'));

    options = {
      limit: 2,
      store: createMemoryThrottlerStore(),
      ttl: 60,
    };
  });

  it('allows requests up to the limit', async () => {
    class TestController {
      @Throttle({ limit: 2, ttl: 60 })
      action() {}
    }

    const guard = new ThrottlerGuard(options);
    const ctx = createRequestContext();

    const result1 = await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    const result2 = await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });

  it('throws TooManyRequestsException on limit exceeded with Retry-After header', async () => {
    class TestController {
      @Throttle({ limit: 1, ttl: 60 })
      action() {}
    }

    const guard = new ThrottlerGuard(options);
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      'Too Many Requests',
    );

    expect(ctx.response.headers['Retry-After']).toBeDefined();
  });

  it('resets the counter after the window expires', async () => {
    class TestController {
      @Throttle({ limit: 1, ttl: 1 })
      action() {}
    }

    const guard = new ThrottlerGuard(options);
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    vi.advanceTimersByTime(1_001);

    const result = await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    expect(result).toBe(true);
  });

  it('skips throttling when method-level @SkipThrottle is present', async () => {
    class TestController {
      @SkipThrottle()
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    const result = await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    expect(result).toBe(true);
  });

  it('skips throttling when class-level @SkipThrottle is present', async () => {
    @SkipThrottle()
    class PublicController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(PublicController, 'action', ctx));
    const result = await guard.canActivate(createGuardContext(PublicController, 'action', ctx));

    expect(result).toBe(true);
  });

  it('method-level @Throttle overrides module-level defaults', async () => {
    class TestController {
      @Throttle({ limit: 5, ttl: 60 })
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext();

    for (let i = 0; i < 5; i++) {
      await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    }

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      'Too Many Requests',
    );
  });

  it('uses module-level defaults when no handler-level @Throttle', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      'Too Many Requests',
    );
  });

  it('keeps separate counters per handler and per client IP', async () => {
    class TestController {
      action() {}
      other() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx1 = createRequestContext('10.0.0.1');
    const ctx2 = createRequestContext('10.0.0.2');

    await guard.canActivate(createGuardContext(TestController, 'action', ctx1));
    await guard.canActivate(createGuardContext(TestController, 'action', ctx2));
    await guard.canActivate(createGuardContext(TestController, 'other', ctx1));

    expect(true).toBe(true);
  });
});

describe('ThrottlerGuard — Redis store mock', () => {
  it('delegates get/set/increment/evict to the provided store', async () => {
    const entries = new Map<string, ThrottlerStoreEntry>();
    const store: ThrottlerStore = {
      evict: vi.fn(),
      get: vi.fn((key: string) => entries.get(key)),
      increment: vi.fn((key: string) => {
        const entry = entries.get(key);
        if (!entry) {
          return 0;
        }

        entry.count++;
        return entry.count;
      }),
      set: vi.fn((key: string, entry: ThrottlerStoreEntry) => {
        entries.set(key, entry);
      }),
    };

    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 2, store, ttl: 60 });
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    expect(store.get).toHaveBeenCalled();
    expect(store.set).toHaveBeenCalled();
    expect(store.increment).toHaveBeenCalled();
    expect(store.evict).toHaveBeenCalled();
  });
});
