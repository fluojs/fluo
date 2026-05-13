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
    expect(terminus).toHaveProperty('DiskHealthIndicator');
    expect(terminus).toHaveProperty('MemoryHealthIndicator');
    expect(terminus).not.toHaveProperty('RedisHealthIndicator');
  });

  it('exposes Nest-style canonical module entrypoint', () => {
    expect(terminus).toHaveProperty('TerminusModule');
    expect((terminus as { TerminusModule: { forRoot: unknown } }).TerminusModule).toHaveProperty('forRoot');
    expect(terminus).not.toHaveProperty('createTerminusModule');
    expect(terminus).not.toHaveProperty('createTerminusProviders');
  });

  it('keeps redis-specific indicators on the dedicated subpath export', () => {
    expect(terminusRedis).toHaveProperty('RedisHealthIndicator');
    expect(terminusRedis).toHaveProperty('createRedisHealthIndicator');
    expect(terminusRedis).toHaveProperty('createRedisHealthIndicatorProvider');
  });

  it('keeps Node-specific indicators on the dedicated node subpath export', () => {
    expect(terminusNode).toHaveProperty('DiskHealthIndicator');
    expect(terminusNode).toHaveProperty('MemoryHealthIndicator');
    expect(terminusNode).toHaveProperty('createDiskHealthIndicator');
    expect(terminusNode).toHaveProperty('createDiskHealthIndicatorProvider');
    expect(terminusNode).toHaveProperty('createMemoryHealthIndicator');
    expect(terminusNode).toHaveProperty('createMemoryHealthIndicatorProvider');
  });
});
