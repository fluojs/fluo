import { defineModule, FluoFactory } from '@fluojs/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRedisInstance {
  events: string[];
  options: Record<string, unknown>;
  status: string;
}

const mockRedisState = vi.hoisted(() => ({
  events: [] as string[],
  instances: [] as MockRedisInstance[],
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    readonly events: string[] = [];
    readonly options: Record<string, unknown>;
    status = 'wait';

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      mockRedisState.instances.push(this);
    }

    async connect(): Promise<void> {
      this.events.push('connect');
      mockRedisState.events.push('connect');
      this.status = 'ready';
    }

    disconnect(): void {
      this.events.push('disconnect');
      mockRedisState.events.push('disconnect');
      this.status = 'end';
    }

    async quit(): Promise<'OK'> {
      this.events.push('quit');
      mockRedisState.events.push('quit');
      this.status = 'end';
      return 'OK';
    }
  },
}));

import { getRedisClientToken, getRedisServiceToken, REDIS_CLIENT, RedisModule, RedisService } from './index.js';

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

  it.each(['cache', 'default'])('rejects duplicate named "%s" registrations before creating a Redis client', async (name) => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ db: 0, host: '127.0.0.1', name, port: 6379 }),
        RedisModule.forRoot({ db: 1, host: '127.0.0.1', name, port: 6380 }),
      ],
    });

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
      `Duplicate @fluojs/redis registration identity "${name}". Every RedisModule.forRoot(...) registration owns one lifecycle-managed client, so pass a distinct name to each additional registration.`,
    );

    expect(mockRedisState.instances).toHaveLength(0);
    expect(mockRedisState.events).toEqual([]);
  });

  it.each(['cache', 'default'])('rejects trimmed named "%s" duplicates before creating a Redis client', async (name) => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        RedisModule.forRoot({ host: '127.0.0.1', name, port: 6379 }),
        RedisModule.forRoot({ host: '127.0.0.1', name: ` ${name} `, port: 6380 }),
      ],
    });

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
      `Duplicate @fluojs/redis registration identity "${name}".`,
    );

    expect(mockRedisState.instances).toHaveLength(0);
    expect(mockRedisState.events).toEqual([]);
  });

  it.each(['cache', 'default'])('rejects mixed-copy named "%s" duplicates before creating a Redis client', async (name) => {
    const moduleUrl = new URL('./module.ts', import.meta.url);
    const firstCopy = await import(`${moduleUrl.href}?module-copy=first`);
    const secondCopy = await import(`${moduleUrl.href}?module-copy=second`);
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        firstCopy.RedisModule.forRoot({ host: '127.0.0.1', name, port: 6379 }),
        secondCopy.RedisModule.forRoot({ host: '127.0.0.1', name: ` ${name} `, port: 6380 }),
      ],
    });

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
      `Duplicate @fluojs/redis registration identity "${name}".`,
    );

    expect(mockRedisState.instances).toHaveLength(0);
    expect(mockRedisState.events).toEqual([]);
  });

  it.each([
    { name: 'default', mixedCopies: false },
    { name: ' default ', mixedCopies: false },
    { name: 'default', mixedCopies: true },
    { name: ' default ', mixedCopies: true },
  ])('bootstraps independent unnamed and named "$name" clients (mixed copies: $mixedCopies)', async ({ name, mixedCopies }) => {
    const moduleUrl = new URL('./module.ts', import.meta.url);
    const firstModule = mixedCopies ? (await import(`${moduleUrl.href}?module-copy=first`)).RedisModule : RedisModule;
    const secondModule = mixedCopies ? (await import(`${moduleUrl.href}?module-copy=second`)).RedisModule : RedisModule;
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        firstModule.forRoot({ db: 0, host: '127.0.0.1', port: 6379 }),
        secondModule.forRoot({ db: 1, host: '127.0.0.1', name, port: 6380 }),
      ],
    });

    const bootstrap = FluoFactory.createApplicationContext(AppModule);
    await expect(bootstrap).resolves.toBeDefined();
    const app = await bootstrap;
    const unnamedClient = await app.container.resolve<MockRedisInstance>(REDIS_CLIENT);
    const namedClient = await app.container.resolve<MockRedisInstance>(getRedisClientToken('default'));

    try {
      const unnamedFacade = await app.container.resolve(RedisService);
      const namedFacade = await app.container.resolve(getRedisServiceToken('default'));

      expect(mockRedisState.instances).toHaveLength(2);
      expect(unnamedClient).not.toBe(namedClient);
      expect(unnamedClient.options.db).toBe(0);
      expect(namedClient.options.db).toBe(1);
      expect(unnamedFacade).not.toBe(namedFacade);
      expect(unnamedFacade.getRawClient()).toBe(unnamedClient);
      expect(namedFacade.getRawClient()).toBe(namedClient);
      expect(unnamedClient.events).toEqual(['connect']);
      expect(namedClient.events).toEqual(['connect']);
    } finally {
      await app.close();
    }

    expect(unnamedClient.events).toEqual(['connect', 'quit']);
    expect(namedClient.events).toEqual(['connect', 'quit']);
    expect(unnamedClient.status).toBe('end');
    expect(namedClient.status).toBe('end');
  });

  it.each([undefined, 'default'])('reuses one "%s" registration imported through multiple feature modules', async (name) => {
    const registration = RedisModule.forRoot({ host: '127.0.0.1', name, port: 6379 });
    class FirstFeatureModule {}
    defineModule(FirstFeatureModule, { imports: [registration] });
    class SecondFeatureModule {}
    defineModule(SecondFeatureModule, { imports: [registration] });
    class AppModule {}
    defineModule(AppModule, { imports: [FirstFeatureModule, SecondFeatureModule] });

    const app = await FluoFactory.create(AppModule);

    expect(mockRedisState.instances).toHaveLength(1);
    expect(mockRedisState.events).toEqual(['connect']);
    await app.close();
    expect(mockRedisState.events).toEqual(['connect', 'quit']);
  });

  it.each([undefined, 'default'])('keeps "%s" registration ownership isolated between applications', async (name) => {
    class FirstAppModule {}
    defineModule(FirstAppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', name, port: 6379 })],
    });
    class SecondAppModule {}
    defineModule(SecondAppModule, {
      imports: [RedisModule.forRoot({ host: '127.0.0.1', name, port: 6380 })],
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
