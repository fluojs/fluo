import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { getRedisClientToken, REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule, type PlatformComponent } from '@fluojs/runtime';

import { MemoryHealthIndicator } from './indicators/memory.js';
import { createRedisHealthIndicatorProvider, RedisHealthIndicator } from './indicators/redis.js';
import { TerminusModule } from './module.js';
import type { HealthIndicator } from './types.js';

type TestResponse = FrameworkResponse & { body?: unknown };

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

  it('applies execution timeouts to /health and /ready checks', async () => {
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

    const app = await bootstrapApplication({ rootModule: AppModule });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);

    expect(healthResponse.statusCode).toBe(503);
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

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);

    expect(readyResponse.statusCode).toBe(503);
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
        down: [],
        up: ['database'],
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
});
