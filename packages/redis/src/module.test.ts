import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

interface MockRedisInstance {
  options: Record<string, unknown>;
  status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<'OK'>;
  del(key: string): Promise<number>;
}

const mockRedisState = vi.hoisted(() => ({
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
      this.status = 'ready';
    }

    disconnect(): void {
      mockRedisState.events.push('disconnect');
      this.status = 'end';
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

import { createRedisModule, REDIS_CLIENT, REDIS_SERVICE, RedisService } from './index.js';

describe('@konekti/redis', () => {
  beforeEach(() => {
    mockRedisState.events.length = 0;
    mockRedisState.instances.length = 0;
    mockRedisState.quitError = undefined;
  });

  it('registers a global Redis client, connects on bootstrap, and quits on shutdown', async () => {
    @Inject([REDIS_CLIENT])
    class CacheService {
      constructor(readonly redis: MockRedisInstance) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheService],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [createRedisModule({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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

  it('falls back to disconnect when quit fails during shutdown', async () => {
    mockRedisState.quitError = new Error('quit failed');

    class AppModule {}
    defineModule(AppModule, {
      imports: [createRedisModule({ host: '127.0.0.1', port: 6379 })],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });

    await expect(app.close()).resolves.toBeUndefined();
    expect(mockRedisState.events).toEqual(['connect', 'quit', 'disconnect']);
  });

  it('provides a typed RedisService facade with get/set/del operations', async () => {
    @Inject([REDIS_SERVICE])
    class CacheFacade {
      constructor(readonly redisService: RedisService) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheFacade],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [createRedisModule({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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
    @Inject([REDIS_SERVICE])
    class CacheFacade {
      constructor(readonly redisService: RedisService) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [CacheFacade],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [createRedisModule({ host: '127.0.0.1', port: 6379 }), FeatureModule],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const cacheFacade = await app.container.resolve(CacheFacade);
    const rawClient = cacheFacade.redisService.getRawClient();

    await rawClient.set('raw:key', 'plain-string');

    await expect(cacheFacade.redisService.get<string>('raw:key')).resolves.toBe('plain-string');

    await app.close();
  });
});
