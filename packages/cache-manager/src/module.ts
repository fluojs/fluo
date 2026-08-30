import type { Token } from '@fluojs/core';
import type { Container, Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CacheInterceptor } from './interceptor.js';
import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import { RedisStore } from './stores/redis-store.js';
import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type {
  CacheAsyncModuleOptions,
  CacheModuleOptions,
  NormalizedCacheModuleOptions,
  RedisCompatibleClient,
} from './types.js';

const DEFAULT_MEMORY_STORE_TTL_SECONDS = 300;
const REDIS_PEER_MODULE_SPECIFIER = '@fluojs/redis';

interface RedisPeerModule {
  getRedisClientToken(clientName?: string): Token<RedisCompatibleClient>;
}

type OptionalModuleLoader = (specifier: string) => Promise<unknown>;

const loadOptionalModule: OptionalModuleLoader = async (specifier) => import(specifier);

function isMissingRedisPeer(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;

  return code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(REDIS_PEER_MODULE_SPECIFIER);
}

function isRedisPeerModule(value: unknown): value is RedisPeerModule {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'getRedisClientToken' in value && typeof value.getRedisClientToken === 'function';
}

function createRedisBootstrapError(): Error {
  return new Error(
    [
      '@fluojs/cache-manager redis store requires a Redis client at bootstrap.',
      'Install and import @fluojs/redis, configure options.redis.clientName, or provide options.redis.client directly.',
    ].join(' '),
  );
}

async function resolveRedisPeerModule(): Promise<RedisPeerModule> {
  try {
    const moduleNamespace = await loadOptionalModule(REDIS_PEER_MODULE_SPECIFIER);

    if (!isRedisPeerModule(moduleNamespace)) {
      throw new Error('@fluojs/cache-manager expected @fluojs/redis to export getRedisClientToken().');
    }

    return moduleNamespace;
  } catch (error) {
    if (isMissingRedisPeer(error)) {
      throw createRedisBootstrapError();
    }

    throw error;
  }
}

function normalizeCacheModuleOptions(options: CacheModuleOptions = {}): NormalizedCacheModuleOptions {
  const store = options.store ?? 'memory';

  return {
    global: options.global ?? false,
    keyPrefix: options.keyPrefix ?? 'fluo:cache:',
    redis: options.redis,
    store,
    ttl: options.ttl ?? (store === 'memory' ? DEFAULT_MEMORY_STORE_TTL_SECONDS : 0),
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
    typeof candidate.global === 'boolean' &&
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
    let redisToken: Token<RedisCompatibleClient>;

    try {
      const { getRedisClientToken } = await resolveRedisPeerModule();
      redisToken = getRedisClientToken(options.redis?.clientName);
    } catch (error) {
      if (isMissingRedisPeer(error)) {
        throw createRedisBootstrapError();
      }

      throw error;
    }

    if (container.has(redisToken)) {
      resolvedClient = await container.resolve<RedisCompatibleClient>(redisToken);
    }
  }

  if (!resolvedClient) {
    throw createRedisBootstrapError();
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

function createCacheRuntimeProviders(optionsProvider: Provider): Provider[] {
  return [
    optionsProvider,
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
   * @remarks
   * This is the primary package entrypoint, including custom
   * `defineModule(...)` composition. Root-package consumers should treat
   * low-level provider wiring as an internal implementation detail.
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
      global: normalized.global,
      providers: createCacheRuntimeProviders({
        provide: CACHE_OPTIONS,
        useValue: normalized,
      }),
    });
  }

  /**
   * Register cache providers from an injected async factory.
   *
   * @remarks
   * The factory runs once per module registration through the application container,
   * and its resolved options are normalized with the same defaults as
   * {@link CacheModule.forRoot}. Module visibility comes from the `global` option on this
   * call because module metadata is fixed before the factory runs; a `global` value in the
   * factory result is ignored. A rejected factory fails bootstrap.
   *
   * @param options Injected factory registration options.
   * @returns A runtime module exporting `CacheService` and `CacheInterceptor`.
   *
   * @example
   * ```ts
   * CacheModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config) => ({
   *     store: 'redis',
   *     ttl: config.cacheTtlSeconds,
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: CacheAsyncModuleOptions): ModuleType {
    class CacheRootAsyncModule extends CacheModule {}

    return defineModule(CacheRootAsyncModule, {
      exports: [CacheService, CacheInterceptor],
      global: options.global ?? false,
      providers: createCacheRuntimeProviders({
        inject: options.inject,
        provide: CACHE_OPTIONS,
        scope: 'singleton',
        useFactory: (...deps: unknown[]) =>
          Promise.resolve(options.useFactory(...deps)).then((resolved) =>
            normalizeCacheModuleOptions({ ...resolved, global: options.global ?? false }),
          ),
      }),
    });
  }
}
