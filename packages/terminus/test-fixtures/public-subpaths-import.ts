import {
  createMemoryHealthIndicator,
  createMemoryHealthIndicatorProvider,
  MemoryHealthIndicator,
  type MemoryHealthIndicatorOptions,
} from '@fluojs/terminus/node';
import {
  createRedisHealthIndicator,
  createRedisHealthIndicatorProvider,
  RedisHealthIndicator,
  type RedisHealthIndicatorOptions,
} from '@fluojs/terminus/redis';

const memoryOptions = {
  heapUsedThresholdBytes: 1_024,
  key: 'memory',
  readiness: true,
} satisfies MemoryHealthIndicatorOptions;
const redisOptions = {
  key: 'redis',
  ping: async () => undefined,
  timeoutMs: 10,
} satisfies RedisHealthIndicatorOptions;

new MemoryHealthIndicator(memoryOptions);
createMemoryHealthIndicator(memoryOptions);
createMemoryHealthIndicatorProvider(memoryOptions);
new RedisHealthIndicator(redisOptions);
createRedisHealthIndicator(redisOptions);
createRedisHealthIndicatorProvider(redisOptions);
