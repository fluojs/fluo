import type { Provider, Container } from '@konekti/di';
import { RUNTIME_CONTAINER, defineModule, type ModuleType } from '@konekti/runtime';

import { CacheInterceptor } from './interceptor.js';
import { MemoryStore } from './memory-store.js';
import { RedisStore } from './redis-store.js';
import { CacheService } from './service.js';
import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { CacheModuleOptions, NormalizedCacheModuleOptions, RedisCompatibleClient } from './types.js';

const REDIS_CLIENT_TOKEN = Symbol.for('konekti.redis.client');

function normalizeCacheModuleOptions(options: CacheModuleOptions = {}): NormalizedCacheModuleOptions {
  return {
    isGlobal: options.isGlobal ?? false,
    keyPrefix: options.keyPrefix ?? 'konekti:cache:',
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

  if (!resolvedClient && container.has(REDIS_CLIENT_TOKEN)) {
    resolvedClient = await container.resolve<RedisCompatibleClient>(REDIS_CLIENT_TOKEN);
  }

  if (!resolvedClient) {
    throw new Error(
      [
        '@konekti/cache-manager redis store requires a Redis client at bootstrap.',
        'Install and import @konekti/redis (createRedisModule) or provide options.redis.client directly.',
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

export function createCacheModule(options: CacheModuleOptions = {}): ModuleType {
  class CacheModule {}
  const normalized = normalizeCacheModuleOptions(options);

  return defineModule(CacheModule, {
    exports: [CacheService, CacheInterceptor],
    global: normalized.isGlobal,
    providers: createCacheProviders(options),
  });
}
