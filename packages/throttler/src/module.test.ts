import { beforeEach, describe, expect, it, vi } from 'vitest';

import { metadataSymbol } from '@konekti/core/internal';
import type { GuardContext, HandlerDescriptor, RequestContext } from '@konekti/http';

import { SkipThrottle, Throttle, getThrottleMetadata } from './decorators.js';
import { ThrottlerGuard } from './guard.js';
import { ThrottlerModule, createThrottlerProviders } from './module.js';
import { createMemoryThrottlerStore } from './store.js';
import { THROTTLER_OPTIONS } from './tokens.js';
import type {
  ThrottlerConsumeInput,
  ThrottlerModuleOptions,
  ThrottlerStore,
  ThrottlerStoreEntry,
} from './types.js';

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
  options?: {
    moduleType?: HandlerDescriptor['metadata']['moduleType'];
    routeMethod?: HandlerDescriptor['route']['method'];
    routePath?: string;
    routeVersion?: string;
  },
): GuardContext {
  const routePath = options?.routePath ?? '/test';
  const routeMethod = options?.routeMethod ?? 'GET';

  return {
    handler: {
      controllerToken: controllerToken as HandlerDescriptor['controllerToken'],
      metadata: {
        controllerPath: '',
        effectivePath: routePath,
        effectiveVersion: options?.routeVersion,
        moduleMiddleware: [],
        moduleType: options?.moduleType,
        pathParams: [],
      },
      methodName,
      route: {
        method: routeMethod,
        path: routePath,
        version: options?.routeVersion,
      },
    },
    requestContext,
  };
}

type ObjectProvider = {
  provide: unknown;
  useClass?: unknown;
  useExisting?: unknown;
  useValue?: unknown;
};

function isObjectProvider(provider: unknown): provider is ObjectProvider {
  return typeof provider === 'object' && provider !== null && 'provide' in provider;
}

