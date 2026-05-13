import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { getRedisClientToken, REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule, type PlatformComponent } from '@fluojs/runtime';
import { createTestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { createMemoryHealthIndicatorProvider, MemoryHealthIndicator } from './indicators/memory.js';
import { createRedisHealthIndicatorProvider, RedisHealthIndicator } from './indicators/redis.js';
import { TerminusModule } from './module.js';
import type { HealthIndicator } from './types.js';

type TestResponse = FrameworkResponse & { body?: unknown };

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

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('TerminusModule.forRoot', () => {
  it('returns 200 health details and ready status when all indicators are healthy', async () => {
    const indicators: HealthIndicator[] = [new MemoryHealthIndicator({ key: 'database' })];
    const terminusModule = TerminusModule.forRoot({ indicators });

    class AppModule {}

    defineModule(AppModule, {
      imports: [terminusModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(200);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const customHealthResponse = createResponse();
    await app.dispatch(createRequest('/internal/health'), customHealthResponse);

    expect(customHealthResponse.statusCode).toBe(200);
    expect(customHealthResponse.body).toMatchObject({
      details: {
        database: {
          status: 'up',
        },
      },
      status: 'ok',
    });

    const customReadyResponse = createResponse();
    await app.dispatch(createRequest('/internal/ready'), customReadyResponse);

    expect(customReadyResponse.statusCode).toBe(200);
    expect(customReadyResponse.body).toEqual({ status: 'ready' });

    const defaultHealthResponse = createResponse();
    await app.dispatch(createRequest('/health'), defaultHealthResponse);

    expect(defaultHealthResponse.statusCode).toBe(404);

    const defaultReadyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), defaultReadyResponse);

    expect(defaultReadyResponse.statusCode).toBe(404);

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
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

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const firstHealth = createResponse();
    await app.dispatch(createRequest('/health'), firstHealth);
    expect(firstHealth.statusCode).toBe(200);

    healthy = false;

    const secondHealth = createResponse();
    await app.dispatch(createRequest('/health'), secondHealth);
    expect(secondHealth.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);
    expect(healthResponse.statusCode).toBe(200);

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);
    expect(healthResponse.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);
    expect(healthResponse.statusCode).toBe(200);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(200);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
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

    const app = await bootstrapApplication({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
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

    const app = await bootstrapApplication({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const readyBeforeClose = createResponse();
    await app.dispatch(createRequest('/ready'), readyBeforeClose);
    expect(readyBeforeClose.statusCode).toBe(200);
    expect(readyBeforeClose.body).toEqual({ status: 'ready' });

    const closePromise = app.close('SIGTERM');
    await shutdownStarted.promise;

    const readyDuringClose = createResponse();
    await app.dispatch(createRequest('/ready'), readyDuringClose);
    expect(readyDuringClose.statusCode).toBe(503);
    expect(readyDuringClose.body).toEqual({ status: 'starting' });

    shutdownBlocker.resolve();
    await closePromise;
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

    const app = await bootstrapApplication({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('does not overwrite user indicators that reuse fixed platform diagnostic keys', async () => {
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

    const app = await bootstrapApplication({
      platform: {
        components: [component],
      },
      rootModule: AppModule,
    });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(503);
    expect(healthResponse.body).toMatchObject({
      contributors: {
        down: [
          'fluo-platform-health-duplicate-key-error',
          'fluo-platform-readiness-duplicate-key-error',
        ],
        up: ['fluo-platform-health', 'fluo-platform-readiness'],
      },
      details: {
        'fluo-platform-health': { status: 'up' },
        'fluo-platform-health-duplicate-key-error': {
          message: 'Platform diagnostic key "fluo-platform-health" collided with an existing health result key.',
          status: 'down',
        },
        'fluo-platform-readiness': { status: 'up' },
        'fluo-platform-readiness-duplicate-key-error': {
          message: 'Platform diagnostic key "fluo-platform-readiness" collided with an existing health result key.',
          status: 'down',
        },
      },
      status: 'error',
    });

    await app.close();
  });
});
