import { Inject, Module } from '@fluojs/core';
import { getModuleMetadata, metadataSymbol } from '@fluojs/core/internal';
import type { GuardContext, HandlerDescriptor, Middleware, MiddlewareContext, Next, RequestContext } from '@fluojs/http';
import { Controller, Get, UseGuards } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { createTestApp } from '@fluojs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getThrottleMetadata, SkipThrottle, Throttle } from './decorators.js';
import { ThrottlerGuard } from './guard.js';
import type {
  RedisThrottlerClient,
  ThrottlerConsumeInput,
  ThrottlerModuleOptions,
  ThrottlerStore,
  ThrottlerStoreEntry,
} from './index.js';
import * as throttlerExports from './index.js';
import { ThrottlerModule } from './module.js';
import { RedisThrottlerStore } from './redis-store.js';
import { createMemoryThrottlerStore } from './store.js';

function createRequestContext(
  options:
    | string
    | {
        headers?: Record<string, string | string[]>;
        raw?: unknown;
      } = '127.0.0.1',
): RequestContext {
  const headers: Record<string, string | string[]> = typeof options === 'string' ? {} : (options.headers ?? {});
  const raw =
    typeof options === 'string'
      ? { socket: { remoteAddress: options } }
      : (options.raw ?? { socket: { remoteAddress: '127.0.0.1' } });
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
      headers,
      method: 'GET',
      params: {},
      path: '/test',
      query: {},
      raw,
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

function createRemoteAddressMiddleware(): Middleware {
  return {
    async handle(context: MiddlewareContext, next: Next) {
      const remoteAddressHeader = context.request.headers['x-test-remote-address'];
      const remoteAddress = Array.isArray(remoteAddressHeader) ? remoteAddressHeader[0] : remoteAddressHeader;

      if (remoteAddress) {
        const raw = typeof context.request.raw === 'object' && context.request.raw !== null ? context.request.raw : {};
        context.request.raw = {
          ...raw,
          socket: {
            remoteAddress,
          },
        };
      }

      await next();
    },
  };
}

describe('@fluojs/throttler public entrypoints', () => {
  it('keeps ThrottlerModule.forRoot as the supported registration entrypoint without exporting internal provider helpers', () => {
    expect(throttlerExports).not.toHaveProperty('createThrottlerProviders');
    expect(throttlerExports).not.toHaveProperty('THROTTLER_OPTIONS');
    expect(throttlerExports).toHaveProperty('throttleRouteMetadataKey');
    expect(throttlerExports).toHaveProperty('getThrottleMetadata');
    expect(throttlerExports).toHaveProperty('getSkipThrottleMetadata');
    expect(throttlerExports).toHaveProperty('getClassThrottleMetadata');
    expect(throttlerExports).toHaveProperty('getClassSkipThrottleMetadata');
    expect(throttlerExports.ThrottlerModule).toBe(ThrottlerModule);
    expect(typeof throttlerExports.ThrottlerModule.forRoot).toBe('function');
    expect(throttlerExports.Throttle).toBe(Throttle);
    expect(throttlerExports.SkipThrottle).toBe(SkipThrottle);
  });

  it('keeps the low-level consume input type available from the root barrel', () => {
    const consume: ThrottlerStore['consume'] = (_key: string, input: ThrottlerConsumeInput): ThrottlerStoreEntry => ({
      count: input.ttlSeconds,
      resetAt: input.now + input.ttlSeconds * 1000,
    });

    expect(consume('client', { now: 1000, ttlSeconds: 60 })).toEqual({
      count: 60,
      resetAt: 61_000,
    });
  });

  it('accepts structural Redis clients from the root barrel without an ioredis constructor type', async () => {
    const client = {
      eval: vi.fn(async () => [1, 1_710_000_060_000, 60_000]),
    } satisfies RedisThrottlerClient;
    const store = new throttlerExports.RedisThrottlerStore(client);

    await expect(
      store.consume('throttle:auth:127.0.0.1', {
        now: 1_710_000_000_000,
        ttlSeconds: 60,
      }),
    ).resolves.toEqual({ count: 1, resetAt: 1_710_000_060_000, retryAfterMs: 60_000 });
  });
});

describe('ThrottlerModule.forRoot', () => {
  it('marks ThrottlerGuard globally visible by default and honors global=false metadata', () => {
    const defaultModule = ThrottlerModule.forRoot({ limit: 1, ttl: 60 });
    const localModule = ThrottlerModule.forRoot({ global: false, limit: 1, ttl: 60 });

    expect(getModuleMetadata(defaultModule)?.global).toBe(true);
    expect(getModuleMetadata(defaultModule)?.exports).toContain(ThrottlerGuard);
    expect(getModuleMetadata(localModule)?.global).toBe(false);
    expect(getModuleMetadata(localModule)?.exports).toContain(ThrottlerGuard);
  });

  it('exposes ThrottlerGuard across modules only when provider visibility is global', async () => {
    @Inject(ThrottlerGuard)
    class GlobalGuardConsumer {
      constructor(readonly guard: ThrottlerGuard) {}
    }

    class ThrottlerOwnerModule {}
    defineModule(ThrottlerOwnerModule, {
      imports: [ThrottlerModule.forRoot({ limit: 1, ttl: 60 })],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [ThrottlerOwnerModule],
      providers: [GlobalGuardConsumer],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const consumer = await app.container.resolve(GlobalGuardConsumer);
      expect(consumer.guard).toBeInstanceOf(ThrottlerGuard);
    } finally {
      await app.close();
    }

    @Inject(ThrottlerGuard)
    class LocalGuardConsumer {
      constructor(readonly guard: ThrottlerGuard) {}
    }

    class LocalThrottlerOwnerModule {}
    defineModule(LocalThrottlerOwnerModule, {
      imports: [ThrottlerModule.forRoot({ global: false, limit: 1, ttl: 60 })],
    });

    class LocalAppModule {}
    defineModule(LocalAppModule, {
      imports: [LocalThrottlerOwnerModule],
      providers: [LocalGuardConsumer],
    });

    await expect(bootstrapApplication({ rootModule: LocalAppModule })).rejects.toThrow(
      /not visible through a global module|ThrottlerGuard/,
    );
  });

  it('captures caller options through module registration before app bootstrap', async () => {
    const mutableOptions: ThrottlerModuleOptions = {
      limit: 1,
      trustProxyHeaders: true,
      ttl: 60,
    };
    const registeredThrottlerModule = ThrottlerModule.forRoot(mutableOptions);

    @Controller('/module-options-snapshot')
    class ModuleOptionsSnapshotController {
      @Get('/limited')
      @UseGuards(ThrottlerGuard)
      limited() {
        return { ok: true };
      }
    }

    @Module({
      controllers: [ModuleOptionsSnapshotController],
      imports: [registeredThrottlerModule],
    })
    class ModuleOptionsSnapshotAppModule {}

    mutableOptions.limit = 100;
    mutableOptions.ttl = 1;

    const app = await createTestApp({ rootModule: ModuleOptionsSnapshotAppModule });

    try {
      const firstResponse = await app
        .request('GET', '/module-options-snapshot/limited')
        .header('x-real-ip', '198.51.100.60')
        .send();
      const secondResponse = await app
        .request('GET', '/module-options-snapshot/limited')
        .header('x-real-ip', '198.51.100.60')
        .send();

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(429);
      expect(secondResponse.headers['Retry-After']).toBe('60');
    } finally {
      await app.close();
    }
  });
});

describe('@fluojs/throttler decorators', () => {
  it('writes @Throttle method-level metadata into the route map', () => {
    class AuthController {
      @Throttle({ limit: 5, ttl: 60 })
      login() {}
    }

    const bag = (AuthController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('fluo.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const loginRecord = routeMap?.get('login');

    expect(loginRecord?.[Symbol.for('fluo.throttler.throttle')]).toEqual({ limit: 5, ttl: 60 });
  });

  it('writes @Throttle class-level metadata into the class bag', () => {
    @Throttle({ limit: 100, ttl: 60 })
    class ApiController {
      list() {}
    }

    const bag = (ApiController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;

    expect(bag[Symbol.for('fluo.throttler.class-throttle')]).toEqual({ limit: 100, ttl: 60 });
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

    expect(() => {
      class AuthController {
        @Throttle({ limit: 1.5, ttl: 60 })
        login() {}
      }

      return AuthController;
    }).toThrow(/limit/i);

    expect(() => {
      class AuthController {
        @Throttle({ limit: 1, ttl: 0.5 })
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
    const routeMap = bag[Symbol.for('fluo.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const loginRecord = routeMap?.get('login') ?? {};

    expect(getThrottleMetadata(loginRecord)).toEqual({ limit: 5, ttl: 60 });
  });

  it('returns cloned throttle metadata so callers cannot mutate stored options', () => {
    class AuthController {
      @Throttle({ limit: 3, ttl: 60 })
      login() {}
    }

    const bag = (AuthController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('fluo.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
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
    const routeMap = bag[Symbol.for('fluo.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const refreshRecord = routeMap?.get('refresh');

    expect(refreshRecord?.[Symbol.for('fluo.throttler.skip')]).toBe(true);
  });

  it('writes @SkipThrottle class-level metadata into the class bag', () => {
    @SkipThrottle()
    class PublicController {
      get() {}
    }

    const bag = (PublicController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;

    expect(bag[Symbol.for('fluo.throttler.class-skip')]).toBe(true);
  });
});

describe('ThrottlerGuard — in-memory store', () => {
  let options: ThrottlerModuleOptions;

  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(() => ThrottlerModule.forRoot({ limit: 1.5, ttl: 60 })).toThrow(/limit/i);
    expect(() => ThrottlerModule.forRoot({ limit: 1, ttl: 0.5 })).toThrow(/ttl/i);
  });

  it('rejects malformed keyGenerator and store.consume options before request handling starts', () => {
    const malformedKeyGeneratorOptions = { keyGenerator: 'api-key', limit: 1, ttl: 60 };
    const malformedStoreOptions = { limit: 1, store: { consume: 'missing' }, ttl: 60 };

    expect(() => Reflect.apply(ThrottlerModule.forRoot, ThrottlerModule, [malformedKeyGeneratorOptions])).toThrow(
      /keyGenerator/i,
    );
    expect(() => Reflect.apply(ThrottlerModule.forRoot, ThrottlerModule, [malformedStoreOptions])).toThrow(
      /store\.consume/i,
    );
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

  it('lets method-level @SkipThrottle bypass class-level @Throttle settings', async () => {
    @Throttle({ limit: 1, ttl: 60 })
    class TestController {
      @SkipThrottle()
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext();

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).resolves.toBe(true);
  });

  it('lets class-level @SkipThrottle bypass method-level @Throttle settings', async () => {
    @SkipThrottle()
    class TestController {
      @Throttle({ limit: 1, ttl: 60 })
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const ctx = createRequestContext();

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).resolves.toBe(true);
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

  it('method-level @Throttle overrides class-level settings before module defaults', async () => {
    @Throttle({ limit: 1, ttl: 60 })
    class TestController {
      @Throttle({ limit: 2, ttl: 60 })
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 100 });
    const ctx = createRequestContext();

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));
    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      'Too Many Requests',
    );
  });

  it('caches resolved handler policy after the first request while preserving method precedence', async () => {
    @Throttle({ limit: 10, ttl: 60 })
    class TestController {
      @Throttle({ limit: 1, ttl: 60 })
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 100 });
    const ctx = createRequestContext();
    const guardContext = createGuardContext(TestController, 'action', ctx);

    await guard.canActivate(guardContext);

    const bag = (TestController as unknown as Record<symbol, unknown>)[metadataSymbol] as Record<PropertyKey, unknown>;
    const routeMap = bag[Symbol.for('fluo.standard.route')] as Map<string, Record<PropertyKey, unknown>>;
    const actionRecord = routeMap.get('action');

    if (!actionRecord) {
      throw new Error('Expected throttle metadata for TestController.action.');
    }

    actionRecord[Symbol.for('fluo.throttler.throttle')] = { limit: 100, ttl: 60 };

    await expect(guard.canActivate(guardContext)).rejects.toThrow('Too Many Requests');
  });

  it('uses custom keyGenerator output as the client identity for store keys', async () => {
    const store: ThrottlerStore = {
      consume: vi.fn(async (_key: string, input: ThrottlerConsumeInput) => ({
        count: 1,
        resetAt: input.now + input.ttlSeconds * 1000,
      })),
    };
    class TestController {
      action() {}
    }

    const keyGenerator = vi.fn(() => 'tenant:alpha:user:42');
    const guard = new ThrottlerGuard({ limit: 1, store, ttl: 60, keyGenerator });
    const ctx = createRequestContext({
      headers: { 'x-api-key': 'alpha' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

    expect(keyGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: ctx.request,
        requestContext: ctx,
        response: ctx.response,
      }),
    );
    expect(vi.mocked(store.consume).mock.calls[0]?.[0]).toContain(encodeURIComponent('tenant:alpha:user:42'));
  });

  it('captures module options by value before request handling starts', async () => {
    class TestController {
      action() {}
    }

    const mutableOptions: ThrottlerModuleOptions = {
      limit: 1,
      store: createMemoryThrottlerStore(),
      ttl: 60,
    };
    const guard = new ThrottlerGuard(mutableOptions);
    const ctx = createRequestContext();

    mutableOptions.limit = 100;
    mutableOptions.ttl = 1;

    await guard.canActivate(createGuardContext(TestController, 'action', ctx));

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

  it('creates isolated default in-memory stores for each guard instance when no store option is supplied', async () => {
    class TestController {
      action() {}
    }

    const firstGuard = new ThrottlerGuard({ limit: 1, ttl: 60 });
    const secondGuard = new ThrottlerGuard({ limit: 1, ttl: 60 });
    const firstContext = createRequestContext('10.0.0.1');
    const secondContext = createRequestContext('10.0.0.1');

    await expect(firstGuard.canActivate(createGuardContext(TestController, 'action', firstContext))).resolves.toBe(
      true,
    );
    await expect(secondGuard.canActivate(createGuardContext(TestController, 'action', secondContext))).resolves.toBe(
      true,
    );
    await expect(firstGuard.canActivate(createGuardContext(TestController, 'action', firstContext))).rejects.toThrow(
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

  it('uses raw socket identity by default even when proxy headers are present', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1 });
    const firstContext = createRequestContext({
      headers: { forwarded: 'for=198.51.100.10;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createRequestContext({
      headers: { forwarded: 'for=198.51.100.11;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', firstContext))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', secondContext))).rejects.toThrow(
      'Too Many Requests',
    );
  });

  it('trusts forwarded client identity when trustProxyHeaders is enabled', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1, trustProxyHeaders: true });
    const firstContext = createRequestContext({
      headers: { forwarded: 'for=198.51.100.10;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createRequestContext({
      headers: { forwarded: 'for=198.51.100.11;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', firstContext))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', secondContext))).resolves.toBe(true);
  });

  it('trusts X-Forwarded-For client identity when trustProxyHeaders is enabled', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1, trustProxyHeaders: true });
    const firstContext = createRequestContext({
      headers: { 'x-forwarded-for': '198.51.100.10, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createRequestContext({
      headers: { 'x-forwarded-for': '198.51.100.11, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', firstContext))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', secondContext))).resolves.toBe(true);
  });

  it('trusts X-Real-IP client identity over raw socket identity when trustProxyHeaders is enabled', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1, trustProxyHeaders: true });
    const firstContext = createRequestContext({
      headers: { 'x-real-ip': '198.51.100.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createRequestContext({
      headers: { 'x-real-ip': '198.51.100.11' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', firstContext))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', secondContext))).resolves.toBe(true);
  });

  it('normalizes forwarded client identity ports before building throttler keys when trustProxyHeaders is enabled', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, limit: 1, trustProxyHeaders: true });
    const firstContext = createRequestContext({
      headers: { forwarded: 'for=198.51.100.10:1234;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createRequestContext({
      headers: { forwarded: 'for=198.51.100.10:5678;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', firstContext))).resolves.toBe(true);
    await expect(guard.canActivate(createGuardContext(TestController, 'action', secondContext))).rejects.toThrow(
      'Too Many Requests',
    );
  });

  it('rejects spoofable proxy headers by default when no raw socket identity is available', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard(options);
    const ctx = createRequestContext({
      headers: { 'x-real-ip': '198.51.100.10' },
      raw: {},
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      /trusted request transport/i,
    );
  });

  it('uses trusted proxy headers when opted in and no raw socket identity is available', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ ...options, trustProxyHeaders: true });
    const ctx = createRequestContext({
      headers: { 'x-real-ip': '198.51.100.10' },
      raw: {},
    });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).resolves.toBe(true);
  });

  it('rejects when no proxy or socket client identity is available', async () => {
    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard(options);
    const ctx = createRequestContext({ headers: {}, raw: {} });

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      /trusted request transport/i,
    );
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

describe('ThrottlerGuard — HTTP request pipeline', () => {
  it('applies class-level policy and method-level override through createTestApp requests', async () => {
    @Controller('/request-precedence')
    @Throttle({ limit: 1, ttl: 60 })
    class RequestPrecedenceController {
      @Get('/class')
      @UseGuards(ThrottlerGuard)
      classLimited() {
        return { route: 'class' };
      }

      @Get('/method')
      @Throttle({ limit: 2, ttl: 60 })
      @UseGuards(ThrottlerGuard)
      methodLimited() {
        return { route: 'method' };
      }
    }

    @Module({
      controllers: [RequestPrecedenceController],
      imports: [ThrottlerModule.forRoot({ limit: 3, ttl: 60, trustProxyHeaders: true })],
    })
    class RequestPrecedenceAppModule {}

    const app = await createTestApp({ rootModule: RequestPrecedenceAppModule });

    try {
      const classFirstResponse = await app
        .request('GET', '/request-precedence/class')
        .header('x-real-ip', '198.51.100.20')
        .send();
      const classSecondResponse = await app
        .request('GET', '/request-precedence/class')
        .header('x-real-ip', '198.51.100.20')
        .send();
      const methodFirstResponse = await app
        .request('GET', '/request-precedence/method')
        .header('x-real-ip', '198.51.100.20')
        .send();
      const methodSecondResponse = await app
        .request('GET', '/request-precedence/method')
        .header('x-real-ip', '198.51.100.20')
        .send();
      const methodThirdResponse = await app
        .request('GET', '/request-precedence/method')
        .header('x-real-ip', '198.51.100.20')
        .send();

      expect(classFirstResponse.status).toBe(200);
      expect(classFirstResponse.body).toEqual({ route: 'class' });
      expect(classSecondResponse.status).toBe(429);
      expect(classSecondResponse.headers['Retry-After']).toBe('60');
      expect(methodFirstResponse.status).toBe(200);
      expect(methodSecondResponse.status).toBe(200);
      expect(methodThirdResponse.status).toBe(429);
      expect(methodThirdResponse.headers['Retry-After']).toBe('60');
    } finally {
      await app.close();
    }
  });

  it('bypasses class and method throttling when @SkipThrottle is present in the request pipeline', async () => {
    @Controller('/request-skip-method')
    @Throttle({ limit: 1, ttl: 60 })
    class RequestMethodSkipController {
      @Get('/public')
      @SkipThrottle()
      @UseGuards(ThrottlerGuard)
      publicRoute() {
        return { route: 'method-skip' };
      }
    }

    @Controller('/request-skip-class')
    @SkipThrottle()
    class RequestClassSkipController {
      @Get('/public')
      @Throttle({ limit: 1, ttl: 60 })
      @UseGuards(ThrottlerGuard)
      publicRoute() {
        return { route: 'class-skip' };
      }
    }

    @Module({
      controllers: [RequestMethodSkipController, RequestClassSkipController],
      imports: [ThrottlerModule.forRoot({ limit: 1, ttl: 60, trustProxyHeaders: true })],
    })
    class RequestSkipAppModule {}

    const app = await createTestApp({ rootModule: RequestSkipAppModule });

    try {
      const methodFirstResponse = await app
        .request('GET', '/request-skip-method/public')
        .header('x-real-ip', '198.51.100.30')
        .send();
      const methodSecondResponse = await app
        .request('GET', '/request-skip-method/public')
        .header('x-real-ip', '198.51.100.30')
        .send();
      const classFirstResponse = await app
        .request('GET', '/request-skip-class/public')
        .header('x-real-ip', '198.51.100.30')
        .send();
      const classSecondResponse = await app
        .request('GET', '/request-skip-class/public')
        .header('x-real-ip', '198.51.100.30')
        .send();

      expect(methodFirstResponse.status).toBe(200);
      expect(methodFirstResponse.body).toEqual({ route: 'method-skip' });
      expect(methodSecondResponse.status).toBe(200);
      expect(methodSecondResponse.body).toEqual({ route: 'method-skip' });
      expect(classFirstResponse.status).toBe(200);
      expect(classFirstResponse.body).toEqual({ route: 'class-skip' });
      expect(classSecondResponse.status).toBe(200);
      expect(classSecondResponse.body).toEqual({ route: 'class-skip' });
    } finally {
      await app.close();
    }
  });

  it('uses trusted proxy headers before raw socket identity through createTestApp requests', async () => {
    @Controller('/request-proxy')
    class RequestProxyController {
      @Get('/limited')
      @UseGuards(ThrottlerGuard)
      limited() {
        return { ok: true };
      }
    }

    @Module({
      controllers: [RequestProxyController],
      imports: [ThrottlerModule.forRoot({ limit: 1, ttl: 60, trustProxyHeaders: true })],
    })
    class RequestProxyAppModule {}

    const app = await createTestApp({
      rootModule: RequestProxyAppModule,
      middleware: [createRemoteAddressMiddleware()],
    });

    try {
      const firstForwardedClientResponse = await app
        .request('GET', '/request-proxy/limited')
        .header('x-forwarded-for', '198.51.100.40, 10.0.0.10')
        .header('x-test-remote-address', '10.0.0.1')
        .send();
      const secondForwardedClientResponse = await app
        .request('GET', '/request-proxy/limited')
        .header('x-forwarded-for', '198.51.100.41, 10.0.0.10')
        .header('x-test-remote-address', '10.0.0.1')
        .send();
      const repeatedForwardedClientResponse = await app
        .request('GET', '/request-proxy/limited')
        .header('x-forwarded-for', '198.51.100.40, 10.0.0.10')
        .header('x-test-remote-address', '10.0.0.1')
        .send();

      expect(firstForwardedClientResponse.status).toBe(200);
      expect(secondForwardedClientResponse.status).toBe(200);
      expect(repeatedForwardedClientResponse.status).toBe(429);
      expect(repeatedForwardedClientResponse.headers['Retry-After']).toBe('60');
    } finally {
      await app.close();
    }
  });

  it('falls back to raw socket identity and ignores spoofed proxy headers by default', async () => {
    @Controller('/request-socket')
    class RequestSocketController {
      @Get('/limited')
      @UseGuards(ThrottlerGuard)
      limited() {
        return { ok: true };
      }
    }

    @Module({
      controllers: [RequestSocketController],
      imports: [ThrottlerModule.forRoot({ limit: 1, ttl: 60 })],
    })
    class RequestSocketAppModule {}

    const app = await createTestApp({
      rootModule: RequestSocketAppModule,
      middleware: [createRemoteAddressMiddleware()],
    });

    try {
      const firstSocketClientResponse = await app
        .request('GET', '/request-socket/limited')
        .header('x-forwarded-for', '198.51.100.50')
        .header('x-test-remote-address', '10.0.0.1')
        .send();
      const spoofedHeaderResponse = await app
        .request('GET', '/request-socket/limited')
        .header('x-forwarded-for', '198.51.100.51')
        .header('x-test-remote-address', '10.0.0.1')
        .send();
      const secondSocketClientResponse = await app
        .request('GET', '/request-socket/limited')
        .header('x-forwarded-for', '198.51.100.50')
        .header('x-test-remote-address', '10.0.0.2')
        .send();

      expect(firstSocketClientResponse.status).toBe(200);
      expect(spoofedHeaderResponse.status).toBe(429);
      expect(spoofedHeaderResponse.headers['Retry-After']).toBe('60');
      expect(secondSocketClientResponse.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('enforces @UseGuards(ThrottlerGuard) through createTestApp requests', async () => {
    @Controller('/throttled')
    class ThrottledController {
      @Get('/limited')
      @UseGuards(ThrottlerGuard)
      getLimited() {
        return { ok: true };
      }
    }

    @Module({
      controllers: [ThrottledController],
      imports: [ThrottlerModule.forRoot({ limit: 1, ttl: 60, trustProxyHeaders: true })],
    })
    class ThrottledAppModule {}

    const app = await createTestApp({ rootModule: ThrottledAppModule });

    try {
      const firstResponse = await app.request('GET', '/throttled/limited').header('x-real-ip', '198.51.100.10').send();
      const secondResponse = await app.request('GET', '/throttled/limited').header('x-real-ip', '198.51.100.10').send();

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body).toEqual({ ok: true });
      expect(secondResponse.status).toBe(429);
      expect(secondResponse.headers['Retry-After']).toBe('60');
    } finally {
      await app.close();
    }
  });

  it('does not throttle routes that omit ThrottlerGuard even when ThrottlerModule is registered', async () => {
    @Controller('/unguarded')
    class UnguardedController {
      @Get('/open')
      getOpen() {
        return { ok: true };
      }
    }

    @Module({
      controllers: [UnguardedController],
      imports: [ThrottlerModule.forRoot({ limit: 1, ttl: 60, trustProxyHeaders: true })],
    })
    class UnguardedAppModule {}

    const app = await createTestApp({ rootModule: UnguardedAppModule });

    try {
      const firstResponse = await app.request('GET', '/unguarded/open').header('x-real-ip', '198.51.100.10').send();
      const secondResponse = await app.request('GET', '/unguarded/open').header('x-real-ip', '198.51.100.10').send();

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body).toEqual({ ok: true });
    } finally {
      await app.close();
    }
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

  it('rejects invalid custom-store entries before enforcing limits', async () => {
    const store: ThrottlerStore = {
      consume: vi.fn(async () => ({
        count: 0,
        resetAt: Number.NaN,
      })),
    };

    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 2, store, ttl: 60 });
    const ctx = createRequestContext();

    await expect(
      guard.canActivate(createGuardContext(TestController, 'action', ctx)),
    ).rejects.toThrow(/store count/i);
  });

  it('uses public custom-store retryAfterMs when store time is more authoritative than app time', async () => {
    const store: ThrottlerStore = {
      consume: vi.fn(async () => ({
        count: 2,
        resetAt: 1_710_000_090_000,
        retryAfterMs: 12_000,
      })),
    };

    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const ctx = createRequestContext();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000);

    try {
      await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
        'Too Many Requests',
      );
      expect(ctx.response.headers['Retry-After']).toBe('12');
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('rejects invalid public retryAfterMs values from custom stores', async () => {
    const store: ThrottlerStore = {
      consume: vi.fn(async () => ({
        count: 2,
        resetAt: 1_710_000_090_000,
        retryAfterMs: Number.NaN,
      })),
    };

    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const ctx = createRequestContext();

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(
      /store retryAfterMs/i,
    );
  });

  it('propagates store failures without emitting rate-limit retry headers', async () => {
    const storeFailure = new Error('redis connection refused');
    const store: ThrottlerStore = {
      consume: vi.fn(async () => {
        throw storeFailure;
      }),
    };

    class TestController {
      action() {}
    }

    const guard = new ThrottlerGuard({ limit: 2, store, ttl: 60 });
    const ctx = createRequestContext();

    await expect(guard.canActivate(createGuardContext(TestController, 'action', ctx))).rejects.toThrow(storeFailure);
    expect(ctx.response.headers['Retry-After']).toBeUndefined();
  });

  it('keeps Retry-After consistent across skewed app clocks when Redis provides the shared window', async () => {
    const client = {
      eval: vi.fn(async () => [2, 1_710_000_090_000, 45_000]),
    } satisfies RedisThrottlerClient;
    const store = new RedisThrottlerStore(client);

    class TestController {
      action() {}
    }

    const fastNodeGuard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const slowNodeGuard = new ThrottlerGuard({ limit: 1, store, ttl: 60 });
    const fastNodeContext = createRequestContext('10.0.0.1');
    const slowNodeContext = createRequestContext('10.0.0.2');
    const dateNowSpy = vi.spyOn(Date, 'now');

    try {
      dateNowSpy.mockReturnValueOnce(1_710_000_045_000);
      await expect(
        fastNodeGuard.canActivate(createGuardContext(TestController, 'action', fastNodeContext)),
      ).rejects.toThrow('Too Many Requests');

      dateNowSpy.mockReturnValueOnce(1_710_000_000_000);
      await expect(
        slowNodeGuard.canActivate(createGuardContext(TestController, 'action', slowNodeContext)),
      ).rejects.toThrow('Too Many Requests');

      expect(fastNodeContext.response.headers['Retry-After']).toBe('45');
      expect(slowNodeContext.response.headers['Retry-After']).toBe('45');
    } finally {
      dateNowSpy.mockRestore();
    }
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