describe('createThrottlerProviders', () => {
  it('registers class-first ThrottlerGuard identity and keeps THROTTLER_OPTIONS token-based', () => {
    const providers = createThrottlerProviders({
      limit: 10,
      ttl: 60,
    });
    const optionsProvider = providers.find(
      (provider) => isObjectProvider(provider) && provider.provide === THROTTLER_OPTIONS,
    );
    const classProvider = providers.find(
      (provider) => isObjectProvider(provider) && provider.provide === ThrottlerGuard,
    );

    expect(optionsProvider).toMatchObject({
      provide: THROTTLER_OPTIONS,
      useValue: {
        limit: 10,
        ttl: 60,
      },
    });
    expect(classProvider).toMatchObject({
      provide: ThrottlerGuard,
      useClass: ThrottlerGuard,
    });

    expect(providers).toHaveLength(2);
  });
});

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

  it('rejects invalid @Throttle options eagerly', () => {
    expect(() => {
      class AuthController {
        @Throttle({ limit: 0, ttl: 60 })
        login() {}
      }

      return AuthController;
    }).toThrow(/limit/i);

    expect(() => {
      class AuthController {
        @Throttle({ limit: 1, ttl: Number.NaN })
        login() {}
      }

      return AuthController;
    }).toThrow(/ttl/i);
  });

  it('captures @Throttle options by value to avoid shared mutable metadata', () => {
    const options = { limit: 5, ttl: 60 };

    class AuthController {
      @Throttle(options)
      login() {}
    }

    options.limit = 99;

    const bag = (AuthController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('konekti.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const loginRecord = routeMap?.get('login') ?? {};

    expect(getThrottleMetadata(loginRecord)).toEqual({ limit: 5, ttl: 60 });
  });

  it('returns cloned throttle metadata so callers cannot mutate stored options', () => {
    class AuthController {
      @Throttle({ limit: 3, ttl: 60 })
      login() {}
    }

    const bag = (AuthController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('konekti.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const loginRecord = routeMap?.get('login') ?? {};
    const firstRead = getThrottleMetadata(loginRecord);

    if (!firstRead) {
      throw new Error('Throttle metadata should be defined for @Throttle-decorated methods.');
    }

    firstRead.limit = 50;

    expect(getThrottleMetadata(loginRecord)).toEqual({ limit: 3, ttl: 60 });
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

  it('rejects invalid module-level ttl and limit before request handling starts', () => {
    expect(() => ThrottlerModule.forRoot({ limit: 0, ttl: 60 })).toThrow(/limit/i);
    expect(() => ThrottlerModule.forRoot({ limit: 1, ttl: -1 })).toThrow(/ttl/i);
    expect(() => ThrottlerModule.forRoot({ limit: Number.POSITIVE_INFINITY, ttl: 60 })).toThrow(/limit/i);
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

  it('re-enters expired keys with a fresh window while keeping active key counters', async () => {
    const store = createMemoryThrottlerStore();

    const firstA = await store.consume('key-a', { now: 0, ttlSeconds: 1 });
    const firstB = await store.consume('key-b', { now: 500, ttlSeconds: 10 });
    const secondB = await store.consume('key-b', { now: 1500, ttlSeconds: 10 });
    const secondA = await store.consume('key-a', { now: 1500, ttlSeconds: 1 });

    expect(firstA.count).toBe(1);
    expect(firstB.count).toBe(1);
    expect(secondB.count).toBe(2);
    expect(secondA.count).toBe(1);
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

  it('separates throttling state for handlers with identical class and method names', async () => {
    const AuthController = class DuplicateController {
      action() {}
    };
    const AdminController = class DuplicateController {
      action() {}
    };
    class AuthModule {}
    class AdminModule {}

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext('10.0.0.1');

    await expect(
      guard.canActivate(
        createGuardContext(AuthController, 'action', ctx, {
          moduleType: AuthModule,
          routeMethod: 'POST',
          routePath: '/auth/login',
          routeVersion: '1',
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        createGuardContext(AdminController, 'action', ctx, {
          moduleType: AdminModule,
          routeMethod: 'POST',
          routePath: '/admin/login',
          routeVersion: '1',
        }),
      ),
    ).resolves.toBe(true);
  });
});

describe('ThrottlerGuard — Redis store mock', () => {
  it('delegates atomic consume calls to the provided store', async () => {
    const entries = new Map<string, ThrottlerStoreEntry>();
    const store: ThrottlerStore = {
      consume: vi.fn((key: string, input: ThrottlerConsumeInput) => {
        const now = input.now;
        const ttlMs = input.ttlSeconds * 1000;
        const entry = entries.get(key);

        if (!entry || now >= entry.resetAt) {
          const next = { count: 1, resetAt: now + ttlMs };
          entries.set(key, next);
          return next;
        }

        const next = {
          count: entry.count + 1,
          resetAt: entry.resetAt,
        };
        entries.set(key, next);
        return next;
      }),
    };

    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 2, store, ttl: 60 });
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    expect(store.consume).toHaveBeenCalledTimes(2);
  });

  it('builds store keys from route and token identity context', async () => {
    const store: ThrottlerStore = {
      consume: vi.fn(async (_key: string, input: ThrottlerConsumeInput) => ({
        count: 1,
        resetAt: input.now + input.ttlSeconds * 1000,
      })),
    };

    const guard = new ThrottlerGuard({ limit: 2, store, ttl: 60 });
    const ctx = createRequestContext('2001:db8::1');
    class RateController {
      hit() {}
    }
    class RateModule {}

    await guard.canActivate(
      createGuardContext(RateController, 'hit', ctx, {
        moduleType: RateModule,
        routeMethod: 'POST',
        routePath: '/v1/rate-limit',
        routeVersion: '1',
      }),
    );

    const key = vi.mocked(store.consume).mock.calls[0]?.[0];

    expect(key).toBeDefined();

    const delimiterCount = (key?.match(/:/g) ?? []).length;
    expect(delimiterCount).toBe(2);

    const [prefix, encodedHandler, encodedClient] = key?.split(':', 3) ?? [];

    expect(prefix).toBe('throttler');
    expect(encodedHandler).toBeTruthy();
    expect(encodedClient).toBeTruthy();

    const decodedHandler = decodeURIComponent(encodedHandler ?? '');
    const decodedClient = decodeURIComponent(encodedClient ?? '');

    expect(decodedHandler).toContain('method:POST');
    expect(decodedHandler).toContain('path:%2Fv1%2Frate-limit');
    expect(decodedHandler).toContain('version:1');
    expect(decodedHandler).toContain('handler:hit');
    expect(decodedClient).toBe('2001:db8::1');
  });

  it('builds the same store key even when handler discovery order differs across module instances', async () => {
    const buildStore = (): ThrottlerStore => ({
      consume: vi.fn(async (_key: string, input: ThrottlerConsumeInput) => ({
        count: 1,
        resetAt: input.now + input.ttlSeconds * 1000,
      })),
    });

    class WarmupController {
      warmup() {}
    }

    class WarmupModule {}

    class RateController {
      hit() {}
    }

    class RateModule {}

    vi.resetModules();
    const { ThrottlerGuard: GuardA } = await import('./guard.js');
    const storeA = buildStore();
    const guardA = new GuardA({ limit: 2, store: storeA, ttl: 60 });

    await guardA.canActivate(
      createGuardContext(WarmupController, 'warmup', createRequestContext('2001:db8::10'), {
        moduleType: WarmupModule,
        routeMethod: 'GET',
        routePath: '/warmup',
        routeVersion: '1',
      }),
    );

    await guardA.canActivate(
      createGuardContext(RateController, 'hit', createRequestContext('2001:db8::1'), {
        moduleType: RateModule,
        routeMethod: 'POST',
        routePath: '/v1/rate-limit',
        routeVersion: '1',
      }),
    );

    vi.resetModules();
    const { ThrottlerGuard: GuardB } = await import('./guard.js');
    const storeB = buildStore();
    const guardB = new GuardB({ limit: 2, store: storeB, ttl: 60 });

    await guardB.canActivate(
      createGuardContext(RateController, 'hit', createRequestContext('2001:db8::1'), {
        moduleType: RateModule,
        routeMethod: 'POST',
        routePath: '/v1/rate-limit',
        routeVersion: '1',
      }),
    );

    const keyA = vi.mocked(storeA.consume).mock.calls[1]?.[0];
    const keyB = vi.mocked(storeB.consume).mock.calls[0]?.[0];

    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();
    expect(keyA).toBe(keyB);
  });
});
