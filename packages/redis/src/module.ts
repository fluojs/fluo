import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import Redis from 'ioredis';

import { getRedisServiceToken, RedisService } from './redis-service.js';
import { RedisLifecycleService } from './service.js';
import { getRedisClientToken, REDIS_CLIENT } from './tokens.js';
import type { RedisClientOptions, RedisLifecycleOptions, RedisModuleOptions } from './types.js';

const redisLifecycleTokens = new Map<string, symbol>();

function getRedisLifecycleToken(name: string): symbol {
  const existing = redisLifecycleTokens.get(name);

  if (existing) {
    return existing;
  }

  const created = Symbol(`fluo.redis.lifecycle:${name}`);
  redisLifecycleTokens.set(name, created);
  return created;
}

/**
 * Creates the providers that back Fluo's shared Redis integration.
 *
 * @param options Redis constructor options forwarded to `ioredis` with `lazyConnect` forced on.
 * @param name Optional Redis client name for additional named registrations.
 * @returns Providers for the raw client token, the JSON-aware facade, and lifecycle hooks.
 */
function normalizeRedisModuleOptions(options: RedisModuleOptions): {
  clientOptions: RedisClientOptions;
  global: boolean;
  lifecycleOptions: RedisLifecycleOptions;
  name?: string;
} {
  const { global, lifecycle, name, ...clientOptions } = options;
  const normalizedName = name?.trim();

  if (normalizedName !== undefined && normalizedName.length === 0) {
    throw new Error('Redis client name must be a non-empty string when provided.');
  }

  if (normalizedName !== undefined && global === true) {
    throw new Error('Named Redis registrations are scoped and cannot be registered globally.');
  }

  return {
    clientOptions,
    global: normalizedName === undefined ? global ?? true : false,
    lifecycleOptions: lifecycle ?? {},
    name: normalizedName,
  };
}

function createRedisProviders(options: RedisClientOptions, lifecycleOptions: RedisLifecycleOptions, name?: string): Provider[] {
  const clientToken = getRedisClientToken(name);

  if (clientToken === REDIS_CLIENT) {
    return [
      {
        scope: 'singleton',
        provide: REDIS_CLIENT,
        useFactory: () => new Redis({
          ...options,
          lazyConnect: true,
        }),
      },
      RedisService,
      {
        inject: [REDIS_CLIENT],
        provide: RedisLifecycleService,
        scope: 'singleton',
        useFactory: (...deps: unknown[]) => {
          const [client] = deps as [Redis];
          return new RedisLifecycleService(client, undefined, lifecycleOptions);
        },
      },
    ];
  }

  if (name === undefined) {
    throw new Error('Redis client name must be defined for named provider creation.');
  }

  const serviceToken = getRedisServiceToken(name);

  return [
    {
      scope: 'singleton',
      provide: clientToken,
      useFactory: () => new Redis({
        ...options,
        lazyConnect: true,
      }),
    },
    {
      inject: [clientToken],
      provide: serviceToken,
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => {
        const [client] = deps as [Redis];
        return new RedisService(client);
      },
    },
    {
      inject: [clientToken],
      provide: getRedisLifecycleToken(name),
      scope: 'singleton',
      useFactory: (...deps: unknown[]) => {
        const [client] = deps as [Redis];
        return new RedisLifecycleService(client, name, lifecycleOptions);
      },
    },
  ];
}

/** Runtime module entrypoint for the shared Redis client integration. */
export class RedisModule {
  /**
   * Registers the default Redis client or an additional named Redis client.
   *
   * @param options Redis client options. Pass `name` to derive named client and service tokens.
   * @returns A module definition that exports the matching Redis client and facade tokens.
   *
   * @see getRedisClientToken
   * @see getRedisServiceToken
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { RedisModule } from '@fluojs/redis';
   *
   * @Module({
   *   imports: [
   *     RedisModule.forRoot({ host: 'localhost', port: 6379 }),
   *     RedisModule.forRoot({ name: 'analytics', host: 'localhost', port: 6380 }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: RedisModuleOptions): ModuleType {
    const normalized = normalizeRedisModuleOptions(options);
    const clientToken = getRedisClientToken(normalized.name);
    const serviceToken = getRedisServiceToken(normalized.name);
    class RedisModuleDefinition {}

    return defineModule(RedisModuleDefinition, {
      global: normalized.global,
      exports: normalized.name === undefined ? [REDIS_CLIENT, RedisService] : [clientToken, serviceToken],
      providers: createRedisProviders(normalized.clientOptions, normalized.lifecycleOptions, normalized.name),
    });
  }
}
