import { Inject } from '@fluojs/core';
import { getPrismaClientToken, getPrismaServiceToken } from '@fluojs/prisma';
import { getRedisClientToken, REDIS_CLIENT } from '@fluojs/redis';
import { defineModule, type PlatformComponent } from '@fluojs/runtime';
import { createTestApp, createTestingModule } from '@fluojs/testing';
import { describe, expect, it, vi } from 'vitest';

import { createHttpHealthIndicatorProvider } from './indicators/http.js';
import { createMemoryHealthIndicatorProvider, MemoryHealthIndicator } from './indicators/memory.js';
import { createPrismaHealthIndicatorProvider } from './indicators/prisma.js';
import { createRedisHealthIndicatorProvider, RedisHealthIndicator } from './indicators/redis.js';
import { TerminusModule } from './module.js';
import { TERMINUS_INDICATOR_PROVIDER_TOKENS } from './tokens.js';
import type { HealthIndicator } from './types.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe('TerminusModule.forRoot', () => {
  it('returns 200 health details and ready status when all indicators are healthy', async () => {
    const indicators: HealthIndicator[] = [new MemoryHealthIndicator({ key: 'database' })];
    const terminusModule = TerminusModule.forRoot({ indicators });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: [],
          up: ['database'],
        },
        details: {
          database: {
            status: 'up',
          },
        },
        info: {
          database: {
            status: 'up',
          },
        },
        platform: {
          health: {
            status: 'healthy',
          },
          readiness: {
            status: 'ready',
          },
        },
        status: 'ok',
      });

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('mounts /health and /ready under the configured custom path', async () => {
    const indicators: HealthIndicator[] = [new MemoryHealthIndicator({ key: 'database' })];
    const terminusModule = TerminusModule.forRoot({
      indicators,
      path: '/internal',
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const customHealthResponse = await app.request('GET', '/internal/health').send();

      expect(customHealthResponse.status).toBe(200);
      expect(customHealthResponse.body).toMatchObject({
        details: {
          database: {
            status: 'up',
          },
        },
        status: 'ok',
      });

      const customReadyResponse = await app.request('GET', '/internal/ready').send();

      expect(customReadyResponse.status).toBe(200);
      expect(customReadyResponse.body).toEqual({ status: 'ready' });

      const defaultHealthResponse = await app.request('GET', '/health').send();

      expect(defaultHealthResponse.status).toBe(404);

      const defaultReadyResponse = await app.request('GET', '/ready').send();

      expect(defaultReadyResponse.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns 503 on /health and /ready when indicators fail', async () => {
    const indicators: HealthIndicator[] = [
      new RedisHealthIndicator({
        key: 'redis',
        ping: async () => {
          throw new Error('redis down');
        },
      }),
    ];
    const terminusModule = TerminusModule.forRoot({ indicators });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: ['redis'],
          up: [],
        },
        error: {
          redis: {
            message: 'redis down',
            status: 'down',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('applies execution timeouts through request-facing /health and /ready endpoints', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'database',
        check: async () => new Promise(() => undefined),
      },
    ];
    const terminusModule = TerminusModule.forRoot({
      execution: {
        indicatorTimeoutMs: 5,
      },
      indicators,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: ['database'],
          up: [],
        },
        error: {
          database: {
            message: 'Health indicator timed out after 5ms.',
            status: 'down',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('supports custom indicators that transition from up to down after bootstrap', async () => {
    let healthy = true;
    const indicators: HealthIndicator[] = [
      {
        key: 'custom',
        check: async (key: string) => (healthy
          ? { [key]: { mode: 'stable', status: 'up' } }
          : { [key]: { message: 'dependency degraded', status: 'down' } }),
      },
    ];

    const terminusModule = TerminusModule.forRoot({ indicators });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const firstHealth = await app.request('GET', '/health').send();
      expect(firstHealth.status).toBe(200);

      healthy = false;

      const secondHealth = await app.request('GET', '/health').send();
      expect(secondHealth.status).toBe(503);
      expect(secondHealth.body).toMatchObject({
        contributors: {
          down: ['custom'],
          up: [],
        },
        error: {
          custom: {
            message: 'dependency degraded',
            status: 'down',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();
      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('composes user-provided readiness checks with indicator readiness checks', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'database',
        check: async (key: string) => ({ [key]: { status: 'up' } }),
      },
    ];

    const terminusModule = TerminusModule.forRoot({
      indicators,
      readinessChecks: [() => false],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();
      expect(healthResponse.status).toBe(200);

      const readyResponse = await app.request('GET', '/ready').send();
      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('uses indicatorProviders for both /health and /ready checks', async () => {
    class RedisIndicatorModule {}
    defineModule(RedisIndicatorModule, {
      exports: [REDIS_CLIENT],
      global: true,
      providers: [
        {
          provide: REDIS_CLIENT,
          useValue: {
            ping: async () => {
              throw new Error('redis down');
            },
          },
        },
      ],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        RedisIndicatorModule,
        TerminusModule.forRoot({
          indicatorProviders: [createRedisHealthIndicatorProvider({ key: 'redis' })],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();
      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: ['redis'],
          up: [],
        },
        error: {
          redis: {
            message: 'redis down',
            status: 'down',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();
      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('exports indicator provider token lists to downstream DI consumers', async () => {
    @Inject(TERMINUS_INDICATOR_PROVIDER_TOKENS)
    class ProviderTokenConsumer {
      constructor(readonly tokens: readonly unknown[]) {}
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        TerminusModule.forRoot({
          indicatorProviders: [createMemoryHealthIndicatorProvider({ key: 'memory' })],
        }),
      ],
      providers: [ProviderTokenConsumer],
    });

    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    try {
      const consumer = await testingModule.resolve<ProviderTokenConsumer>(ProviderTokenConsumer);

      expect(consumer.tokens).toHaveLength(1);
      expect(typeof consumer.tokens[0]).toBe('symbol');
    } finally {
      await testingModule.container.dispose();
    }
  });

  it('supports default and named redis indicator providers without token collisions', async () => {
    const namedRedisToken = getRedisClientToken('cache');

    class RedisIndicatorModule {}
    defineModule(RedisIndicatorModule, {
      exports: [REDIS_CLIENT, namedRedisToken],
      global: true,
      providers: [
        {
          provide: REDIS_CLIENT,
          useValue: {
            ping: async () => 'PONG',
          },
        },
        {
          provide: namedRedisToken,
          useValue: {
            ping: async () => 'PONG',
          },
        },
      ],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        RedisIndicatorModule,
        TerminusModule.forRoot({
          indicatorProviders: [
            createRedisHealthIndicatorProvider({ key: 'redis' }),
            createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' }),
          ],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        details: {
          'cache-redis': {
            status: 'up',
          },
          redis: {
            status: 'up',
          },
        },
        status: 'ok',
      });
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: [],
        },
      });
      expect((healthResponse.body as { contributors: { up: string[] } }).contributors.up).toEqual(
        expect.arrayContaining(['redis', 'cache-redis']),
      );

      const readyResponse = await app.request('GET', '/ready').send();
      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('prefers name-aware Prisma service providers while retaining raw client fallback', async () => {
    const defaultServiceQuery = vi.fn(async (_query: string) => undefined);
    const namedServiceQuery = vi.fn(async (_query: string) => undefined);
    const rawDefaultQuery = vi.fn(async (_query: string) => {
      throw new Error('raw default client should not be probed when the Prisma service is present');
    });
    const rawNamedQuery = vi.fn(async (_query: string) => undefined);
    const namedServiceToken = getPrismaServiceToken('analytics');
    const namedClientToken = getPrismaClientToken('analytics');

    class PrismaIndicatorModule {}
    defineModule(PrismaIndicatorModule, {
      exports: [getPrismaServiceToken(), getPrismaClientToken(), namedServiceToken, namedClientToken],
      global: true,
      providers: [
        {
          provide: getPrismaServiceToken(),
          useValue: {
            createPlatformStatusSnapshot: () => ({
              details: { lifecycleState: 'ready' },
              health: { status: 'healthy' },
              readiness: { status: 'ready' },
            }),
            current: () => ({
              $queryRawUnsafe: defaultServiceQuery,
            }),
          },
        },
        {
          provide: getPrismaClientToken(),
          useValue: {
            $queryRawUnsafe: rawDefaultQuery,
          },
        },
        {
          provide: namedServiceToken,
          useValue: {
            createPlatformStatusSnapshot: () => ({
              details: { lifecycleState: 'ready', name: 'analytics' },
              health: { status: 'healthy' },
              readiness: { status: 'ready' },
            }),
            current: () => ({
              $queryRawUnsafe: namedServiceQuery,
            }),
          },
        },
        {
          provide: namedClientToken,
          useValue: {
            $queryRawUnsafe: rawNamedQuery,
          },
        },
      ],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        PrismaIndicatorModule,
        TerminusModule.forRoot({
          indicatorProviders: [
            createPrismaHealthIndicatorProvider({ key: 'prisma' }),
            createPrismaHealthIndicatorProvider({ key: 'analytics-prisma', name: 'analytics' }),
            createPrismaHealthIndicatorProvider({ clientToken: namedClientToken, key: 'analytics-raw-prisma' }),
          ],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        details: {
          'analytics-prisma': {
            details: { lifecycleState: 'ready', name: 'analytics' },
            healthStatus: 'healthy',
            readinessStatus: 'ready',
            status: 'up',
          },
          'analytics-raw-prisma': {
            status: 'up',
          },
          prisma: {
            details: { lifecycleState: 'ready' },
            healthStatus: 'healthy',
            readinessStatus: 'ready',
            status: 'up',
          },
        },
        status: 'ok',
      });
      expect(defaultServiceQuery).toHaveBeenCalledWith('SELECT 1');
      expect(namedServiceQuery).toHaveBeenCalledWith('SELECT 1');
      expect(rawDefaultQuery).not.toHaveBeenCalled();
      expect(rawNamedQuery).toHaveBeenCalledWith('SELECT 1');
    } finally {
      await app.close();
    }
  });

  it('supports repeatable same-type indicator providers without token collisions', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        TerminusModule.forRoot({
          indicatorProviders: [
            createMemoryHealthIndicatorProvider({ key: 'heap' }),
            createMemoryHealthIndicatorProvider({ key: 'rss' }),
          ],
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: [],
        },
        details: {
          heap: {
            status: 'up',
          },
          rss: {
            status: 'up',
          },
        },
        status: 'ok',
      });
      expect((healthResponse.body as { contributors: { up: string[] } }).contributors.up).toEqual(
        expect.arrayContaining(['heap', 'rss']),
      );

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('supports repeatable same-type HTTP indicator providers without token collisions', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(undefined, { status: 204 }));

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        TerminusModule.forRoot({
          indicatorProviders: [
            createHttpHealthIndicatorProvider({ key: 'primary-api', url: 'https://example.com/primary/health' }),
            createHttpHealthIndicatorProvider({ key: 'secondary-api', url: 'https://example.com/secondary/health' }),
          ],
        }),
      ],
    });

    try {
      const app = await createTestApp({ rootModule: AppModule });

      try {
        const healthResponse = await app.request('GET', '/health').send();

        expect(healthResponse.status).toBe(200);
        expect(healthResponse.body).toMatchObject({
          contributors: {
            down: [],
          },
          details: {
            'primary-api': {
              status: 'up',
            },
            'secondary-api': {
              status: 'up',
            },
          },
          status: 'ok',
        });
        expect((healthResponse.body as { contributors: { up: string[] } }).contributors.up).toEqual(
          expect.arrayContaining(['primary-api', 'secondary-api']),
        );
        expect(fetch).toHaveBeenCalledTimes(2);
      } finally {
        await app.close();
      }
    } finally {
      fetch.mockRestore();
    }
  });

  it('aligns /health and /ready with runtime platform readiness semantics', async () => {
    const component: PlatformComponent = {
      async health() {
        return { status: 'healthy' };
      },
      id: 'redis.default',
      kind: 'redis',
      async ready() {
        return { critical: true, reason: 'redis not ready', status: 'not-ready' };
      },
      snapshot() {
        return {
          dependencies: [],
          details: { mode: 'external' },
          health: { status: 'healthy' },
          id: 'redis.default',
          kind: 'redis',
          ownership: { externallyManaged: true, ownsResources: false },
          readiness: { critical: true, reason: 'redis not ready', status: 'not-ready' },
          state: 'starting',
          telemetry: { namespace: 'redis', tags: {} },
        };
      },
      async start() {},
      state() {
        return 'starting';
      },
      async stop() {},
      async validate() {
        return { issues: [], ok: true };
      },
    };

    const indicators: HealthIndicator[] = [
      {
        key: 'database',
        check: async (key: string) => ({ [key]: { status: 'up' } }),
      },
    ];

    class AppModule {}
    defineModule(AppModule, {
      imports: [TerminusModule.forRoot({ indicators })],
    });

    const app = await createTestApp({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: ['fluo-platform-readiness'],
          up: ['database'],
        },
        error: {
          'fluo-platform-readiness': {
            critical: true,
            message: 'redis not ready',
            platformStatus: 'not-ready',
            status: 'down',
          },
        },
        platform: {
          health: {
            status: 'healthy',
          },
          readiness: {
            reason: 'redis not ready',
            status: 'not-ready',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('treats non-critical degraded platform readiness as unavailable for the HTTP readiness gate', async () => {
    const component: PlatformComponent = {
      async health() {
        return { status: 'healthy' };
      },
      id: 'search.optional',
      kind: 'search',
      async ready() {
        return { critical: false, reason: 'search index warming', status: 'degraded' };
      },
      snapshot() {
        return {
          dependencies: [],
          details: { mode: 'optional' },
          health: { status: 'healthy' },
          id: 'search.optional',
          kind: 'search',
          ownership: { externallyManaged: true, ownsResources: false },
          readiness: { critical: false, reason: 'search index warming', status: 'degraded' },
          state: 'degraded',
          telemetry: { namespace: 'search', tags: {} },
        };
      },
      async start() {},
      state() {
        return 'degraded';
      },
      async stop() {},
      async validate() {
        return { issues: [], ok: true };
      },
    };
    const indicators: HealthIndicator[] = [
      {
        key: 'database',
        check: async (key: string) => ({ [key]: { status: 'up' } }),
      },
    ];

    class AppModule {}
    defineModule(AppModule, {
      imports: [TerminusModule.forRoot({ indicators })],
    });

    const app = await createTestApp({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        error: {
          'fluo-platform-readiness': {
            critical: false,
            message: 'search index warming',
            platformStatus: 'degraded',
            status: 'down',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();

      expect(readyResponse.status).toBe(503);
      expect(readyResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('keeps Terminus HTTP readiness out of rotation while shutdown is in progress', async () => {
    const shutdownBlocker = createDeferred<void>();
    const shutdownStarted = createDeferred<void>();

    class BlockingShutdownService {
      onApplicationShutdown() {
        shutdownStarted.resolve();

        return shutdownBlocker.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [TerminusModule.forRoot({
        indicators: [
          {
            key: 'database',
            check: async (key: string) => ({ [key]: { status: 'up' } }),
          },
        ],
      })],
      providers: [BlockingShutdownService],
    });

    const app = await createTestApp({ rootModule: AppModule });

    const readyBeforeClose = await app.request('GET', '/ready').send();
    expect(readyBeforeClose.status).toBe(200);
    expect(readyBeforeClose.body).toEqual({ status: 'ready' });

    const closePromise = app.close();

    try {
      await shutdownStarted.promise;

      const readyDuringClose = await app.request('GET', '/ready').send();
      expect(readyDuringClose.status).toBe(503);
      expect(readyDuringClose.body).toEqual({ status: 'starting' });
    } finally {
      shutdownBlocker.resolve();
      await closePromise;
    }
  });

  it('reports platform health failures as explicit Terminus diagnostics', async () => {
    const component: PlatformComponent = {
      async health() {
        return { reason: 'database pool exhausted', status: 'unhealthy' };
      },
      id: 'database.default',
      kind: 'database',
      async ready() {
        return { critical: true, status: 'ready' };
      },
      snapshot() {
        return {
          dependencies: [],
          details: {},
          health: { reason: 'database pool exhausted', status: 'unhealthy' },
          id: 'database.default',
          kind: 'database',
          ownership: { externallyManaged: true, ownsResources: false },
          readiness: { critical: true, status: 'ready' },
          state: 'degraded',
          telemetry: { namespace: 'database', tags: {} },
        };
      },
      async start() {},
      state() {
        return 'degraded';
      },
      async stop() {},
      async validate() {
        return { issues: [], ok: true };
      },
    };

    class AppModule {}
    defineModule(AppModule, {
      imports: [TerminusModule.forRoot()],
    });

    const app = await createTestApp({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: ['fluo-platform-health'],
          up: [],
        },
        error: {
          'fluo-platform-health': {
            message: 'database pool exhausted',
            platformStatus: 'unhealthy',
            status: 'down',
          },
        },
        status: 'error',
      });

      const readyResponse = await app.request('GET', '/ready').send();
      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('keeps platform diagnostic payloads under reserved keys when user indicators reuse them', async () => {
    const component: PlatformComponent = {
      async health() {
        return { reason: 'runtime unhealthy', status: 'unhealthy' };
      },
      id: 'runtime.default',
      kind: 'runtime',
      async ready() {
        return { critical: true, reason: 'runtime not ready', status: 'not-ready' };
      },
      snapshot() {
        return {
          dependencies: [],
          details: {},
          health: { reason: 'runtime unhealthy', status: 'unhealthy' },
          id: 'runtime.default',
          kind: 'runtime',
          ownership: { externallyManaged: true, ownsResources: false },
          readiness: { critical: true, reason: 'runtime not ready', status: 'not-ready' },
          state: 'degraded',
          telemetry: { namespace: 'runtime', tags: {} },
        };
      },
      async start() {},
      state() {
        return 'degraded';
      },
      async stop() {},
      async validate() {
        return { issues: [], ok: true };
      },
    };
    const indicators: HealthIndicator[] = [
      {
        key: 'reserved-collision-probe',
        check: async () => ({
          'fluo-platform-health': { status: 'up' },
          'fluo-platform-readiness': { status: 'up' },
        }),
      },
    ];

    class AppModule {}
    defineModule(AppModule, {
      imports: [TerminusModule.forRoot({ indicators })],
    });

    const app = await createTestApp({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    try {
      const healthResponse = await app.request('GET', '/health').send();

      expect(healthResponse.status).toBe(503);
      expect(healthResponse.body).toMatchObject({
        contributors: {
          down: [
            'fluo-platform-health-user-key-collision',
            'fluo-platform-health',
            'fluo-platform-readiness-user-key-collision',
            'fluo-platform-readiness',
          ],
          up: [],
        },
        details: {
          'fluo-platform-health': {
            message: 'runtime unhealthy',
            platformStatus: 'unhealthy',
            status: 'down',
          },
          'fluo-platform-health-user-key-collision': {
            message: 'User health result key "fluo-platform-health" is reserved for Terminus platform diagnostics; the platform diagnostic remains available under the reserved key.',
            status: 'down',
          },
          'fluo-platform-readiness': {
            critical: true,
            message: 'runtime not ready',
            platformStatus: 'not-ready',
            status: 'down',
          },
          'fluo-platform-readiness-user-key-collision': {
            message: 'User health result key "fluo-platform-readiness" is reserved for Terminus platform diagnostics; the platform diagnostic remains available under the reserved key.',
            status: 'down',
          },
        },
        status: 'error',
      });
    } finally {
      await app.close();
    }
  });
});
