import { getModuleMetadata } from '@fluojs/core/internal';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { NormalizedCacheModuleOptions, RedisCompatibleClient } from './types.js';

class ApplicationOwnedRedisClient implements RedisCompatibleClient {
  readonly close = vi.fn(async () => undefined);
  readonly disconnect = vi.fn(() => undefined);
  readonly quit = vi.fn(async () => undefined);
  private readonly entries = new Map<string, string>();

  async del(key: string, ...keys: string[]): Promise<number> {
    let deleted = 0;

    for (const currentKey of [key, ...keys]) {
      if (this.entries.delete(currentKey)) {
        deleted += 1;
      }
    }

    return deleted;
  }

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async scan(_cursor: string, ..._args: Array<string | number>): Promise<[string, string[]]> {
    return ['0', []];
  }

  async set(key: string, value: string, ..._args: Array<string | number>): Promise<'OK'> {
    this.entries.set(key, value);
    return 'OK';
  }
}

function isNormalizedOptionsProvider(
  provider: unknown,
): provider is { provide: typeof CACHE_OPTIONS; useValue: NormalizedCacheModuleOptions } {
  return typeof provider === 'object' && provider !== null && 'provide' in provider && provider.provide === CACHE_OPTIONS;
}

function isStoreFactoryProvider(
  provider: unknown,
): provider is { provide: typeof CACHE_STORE; useFactory: (...deps: unknown[]) => unknown } {
  return typeof provider === 'object' && provider !== null && 'provide' in provider && provider.provide === CACHE_STORE;
}

function createContainerStub() {
  return {
    has: vi.fn(() => false),
    resolve: vi.fn(),
  };
}

afterEach(() => {
  vi.doUnmock('@fluojs/redis');
  vi.resetModules();
});

function getModuleProviders(options?: Parameters<typeof CacheModule.forRoot>[0]) {
  return getModuleMetadata(CacheModule.forRoot(options))?.providers ?? [];
}

describe('optional Redis peer contract', () => {
  it('uses a direct application-owned client without resolving or closing the optional Redis peer', async () => {
    // Given
    const optionalRedisPeerFactory = vi.fn(() => {
      throw Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });
    vi.doMock('@fluojs/redis', optionalRedisPeerFactory);

    const redisClient = new ApplicationOwnedRedisClient();

    class AppModule {}
    defineModule(AppModule, {
      imports: [CacheModule.forRoot({
        keyPrefix: 'direct:',
        redis: { client: redisClient },
        store: 'redis',
      })],
    });

    // When
    const app = await bootstrapApplication({ rootModule: AppModule });
    const cache = await app.container.resolve(CacheService);
    const cached = await (async () => {
      try {
        await cache.set('users', { count: 3 }, 30);
        return await cache.get('users');
      } finally {
        await app.close();
      }
    })();

    // Then
    expect(cached).toEqual({ count: 3 });
    expect(optionalRedisPeerFactory).not.toHaveBeenCalled();
    expect(redisClient.close).not.toHaveBeenCalled();
    expect(redisClient.disconnect).not.toHaveBeenCalled();
    expect(redisClient.quit).not.toHaveBeenCalled();
  });

  it('keeps the root barrel importable for memory-only consumers when Redis peers are absent', async () => {
    vi.doMock('@fluojs/redis', () => {
      throw Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });

    const cacheManagerPublicApi = await import('./index.js');

    expect(cacheManagerPublicApi).toHaveProperty('CacheModule');
    expect(cacheManagerPublicApi).not.toHaveProperty('createCacheProviders');
    expect(cacheManagerPublicApi).toHaveProperty('MemoryStore');
    expect(cacheManagerPublicApi).toHaveProperty('RedisStore');
  });

  it('fails with installation guidance only when the redis store path is selected', async () => {
    vi.doMock('@fluojs/redis', () => {
      return {
        getRedisClientToken: () => {
          throw Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
            code: 'ERR_MODULE_NOT_FOUND',
          });
        },
      };
    });

    const providers = getModuleProviders({ store: 'redis' });
    const optionsProvider = providers.find(isNormalizedOptionsProvider);
    const storeProvider = providers.find(isStoreFactoryProvider);

    expect(optionsProvider).toBeDefined();
    expect(storeProvider).toBeDefined();

    await expect(storeProvider!.useFactory(optionsProvider!.useValue, createContainerStub())).rejects.toThrow(
      '@fluojs/cache-manager redis store requires a Redis client at bootstrap.',
    );
    await expect(storeProvider!.useFactory(optionsProvider!.useValue, createContainerStub())).rejects.toThrow(
      'Install and import @fluojs/redis',
    );
  });

  it('fails fast when the optional Redis peer is installed without the expected token helper export', async () => {
    vi.doMock('@fluojs/redis', () => {
      return {};
    });

    const providers = getModuleProviders({ store: 'redis' });
    const optionsProvider = providers.find(isNormalizedOptionsProvider);
    const storeProvider = providers.find(isStoreFactoryProvider);

    expect(optionsProvider).toBeDefined();
    expect(storeProvider).toBeDefined();

    await expect(storeProvider!.useFactory(optionsProvider!.useValue, createContainerStub())).rejects.toThrow(
      '@fluojs/cache-manager expected @fluojs/redis to export getRedisClientToken().',
    );
  });

  it('does not touch the optional Redis peer when creating a memory store provider', async () => {
    vi.doMock('@fluojs/redis', () => {
      throw Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });

    const providers = getModuleProviders({ store: 'memory' });
    const optionsProvider = providers.find(isNormalizedOptionsProvider);
    const storeProvider = providers.find(isStoreFactoryProvider);

    expect(optionsProvider).toBeDefined();
    expect(storeProvider).toBeDefined();

    await expect(storeProvider!.useFactory(optionsProvider!.useValue, createContainerStub())).resolves.toMatchObject({
      constructor: expect.objectContaining({ name: MemoryStore.name }),
    });
  });
});
