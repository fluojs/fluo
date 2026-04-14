import { afterEach, describe, expect, it, vi } from 'vitest';

import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import { MemoryStore } from './stores/memory-store.js';
import type { NormalizedCacheModuleOptions } from './types.js';

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

describe('optional Redis peer contract', () => {
  it('keeps the root barrel importable for memory-only consumers when Redis peers are absent', async () => {
    vi.doMock('@fluojs/redis', () => {
      throw Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });

    const cacheManagerPublicApi = await import('./index.js');

    expect(cacheManagerPublicApi).toHaveProperty('CacheModule');
    expect(cacheManagerPublicApi).toHaveProperty('createCacheProviders');
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

    const { createCacheProviders } = await import('./module.js');
    const providers = createCacheProviders({ store: 'redis' });
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

  it('does not touch the optional Redis peer when creating a memory store provider', async () => {
    vi.doMock('@fluojs/redis', () => {
      throw Object.assign(new Error("Cannot find package '@fluojs/redis'"), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    });

    const { createCacheProviders } = await import('./module.js');
    const providers = createCacheProviders({ store: 'memory' });
    const optionsProvider = providers.find(isNormalizedOptionsProvider);
    const storeProvider = providers.find(isStoreFactoryProvider);

    expect(optionsProvider).toBeDefined();
    expect(storeProvider).toBeDefined();

    await expect(storeProvider!.useFactory(optionsProvider!.useValue, createContainerStub())).resolves.toMatchObject({
      constructor: expect.objectContaining({ name: MemoryStore.name }),
    });
  });
});
