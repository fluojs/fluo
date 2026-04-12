import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';

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

    async set(key: string, value: string, ..._args: unknown[]): Promise<'OK'> {
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
  getRedisClientToken,
  getRedisServiceToken,
  RedisModule,
  createRedisPlatformStatusSnapshot,
  REDIS_CLIENT,
  RedisService,
} from './index.js';

describe('@fluojs/redis', () => {
  beforeEach(() => {
    mockRedisState.connectError = undefined;
    mockRedisState.disconnectLeavesOpen = false;
    mockRedisState.events.length = 0;
    mockRedisState.instances.length = 0;
    mockRedisState.quitError = undefined;
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
      providers: [DefaultClientConsumer, NamedClientConsumer, RedisFacadeConsumer],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', port: 6379 }),
        RedisModule.forRootNamed('cache', { db: 1, host: '127.0.0.1', port: 6379 }),
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

  it('disconnects directly on shutdown when client is still waiting', async () => {
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

    instance.status = 'wait';

    await expect(app.close()).resolves.toBeUndefined();
    expect(mockRedisState.events).toEqual(['connect', 'disconnect']);
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

  it('reports ownership/readiness/health semantics in platform snapshot shape', () => {
    const snapshot = createRedisPlatformStatusSnapshot({
      status: 'ready',
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: false, ownsResources: true });
    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      componentId: undefined,
      connectionState: 'ready',
      lazyConnect: true,
    });
  });

  it('separates wait-state readiness from health', () => {
    const snapshot = createRedisPlatformStatusSnapshot({
      status: 'wait',
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
  });

  it('marks closed redis client as unhealthy and not-ready', () => {
    const snapshot = createRedisPlatformStatusSnapshot({
      status: 'end',
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
  });
});
