import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRedisInstance {
  options: Record<string, unknown>;
  status: string;
}

const mockRedisState = vi.hoisted(() => ({
  events: [] as string[],
  instances: [] as MockRedisInstance[],
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
      this.status = 'end';
      return 'OK';
    }
  },
}));

import { RedisModule } from './index.js';

describe('@fluojs/redis duplicate registration identities', () => {
  beforeEach(() => {
    mockRedisState.events.length = 0;
    mockRedisState.instances.length = 0;
  });

  it('rejects a duplicate default registration before creating a Redis client', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', port: 6379 }),
        RedisModule.forRoot({ db: 1, host: '127.0.0.1', port: 6380 }),
      ],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "default". Every RedisModule.forRoot(...) registration owns one lifecycle-managed client, so pass a distinct name to each additional registration.',
    );

    expect(mockRedisState.instances).toHaveLength(0);
    expect(mockRedisState.events).toEqual([]);
  });

  it('rejects a duplicate named registration before creating a Redis client', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', name: 'cache', port: 6379 }),
        RedisModule.forRoot({ db: 1, host: '127.0.0.1', name: 'cache', port: 6380 }),
      ],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "cache". Every RedisModule.forRoot(...) registration owns one lifecycle-managed client, so pass a distinct name to each additional registration.',
    );

    expect(mockRedisState.instances).toHaveLength(0);
    expect(mockRedisState.events).toEqual([]);
  });

  it('treats a trimmed named registration as the same ownership identity', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ host: '127.0.0.1', name: 'cache', port: 6379 }),
        RedisModule.forRoot({ host: '127.0.0.1', name: '  cache  ', port: 6380 }),
      ],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "cache".',
    );
  });

  it('preserves every unique default and named registration', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', port: 6379 }),
        RedisModule.forRoot({ db: 1, host: '127.0.0.1', name: 'cache', port: 6380 }),
        RedisModule.forRoot({ db: 2, host: '127.0.0.1', name: 'jobs', port: 6381 }),
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    expect(mockRedisState.instances).toHaveLength(3);
    expect(mockRedisState.events).toEqual(['connect', 'connect', 'connect']);

    await app.close();

    expect(mockRedisState.events).toEqual(['connect', 'connect', 'connect', 'quit', 'quit', 'quit']);
  });
});
