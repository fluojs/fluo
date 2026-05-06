import { Inject } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRedisInstance {
  options: Record<string, unknown>;
  status: string;
  connect(): Promise<void>;
  disconnect(): void;
  quit(): Promise<'OK'>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<'OK'>;
  del(key: string): Promise<number>;
}

const mockRedisState = vi.hoisted(() => ({
  connectError: undefined as Error | undefined,
  disconnectLeavesOpen: false,
  events: [] as string[],
  instances: [] as MockRedisInstance[],
  quitError: undefined as Error | undefined,
  setCalls: [] as Array<{ args: unknown[]; key: string; value: string }>,
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    readonly options: Record<string, unknown>;
    status = 'wait';
    private readonly storage = new Map<string, string>();

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      mockRedisState.instances.push(this);
    }

    async connect(): Promise<void> {
      mockRedisState.events.push('connect');

      if (mockRedisState.connectError) {
        throw mockRedisState.connectError;
      }

      this.status = 'ready';
    }

    disconnect(): void {
      mockRedisState.events.push('disconnect');
      if (!mockRedisState.disconnectLeavesOpen) {
        this.status = 'end';
      }
    }

    async quit(): Promise<'OK'> {
      mockRedisState.events.push('quit');

      if (mockRedisState.quitError) {
        throw mockRedisState.quitError;
      }

      this.status = 'end';
      return 'OK';
    }

    async get(key: string): Promise<string | null> {
      return this.storage.get(key) ?? null;
    }

    async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
      mockRedisState.setCalls.push({ args, key, value });
      this.storage.set(key, value);
      return 'OK';
    }

    async del(key: string): Promise<number> {
      const existed = this.storage.delete(key);
      return existed ? 1 : 0;
    }
  },
}));

import {
  createRedisPlatformStatusSnapshot,
  getRedisClientToken,
  getRedisComponentId,
  getRedisServiceToken,
  REDIS_CLIENT,
  RedisModule,
  RedisService,
} from './index.js';

