import { describe, expect, it } from 'vitest';

import * as terminus from './index.js';
import * as terminusNode from './node.js';
import * as terminusRedis from './redis.js';

describe('terminus public surface', () => {
  it('keeps health-indicator seams public while internalizing options wiring', () => {
    expect(terminus).toHaveProperty('TERMINUS_HEALTH_INDICATORS');
    expect(terminus).toHaveProperty('TERMINUS_INDICATOR_PROVIDER_TOKENS');
    expect(terminus).toHaveProperty('TerminusHealthService');
    expect(terminus).not.toHaveProperty('TERMINUS_OPTIONS');
    expect(terminus).toHaveProperty('HttpHealthIndicator');
    expect(terminus).toHaveProperty('PrismaHealthIndicator');
    expect(terminus).toHaveProperty('DrizzleHealthIndicator');
    expect(terminus.HttpHealthIndicator.create).toBeTypeOf('function');
    expect(terminus.PrismaHealthIndicator.create).toBeTypeOf('function');
    expect(terminus.DrizzleHealthIndicator.create).toBeTypeOf('function');
    expect(terminus).not.toHaveProperty('createHttpHealthIndicator');
    expect(terminus).not.toHaveProperty('createDiskHealthIndicator');
    expect(terminus).not.toHaveProperty('createMemoryHealthIndicator');
    expect(terminus).not.toHaveProperty('createPrismaHealthIndicator');
    expect(terminus).not.toHaveProperty('createDrizzleHealthIndicator');
    expect(terminus).not.toHaveProperty('DiskHealthIndicator');
    expect(terminus).not.toHaveProperty('MemoryHealthIndicator');
    expect(terminus).not.toHaveProperty('RedisHealthIndicator');
    expect(terminus).not.toHaveProperty('createRedisHealthIndicator');
    expect(terminus).not.toHaveProperty('createRedisHealthIndicatorProvider');
  });

  it('exposes Nest-style canonical module entrypoint', () => {
    expect(terminus).toHaveProperty('TerminusModule');
    expect((terminus as { TerminusModule: { forRoot: unknown } }).TerminusModule).toHaveProperty('forRoot');
    expect(terminus).not.toHaveProperty('createTerminusModule');
    expect(terminus).not.toHaveProperty('createTerminusProviders');
  });

  it('keeps redis-specific indicators on the dedicated subpath export', () => {
    expect(terminusRedis).toHaveProperty('RedisHealthIndicator');
    expect(terminusRedis.RedisHealthIndicator.create).toBeTypeOf('function');
    expect(terminusRedis).not.toHaveProperty('createRedisHealthIndicator');
    expect(terminusRedis).toHaveProperty('createRedisHealthIndicatorProvider');
  });

  it('keeps Node-specific indicators on the dedicated node subpath export', () => {
    expect(terminusNode).toHaveProperty('DiskHealthIndicator');
    expect(terminusNode).toHaveProperty('MemoryHealthIndicator');
    expect(terminusNode.DiskHealthIndicator.create).toBeTypeOf('function');
    expect(terminusNode.MemoryHealthIndicator.create).toBeTypeOf('function');
    expect(terminusNode).not.toHaveProperty('createDiskHealthIndicator');
    expect(terminusNode).not.toHaveProperty('createDiskHealthIndicatorProvider');
    expect(terminusNode).not.toHaveProperty('createMemoryHealthIndicator');
    expect(terminusNode).not.toHaveProperty('createMemoryHealthIndicatorProvider');
  });
});
