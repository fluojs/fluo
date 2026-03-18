import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

interface MockRedisInstance {
  options: Record<string, unknown>;
  status: string;
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
  },
}));

import { createRedisModule, REDIS_CLIENT } from './index.js';

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
});
