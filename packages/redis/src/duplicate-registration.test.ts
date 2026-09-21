import { defineModule, FluoFactory } from '@fluojs/runtime';
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

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "default". Every RedisModule.forRoot(...) registration owns one lifecycle-managed client, so pass a distinct name to each additional registration.',
    );

    expect(mockRedisState.instances).toHaveLength(0);
    expect(mockRedisState.events).toEqual([]);
  });

  it('rejects mixed-copy duplicate default registrations before creating a Redis client', async () => {
    const moduleUrl = new URL('./module.ts', import.meta.url);
    const firstCopy = await import(`${moduleUrl.href}?module-copy=first`);
    const secondCopy = await import(`${moduleUrl.href}?module-copy=second`);
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        firstCopy.RedisModule.forRoot({ host: '127.0.0.1', port: 6379 }),
        secondCopy.RedisModule.forRoot({ host: '127.0.0.1', port: 6380 }),
      ],
    });

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "default".',
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

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
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

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "cache".',
    );
  });

  it('allows one registration module to be re-imported through multiple feature modules', async () => {
    const registration = RedisModule.forRoot({ host: '127.0.0.1', port: 6379 });
    class FirstFeatureModule {}
    defineModule(FirstFeatureModule, { imports: [registration] });
    class SecondFeatureModule {}
    defineModule(SecondFeatureModule, { imports: [registration] });
    class AppModule {}
    defineModule(AppModule, { imports: [FirstFeatureModule, SecondFeatureModule] });

    const app = await FluoFactory.create(AppModule);

    expect(mockRedisState.instances).toHaveLength(1);
    await app.close();
  });

  it('keeps ownership isolated between applications', async () => {
    class FirstAppModule {}
    defineModule(FirstAppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6379 })],
    });
    class SecondAppModule {}
    defineModule(SecondAppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', port: 6380 })],
    });

    const firstApp = await FluoFactory.create(FirstAppModule);
    const secondApp = await FluoFactory.create(SecondAppModule);

    expect(mockRedisState.instances).toHaveLength(2);

    await firstApp.close();
    await secondApp.close();
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

    const app = await FluoFactory.create(AppModule);

    expect(mockRedisState.instances).toHaveLength(3);
    expect(mockRedisState.events).toEqual(['connect', 'connect', 'connect']);

    await app.close();

    expect(mockRedisState.events).toEqual(['connect', 'connect', 'connect', 'quit', 'quit', 'quit']);
  });
});
