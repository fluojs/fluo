import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  CacheAsyncModuleOptions,
  CacheEvictDecoratorValue,
  CacheEvictFactory,
  CacheKeyDecoratorValue,
  CacheKeyFactory,
  CacheKeyStrategy,
  CacheManagerPlatformStatusSnapshot,
  CacheManagerStatusAdapterInput,
  CacheManagerStoreKind,
  CacheManagerStoreOwnershipMode,
  CacheModuleOptions,
  CacheObservation,
  CacheObserver,
  CacheStore,
  CacheTtlJitterMode,
  CacheTtlJitterOptions,
  NormalizedCacheModuleOptions,
  NormalizedCacheTtlJitterOptions,
  PrincipalScopeResolver,
  RedisCacheOptions,
  RedisCompatibleClient,
  RedisStoreOptions,
} from './index.js';
import * as cacheManagerPublicApi from './index.js';
import { CacheModule } from './index.js';

type ReadCacheObservation = Extract<
  CacheObservation,
  { readonly operation: 'get' | 'remember' }
>;
type WriteCacheObservation = Extract<
  CacheObservation,
  { readonly operation: 'set' | 'del' | 'reset' | 'close' }
>;

type RootCacheKeyStrategy =
  | 'route'
  | 'route+query'
  | 'full'
  | ((context: Parameters<CacheKeyFactory>[0]) => string);

class CacheSettingsService {
  readonly ttlSeconds = 60;
}

describe('@fluojs/cache-manager public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(cacheManagerPublicApi).toHaveProperty('CacheModule');
    expect(cacheManagerPublicApi).not.toHaveProperty('createCacheProviders');
    expect(cacheManagerPublicApi).toHaveProperty('CacheService');
    expect(cacheManagerPublicApi).toHaveProperty('CacheInterceptor');
    expect(cacheManagerPublicApi).toHaveProperty('CacheKey');
    expect(cacheManagerPublicApi).toHaveProperty('CacheTTL');
    expect(cacheManagerPublicApi).toHaveProperty('CacheEvict');
    expect(cacheManagerPublicApi).toHaveProperty('MemoryStore');
    expect(cacheManagerPublicApi).toHaveProperty('RedisStore');
    expect(cacheManagerPublicApi).toHaveProperty('createCacheManagerPlatformStatusSnapshot');
    expect(cacheManagerPublicApi).toHaveProperty('createCacheManagerPlatformDiagnosticIssues');
    expect(cacheManagerPublicApi).toHaveProperty('CACHE_OPTIONS');
    expect(cacheManagerPublicApi).toHaveProperty('CACHE_STORE');
  });

  it('does not expose removed compatibility aliases', () => {
    expect(cacheManagerPublicApi).not.toHaveProperty('createCacheModule');
    expect(cacheManagerPublicApi).not.toHaveProperty('CACHE_MANAGER');
    expect(cacheManagerPublicApi).not.toHaveProperty('CACHE_INTERCEPTOR');
  });

  it('keeps documented root-barrel type exports available', () => {
    expectTypeOf<CacheStore>().toHaveProperty('get');
    expectTypeOf<CacheStore>().toHaveProperty('set');
    expectTypeOf<CacheModuleOptions>().toHaveProperty('store');
    expectTypeOf<CacheModuleOptions>().toHaveProperty('httpKeyStrategy');
    expectTypeOf<CacheModuleOptions>().toHaveProperty('ttlJitter');
    expectTypeOf<CacheTtlJitterOptions>().toHaveProperty('ratio');
    expectTypeOf<CacheTtlJitterMode>().toEqualTypeOf<'symmetric' | 'shorten' | 'lengthen'>();
    expectTypeOf<NormalizedCacheTtlJitterOptions>().toHaveProperty('mode');
    expectTypeOf<CacheAsyncModuleOptions>().toHaveProperty('useFactory');
    expectTypeOf<CacheAsyncModuleOptions>().toHaveProperty('inject');
    expectTypeOf<CacheAsyncModuleOptions>().toHaveProperty('global');
    expectTypeOf<NormalizedCacheModuleOptions>().toHaveProperty('keyPrefix');
    expectTypeOf<NormalizedCacheModuleOptions>().toHaveProperty('principalScopeResolver');
    expectTypeOf<CacheModuleOptions>().toHaveProperty('observer');
    expectTypeOf<NormalizedCacheModuleOptions>().toHaveProperty('observer');
    expectTypeOf<CacheObserver>().toHaveProperty('onCacheOperation');
    expectTypeOf<CacheObservation>().toHaveProperty('operation');
    expectTypeOf<CacheObservation>().toHaveProperty('outcome');
    expectTypeOf<CacheObservation>().toHaveProperty('durationMs');
    expectTypeOf<ReadCacheObservation['outcome']>().toEqualTypeOf<'hit' | 'miss' | 'error'>();
    expectTypeOf<WriteCacheObservation['outcome']>().toEqualTypeOf<'success' | 'error'>();
    expectTypeOf<RedisCacheOptions>().toHaveProperty('clientName');
    expectTypeOf<RedisCompatibleClient>().toHaveProperty('scan');
    expectTypeOf<RedisStoreOptions>().toHaveProperty('keyPrefix');
    expectTypeOf<CacheKeyFactory>().toBeFunction();
    expectTypeOf<CacheEvictFactory>().toBeFunction();
    expectTypeOf<PrincipalScopeResolver>().toBeFunction();
    expectTypeOf<CacheKeyDecoratorValue>().toEqualTypeOf<string | CacheKeyFactory>();
    expectTypeOf<CacheEvictDecoratorValue>().toEqualTypeOf<
      string | readonly string[] | CacheEvictFactory
    >();
    expectTypeOf<CacheKeyStrategy>().toEqualTypeOf<RootCacheKeyStrategy>();
    expectTypeOf<CacheManagerPlatformStatusSnapshot>().toHaveProperty('readiness');
    expectTypeOf<CacheManagerStatusAdapterInput>().toHaveProperty('storeKind');
    expectTypeOf<CacheManagerStoreKind>().toEqualTypeOf<'memory' | 'redis' | 'custom'>();
    expectTypeOf<CacheManagerStoreOwnershipMode>().toEqualTypeOf<'framework' | 'external'>();
  });

  it('accepts a typed injected async factory from the public root', () => {
    const module = CacheModule.forRootAsync({
      inject: [CacheSettingsService],
      useFactory: (settings: CacheSettingsService) => ({
        store: 'memory',
        ttl: settings.ttlSeconds,
      }),
    });

    expect(module).toBeDefined();
  });

  it('accepts a prepared CacheModuleOptions value from the public root', () => {
    const preparedOptions: CacheModuleOptions = {
      store: 'memory',
      ttl: 60,
    };
    const module = CacheModule.forRootAsync({
      useFactory: () => preparedOptions,
    });

    expect(module).toBeDefined();
  });

  it('keeps the normalized options compatibility type on the explicit root barrel', () => {
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(indexSource).not.toContain("export * from './types.js'");
    expect(indexSource).toContain('NormalizedCacheModuleOptions');
  });
});