describe('@fluojs/redis', () => {
  beforeEach(() => {
    mockRedisState.connectError = undefined;
    mockRedisState.disconnectLeavesOpen = false;
    mockRedisState.events.length = 0;
    mockRedisState.instances.length = 0;
    mockRedisState.quitError = undefined;
    mockRedisState.setCalls.length = 0;
  });

  it('fails bootstrap when connect throws and disconnects wait-state client', async () => {
    mockRedisState.connectError = new Error('connect failed');

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 })],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow('connect failed');

    expect(mockRedisState.events).toEqual(['connect', 'disconnect']);
  });

  it('registers a global Redis client, connects on bootstrap, and quits on shutdown', async () => {
    @Inject(REDIS_CLIENT)
    class CacheService {
      constructor(readonly redis: MockRedisInstance) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheService],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const cache = await app.container.resolve(CacheService);

    expect(mockRedisState.instances).toHaveLength(1);
    expect(cache.redis).toBe(mockRedisState.instances[0]);
    expect(mockRedisState.instances[0]?.options).toMatchObject({
      host: '127.0.0.1',
      lazyConnect: true,
      port: 6379,
    });
    expect(mockRedisState.events).toEqual(['connect']);

    await app.close();

    expect(mockRedisState.events).toEqual(['connect', 'quit']);
  });

  it('forces lazyConnect for default and named clients so bootstrap owns connection timing', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ host: '127.0.0.1', lazyConnect: false, port: 6379 } as never),
        RedisModule.forRoot({ name: 'cache', host: '127.0.0.1', lazyConnect: false, port: 6380 } as never),
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    expect(mockRedisState.instances).toHaveLength(2);
    expect(mockRedisState.instances[0]?.options.lazyConnect).toBe(true);
    expect(mockRedisState.instances[1]?.options.lazyConnect).toBe(true);
    expect(mockRedisState.events).toEqual(['connect', 'connect']);

    await app.close();

    expect(mockRedisState.events).toEqual(['connect', 'connect', 'quit', 'quit']);
  });

  it('uses global visibility only for unnamed default registrations', () => {
    const defaultModule = RedisModule.forRoot({ host: '127.0.0.1', port: 6379 });
    const localDefaultModule = RedisModule.forRoot({ global: false, host: '127.0.0.1', port: 6379 });
    const namedModule = RedisModule.forRoot({ name: 'cache', host: '127.0.0.1', port: 6380 });

    expect(getModuleMetadata(defaultModule)?.global).toBe(true);
    expect(getModuleMetadata(localDefaultModule)?.global).toBe(false);
    expect(getModuleMetadata(namedModule)?.global).toBe(false);
  });

  it('rejects global visibility on named registrations', () => {
    expect(() => RedisModule.forRoot({ name: 'cache', global: true, host: '127.0.0.1', port: 6380 } as never)).toThrow(
      'Named Redis registrations are scoped and cannot be registered globally.',
    );
  });

  it('does not forward module-only name and global fields to ioredis', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ name: 'cache', host: '127.0.0.1', port: 6380 })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    expect(mockRedisState.instances[0]?.options).toMatchObject({
      host: '127.0.0.1',
      lazyConnect: true,
      port: 6380,
    });
    expect(mockRedisState.instances[0]?.options).not.toHaveProperty('name');
    expect(mockRedisState.instances[0]?.options).not.toHaveProperty('global');

    await app.close();
  });

  it('registers named Redis clients without changing the default aliases', async () => {
    const NAMED_REDIS_CLIENT = getRedisClientToken('cache');
    const NAMED_REDIS_SERVICE = getRedisServiceToken('cache');

    @Inject(REDIS_CLIENT)
    class DefaultClientConsumer {
      constructor(readonly redis: MockRedisInstance) {}
    }

    @Inject(NAMED_REDIS_CLIENT)
    class NamedClientConsumer {
      constructor(readonly redis: MockRedisInstance) {}
    }

    @Inject(RedisService, NAMED_REDIS_SERVICE)
    class RedisFacadeConsumer {
      constructor(
        readonly defaultRedis: RedisService,
        readonly namedRedis: RedisService,
      ) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      imports: [RedisModule.forRoot({ name: 'cache', db: 1, host: '127.0.0.1', port: 6379 })],
      providers: [DefaultClientConsumer, NamedClientConsumer, RedisFacadeConsumer],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', port: 6379 }),
        FeatureModule,
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const defaultConsumer = await app.container.resolve(DefaultClientConsumer);
    const namedConsumer = await app.container.resolve(NamedClientConsumer);
    const facadeConsumer = await app.container.resolve(RedisFacadeConsumer);

    expect(mockRedisState.instances).toHaveLength(2);
    expect(defaultConsumer.redis).toBe(mockRedisState.instances[0]);
    expect(namedConsumer.redis).toBe(mockRedisState.instances[1]);
    expect(facadeConsumer.defaultRedis.getRawClient()).toBe(defaultConsumer.redis);
    expect(facadeConsumer.namedRedis.getRawClient()).toBe(namedConsumer.redis);
    expect(await app.container.resolve(NAMED_REDIS_SERVICE)).toBe(facadeConsumer.namedRedis);
    expect(mockRedisState.events).toEqual(['connect', 'connect']);

    await app.close();

    expect(mockRedisState.events).toEqual(['connect', 'connect', 'quit', 'quit']);
  });

  it('keeps redis tokens package-local while preserving stable named lookups', () => {
    const cacheClientToken = getRedisClientToken('cache');
    const cacheClientTokenAgain = getRedisClientToken('cache');
    const jobsClientToken = getRedisClientToken('jobs');
    const cacheServiceToken = getRedisServiceToken('cache');
    const cacheServiceTokenAgain = getRedisServiceToken('cache');

    expect(cacheClientToken).toBe(cacheClientTokenAgain);
    expect(cacheServiceToken).toBe(cacheServiceTokenAgain);
    expect(cacheClientToken).not.toBe(jobsClientToken);
    expect(Symbol.keyFor(REDIS_CLIENT)).toBeUndefined();
    expect(Symbol.keyFor(cacheClientToken)).toBeUndefined();
    expect(Symbol.keyFor(cacheServiceToken as symbol)).toBeUndefined();
  });

  it.each([
    ['client token helper', () => getRedisClientToken('   ')],
    ['service token helper', () => getRedisServiceToken('\t')],
    ['component id helper', () => getRedisComponentId('\n')],
  ])('rejects blank Redis names through the %s', (_caseName, createToken) => {
    expect(createToken).toThrow('Redis client name must be a non-empty string.');
  });

  it('normalizes named Redis helper lookups by trimming names', () => {
    expect(getRedisClientToken(' cache ')).toBe(getRedisClientToken('cache'));
    expect(getRedisServiceToken(' cache ')).toBe(getRedisServiceToken('cache'));
    expect(getRedisComponentId(' cache ')).toBe('redis.cache');
  });

  it('falls back to disconnect when quit fails during shutdown', async () => {
    mockRedisState.quitError = new Error('quit failed');

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await expect(app.close()).resolves.toBeUndefined();
    expect(mockRedisState.events).toEqual(['connect', 'quit', 'disconnect']);
  });

  it('falls back to disconnect for each named client when quit fails after bootstrap', async () => {
    mockRedisState.quitError = new Error('quit failed');

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', port: 6379 }),
        RedisModule.forRoot({ name: 'cache', db: 1, host: '127.0.0.1', port: 6380 }),
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await expect(app.close()).resolves.toBeUndefined();
    expect(mockRedisState.events).toEqual(['connect', 'connect', 'quit', 'disconnect', 'quit', 'disconnect']);
  });

  it('rethrows quit failures when disconnect does not close the client', async () => {
    mockRedisState.disconnectLeavesOpen = true;
    mockRedisState.quitError = new Error('quit failed');

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await expect(app.close()).rejects.toThrow('quit failed');
    expect(mockRedisState.events).toEqual(['connect', 'quit', 'disconnect']);
  });

  it.each([
    ['connect', ['connect', 'quit']],
    ['connecting', ['connect', 'quit']],
    ['ready', ['connect', 'quit']],
    ['reconnecting', ['connect', 'quit']],
    ['wait', ['connect', 'disconnect']],
    ['close', ['connect', 'disconnect']],
    ['end', ['connect']],
  ])('routes shutdown for %s Redis status through the documented lifecycle branch', async (status, expectedEvents) => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const instance = mockRedisState.instances[0];

    expect(instance).toBeDefined();
    if (!instance) {
      throw new Error('Expected a Redis instance to be created.');
    }

    instance.status = status;

    await expect(app.close()).resolves.toBeUndefined();
    expect(mockRedisState.events).toEqual(expectedEvents);
  });

  it('skips shutdown work when client is already closed', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const instance = mockRedisState.instances[0];

    expect(instance).toBeDefined();
    if (!instance) {
      throw new Error('Expected a Redis instance to be created.');
    }

    instance.status = 'end';

    await expect(app.close()).resolves.toBeUndefined();
    expect(mockRedisState.events).toEqual(['connect']);
  });

  it('provides a typed RedisService facade with class-first injection', async () => {
    @Inject(RedisService)
    class CacheFacade {
      constructor(readonly redisService: RedisService) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheFacade],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const cacheFacade = await app.container.resolve(CacheFacade);

    expect(cacheFacade.redisService).toBeInstanceOf(RedisService);

    await cacheFacade.redisService.set('user:1', { id: 'user-1', name: 'Ada' }, 60);

    const user = await cacheFacade.redisService.get<{ id: string; name: string }>('user:1');
    expect(user).toEqual({ id: 'user-1', name: 'Ada' });

    await cacheFacade.redisService.del('user:1');
    await expect(cacheFacade.redisService.get('user:1')).resolves.toBeNull();

    await app.close();
  });

  it.each([
    ['positive TTL', 60, ['EX', 60]],
    ['fractional positive TTL', 0.5, ['EX', 0.5]],
    ['zero TTL', 0, []],
    ['negative TTL', -1, []],
    ['omitted TTL', undefined, []],
  ])('serializes values and forwards %s using the documented RedisService.set args', async (_caseName, ttlSeconds, expectedArgs) => {
    @Inject(RedisService)
    class CacheFacade {
      constructor(readonly redisService: RedisService) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheFacade],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const cacheFacade = await app.container.resolve(CacheFacade);

    await cacheFacade.redisService.set('ttl:key', { ttl: ttlSeconds ?? null }, ttlSeconds);

    expect(mockRedisState.setCalls).toEqual([
      {
        args: expectedArgs,
        key: 'ttl:key',
        value: JSON.stringify({ ttl: ttlSeconds ?? null }),
      },
    ]);

    await app.close();
  });

  it('returns raw string when stored value is not JSON', async () => {
    @Inject(RedisService)
    class CacheFacade {
      constructor(readonly redisService: RedisService) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheFacade],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const cacheFacade = await app.container.resolve(CacheFacade);
    const rawClient = cacheFacade.redisService.getRawClient();

    await rawClient.set('raw:key', 'plain-string');

    await expect(cacheFacade.redisService.get<string>('raw:key')).resolves.toBe('plain-string');

    await app.close();
  });

  it('keeps RedisService as the facade injection identity', async () => {
    @Inject(RedisService)
    class CacheFacade {
      constructor(readonly redisService: RedisService) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheFacade],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const cacheFacade = await app.container.resolve(CacheFacade);
    const resolvedByClass = await app.container.resolve(RedisService);

    expect(cacheFacade.redisService).toBeInstanceOf(RedisService);
    expect(cacheFacade.redisService).toBe(resolvedByClass);
    const rawClient = cacheFacade.redisService.getRawClient();

    await rawClient.set('malformed:key', '{"id": "u1"');

    await expect(cacheFacade.redisService.get('malformed:key')).resolves.toBe('{"id": "u1"');

    await app.close();
  });

  it.each([
    ['ready', { critical: true, status: 'ready' }, { status: 'healthy' }],
    ['wait', { critical: true, reason: 'Redis client is still in lazyConnect wait state.', status: 'not-ready' }, { reason: 'Redis client is wait.', status: 'degraded' }],
    ['connect', { critical: true, reason: 'Redis client is connect.', status: 'degraded' }, { reason: 'Redis client is connect.', status: 'degraded' }],
    ['connecting', { critical: true, reason: 'Redis client is connecting.', status: 'degraded' }, { reason: 'Redis client is connecting.', status: 'degraded' }],
    ['reconnecting', { critical: true, reason: 'Redis client is reconnecting.', status: 'degraded' }, { reason: 'Redis client is reconnecting.', status: 'degraded' }],
    ['close', { critical: true, reason: 'Redis client is close.', status: 'not-ready' }, { reason: 'Redis client is close.', status: 'unhealthy' }],
    ['end', { critical: true, reason: 'Redis client is end.', status: 'not-ready' }, { reason: 'Redis client is end.', status: 'unhealthy' }],
  ] as const)('reports ownership/readiness/health semantics for %s platform snapshots', (status, readiness, health) => {
    const snapshot = createRedisPlatformStatusSnapshot({ status });

    expect(snapshot.ownership).toEqual({ externallyManaged: false, ownsResources: true });
    expect(snapshot.readiness).toEqual(readiness);
    expect(snapshot.health).toEqual(health);
    expect(snapshot.details).toMatchObject({
      componentId: undefined,
      connectionState: status,
      lazyConnect: true,
    });
  });

  it('reports stable default and named component ids with Redis-owned resources', () => {
    const defaultSnapshot = createRedisPlatformStatusSnapshot({
      componentId: 'redis.default',
      status: 'ready',
    });
    const namedSnapshot = createRedisPlatformStatusSnapshot({
      componentId: 'redis.cache',
      status: 'wait',
    });

    expect(defaultSnapshot.details).toMatchObject({
      componentId: 'redis.default',
      connectionState: 'ready',
      lazyConnect: true,
    });
    expect(defaultSnapshot.ownership).toEqual({ externallyManaged: false, ownsResources: true });
    expect(namedSnapshot.details).toMatchObject({
      componentId: 'redis.cache',
      connectionState: 'wait',
      lazyConnect: true,
    });
    expect(namedSnapshot.ownership).toEqual({ externallyManaged: false, ownsResources: true });
  });

});
