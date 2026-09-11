import {
  MemoryHealthIndicator,
  type MemoryHealthIndicatorOptions,
} from '@fluojs/terminus/node';
import {
  createRedisHealthIndicatorProvider,
  RedisHealthIndicator,
  type RedisHealthIndicatorOptions,
} from '@fluojs/terminus/redis';
import type * as terminusRoot from '@fluojs/terminus';
import type * as terminusNode from '@fluojs/terminus/node';
import type * as terminusRedis from '@fluojs/terminus/redis';
import type * as runtime from '@fluojs/runtime';

type Assert<T extends true> = T;
type IsAbsent<Namespace, Symbol extends PropertyKey> = Symbol extends keyof Namespace ? false : true;
type RemovedRootExportsStayAbsent = Assert<IsAbsent<
  typeof terminusRoot,
  | 'createHttpHealthIndicator'
  | 'createDiskHealthIndicator'
  | 'createMemoryHealthIndicator'
  | 'createPrismaHealthIndicator'
  | 'createDrizzleHealthIndicator'
  | 'createRedisHealthIndicator'
  | 'DiskHealthIndicator'
  | 'MemoryHealthIndicator'
  | 'RedisHealthIndicator'
>>;
type RemovedNodeExportsStayAbsent = Assert<IsAbsent<
  typeof terminusNode,
  | 'createDiskHealthIndicator'
  | 'createDiskHealthIndicatorProvider'
  | 'createMemoryHealthIndicator'
  | 'createMemoryHealthIndicatorProvider'
>>;
type RemovedRedisExportsStayAbsent = Assert<IsAbsent<
  typeof terminusRedis,
  'createRedisHealthIndicator'
>>;
type RemovedRuntimeExportsStayAbsent = Assert<IsAbsent<
  typeof runtime,
  'createHealthModule'
>>;

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
