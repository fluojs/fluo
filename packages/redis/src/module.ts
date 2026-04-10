import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import Redis from 'ioredis';

import { RedisService } from './redis-service.js';
import { RedisLifecycleService } from './service.js';
import { REDIS_CLIENT } from './tokens.js';
import type { RedisModuleOptions } from './types.js';

/**
 * Creates the providers that back Konekti's shared Redis integration.
 *
 * @param options Redis constructor options forwarded to `ioredis` with `lazyConnect` forced on.
 * @returns Providers for the raw client token, the JSON-aware facade, and lifecycle hooks.
 */
export function createRedisProviders(options: RedisModuleOptions): Provider[] {
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

/** Runtime module entrypoint for the shared Redis client integration. */
export class RedisModule {
  /**
   * Registers a global Redis client and exports the facade used across Konekti packages.
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
}
