import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';
import Redis from 'ioredis';

import { REDIS_SERVICE, RedisService } from './redis-service.js';
import { RedisLifecycleService } from './service.js';
import { REDIS_CLIENT } from './tokens.js';
import type { RedisModuleOptions } from './types.js';

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
    {
      provide: REDIS_SERVICE,
      useClass: RedisService,
    },
    RedisLifecycleService,
  ];
}

export function createRedisModule(options: RedisModuleOptions): ModuleType {
  class RedisModule {}

  return defineModule(RedisModule, {
    global: true,
    exports: [REDIS_CLIENT, REDIS_SERVICE],
    providers: createRedisProviders(options),
  });
}
