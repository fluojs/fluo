import { describe, expect, it } from 'vitest';

import * as redisPublicApi from './index.js';

describe('@fluojs/redis public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(redisPublicApi).toHaveProperty('RedisModule');
    expect(redisPublicApi).toHaveProperty('createRedisProviders');
    expect(redisPublicApi).toHaveProperty('RedisService');
    expect(redisPublicApi).toHaveProperty('createRedisPlatformStatusSnapshot');
    expect(redisPublicApi).toHaveProperty('REDIS_CLIENT');
    expect(redisPublicApi).toHaveProperty('DEFAULT_REDIS_CLIENT_NAME');
    expect(redisPublicApi).toHaveProperty('getRedisClientToken');
    expect(redisPublicApi).toHaveProperty('getRedisServiceToken');
    expect(redisPublicApi).toHaveProperty('getRedisComponentId');
  });

  it('does not expose internal lifecycle wiring values from the root barrel', () => {
    expect(redisPublicApi).not.toHaveProperty('RedisLifecycleService');
    expect(redisPublicApi).not.toHaveProperty('normalizeRedisClientName');
    expect(redisPublicApi).not.toHaveProperty('decodeRedisValue');
  });
});
