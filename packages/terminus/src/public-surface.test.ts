import { describe, expect, it } from 'vitest';

import * as terminus from './index.js';
import * as terminusRedis from './redis.js';

describe('terminus public surface', () => {
  it('keeps health-indicator seams public while internalizing options wiring', () => {
    expect(terminus).toHaveProperty('TERMINUS_HEALTH_INDICATORS');
    expect(terminus).toHaveProperty('TERMINUS_INDICATOR_PROVIDER_TOKENS');
    expect(terminus).toHaveProperty('TerminusHealthService');
    expect(terminus).not.toHaveProperty('TERMINUS_OPTIONS');
    expect(terminus).not.toHaveProperty('RedisHealthIndicator');
  });

  it('exposes Nest-style canonical module entrypoint', () => {
    expect(terminus).toHaveProperty('TerminusModule');
    expect((terminus as { TerminusModule: { forRoot: unknown } }).TerminusModule).toHaveProperty('forRoot');
    expect(terminus).not.toHaveProperty('createTerminusModule');
  });

  it('keeps redis-specific indicators on the dedicated subpath export', () => {
    expect(terminusRedis).toHaveProperty('RedisHealthIndicator');
    expect(terminusRedis).toHaveProperty('createRedisHealthIndicator');
    expect(terminusRedis).toHaveProperty('createRedisHealthIndicatorProvider');
  });
});
