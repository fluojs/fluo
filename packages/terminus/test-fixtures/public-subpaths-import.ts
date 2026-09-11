import {
  MemoryHealthIndicator,
  type MemoryHealthIndicatorOptions,
} from '@fluojs/terminus/node';
import {
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
MemoryHealthIndicator.create(memoryOptions);
new RedisHealthIndicator(redisOptions);
RedisHealthIndicator.create(redisOptions);
createRedisHealthIndicatorProvider(redisOptions);
