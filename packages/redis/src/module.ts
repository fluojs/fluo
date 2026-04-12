import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import Redis from 'ioredis';

import { getRedisServiceToken, RedisService } from './redis-service.js';
import { RedisLifecycleService } from './service.js';
import { getRedisClientToken, REDIS_CLIENT } from './tokens.js';
import type { RedisModuleOptions } from './types.js';

function getRedisLifecycleToken(name: string): symbol {
  return Symbol.for(`fluo.redis.lifecycle:${name}`);
}

/**
 * Creates the providers that back Fluo's shared Redis integration.
 *
 * @param options Redis constructor options forwarded to `ioredis` with `lazyConnect` forced on.
 * @param name Optional Redis client name for additional named registrations.
 * @returns Providers for the raw client token, the JSON-aware facade, and lifecycle hooks.
 */
export function createRedisProviders(options: RedisModuleOptions, name?: string): Provider[] {
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
      RedisLifecycleService,
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
        return new RedisLifecycleService(client, name);
      },
    },
  ];
}

/** Runtime module entrypoint for the shared Redis client integration. */
export class RedisModule {
  /**
   * Registers a global Redis client and exports the facade used across Fluo packages.
   *
   * @param options Redis client options used to construct the shared connection.
   * @returns A module definition that exports {@link REDIS_CLIENT} and {@link RedisService}.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { RedisModule } from '@fluojs/redis';
   *
   * @Module({
   *   imports: [RedisModule.forRoot({ host: 'localhost', port: 6379 })],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: RedisModuleOptions): ModuleType {
    class RedisModuleDefinition {}

    return defineModule(RedisModuleDefinition, {
      global: true,
      exports: [REDIS_CLIENT, RedisService],
      providers: createRedisProviders(options),
    });
  }

  static forRootNamed(name: string, options: RedisModuleOptions): ModuleType {
    const clientToken = getRedisClientToken(name);
    const serviceToken = getRedisServiceToken(name);
    class NamedRedisModuleDefinition {}

    return defineModule(NamedRedisModuleDefinition, {
      global: true,
      exports: [clientToken, serviceToken],
      providers: createRedisProviders(options, name),
    });
  }
}
