import type { Provider, Container } from '@fluojs/di';
import { getRedisClientToken } from '@fluojs/redis';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CacheInterceptor } from './interceptor.js';
import { MemoryStore } from './stores/memory-store.js';
import { RedisStore } from './stores/redis-store.js';
import { CacheService } from './service.js';
import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { CacheModuleOptions, NormalizedCacheModuleOptions, RedisCompatibleClient } from './types.js';

function normalizeCacheModuleOptions(options: CacheModuleOptions = {}): NormalizedCacheModuleOptions {
  return {
    isGlobal: options.isGlobal ?? false,
    keyPrefix: options.keyPrefix ?? 'fluo:cache:',
    redis: options.redis,
    store: options.store ?? 'memory',
    ttl: options.ttl ?? 0,
    httpKeyStrategy: options.httpKeyStrategy ?? 'route',
    principalScopeResolver: options.principalScopeResolver,
  };
}

function isNormalizedCacheModuleOptions(value: unknown): value is NormalizedCacheModuleOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NormalizedCacheModuleOptions>;

  return (
    'store' in candidate &&
    (typeof candidate.store === 'string' || typeof candidate.store === 'object') &&
    typeof candidate.keyPrefix === 'string' &&
    typeof candidate.ttl === 'number' &&
    typeof candidate.isGlobal === 'boolean' &&
    'httpKeyStrategy' in candidate
  );
}

function isContainer(value: unknown): value is Container {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'has' in value && 'resolve' in value;
}

async function resolveRedisClient(
  options: NormalizedCacheModuleOptions,
  container: Container,
): Promise<RedisCompatibleClient> {
  let resolvedClient = options.redis?.client;

  if (!resolvedClient) {
    const redisToken = getRedisClientToken(options.redis?.clientName);

    if (container.has(redisToken)) {
      resolvedClient = await container.resolve<RedisCompatibleClient>(redisToken);
    }
  }

  if (!resolvedClient) {
    throw new Error(
      [
        '@fluojs/cache-manager redis store requires a Redis client at bootstrap.',
        'Install and import @fluojs/redis, configure options.redis.clientName, or provide options.redis.client directly.',
      ].join(' '),
    );
  }

  return resolvedClient;
}

async function createStore(options: NormalizedCacheModuleOptions, container: Container) {
  if (typeof options.store === 'object' && options.store !== null) {
    return options.store;
  }

  if (options.store === 'redis') {
    return new RedisStore(await resolveRedisClient(options, container), {
      keyPrefix: options.keyPrefix,
      scanCount: options.redis?.scanCount,
    });
  }

  return new MemoryStore();
}

/**
 * Create the cache-manager provider set for manual module composition.
 *
 * @param options Cache module options with optional store and HTTP caching configuration.
 * @returns Providers for normalized options, cache store resolution, `CacheService`, and `CacheInterceptor`.
 *
 * @example
 * ```ts
 * const providers = createCacheProviders({
 *   store: 'memory',
 *   ttl: 60,
 * });
 * ```
 */
export function createCacheProviders(options: CacheModuleOptions = {}): Provider[] {
  const normalized = normalizeCacheModuleOptions(options);

  return [
    {
      provide: CACHE_OPTIONS,
      useValue: normalized,
    },
    {
      inject: [CACHE_OPTIONS, RUNTIME_CONTAINER],
      provide: CACHE_STORE,
      useFactory: (...deps: unknown[]) => {
        const moduleOptions = deps[0];
        const container = deps[1];

        if (!isNormalizedCacheModuleOptions(moduleOptions)) {
          throw new Error('Cache module options provider resolved an invalid configuration object.');
        }

        if (!isContainer(container)) {
          throw new Error('Cache module requires runtime container access to resolve optional Redis client.');
        }

        return createStore(moduleOptions, container);
      },
    },
    {
      provide: CacheService,
      useClass: CacheService,
    },
    {
      provide: CacheInterceptor,
      useClass: CacheInterceptor,
    },
  ];
}

/**
 * Runtime module entrypoint for cache-manager services and interceptor wiring.
 *
 * @remarks
 * This module only wires providers and store resolution. The documented cache
 * semantics remain defined by the decorators, interceptor, and `CacheService`.
 */
export class CacheModule {
  /**
   * Register cache providers for the current application module graph.
   *
   * @param options Cache module options.
   * @returns A runtime module exporting `CacheService` and `CacheInterceptor`.
   *
   * @example
   * ```ts
   * CacheModule.forRoot({
   *   store: 'redis',
   *   ttl: 300,
   * });
   * ```
   */
  static forRoot(options: CacheModuleOptions = {}): ModuleType {
    const normalized = normalizeCacheModuleOptions(options);
    class CacheRootModule extends CacheModule {}

    return defineModule(CacheRootModule, {
      exports: [CacheService, CacheInterceptor],
      global: normalized.isGlobal,
      providers: createCacheProviders(options),
    });
  }
}
