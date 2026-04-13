import { describe, expect, it } from 'vitest';

import { HealthCheckError } from './errors.js';
import { assertHealthCheck, runHealthCheck } from './health-check.js';
import type { HealthIndicator } from './types.js';

describe('runHealthCheck', () => {
  it('aggregates up and down results into a structured report', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'database',
        check: async (key: string) => ({
          [key]: {
            latencyMs: 4,
            status: 'up',
          },
        }),
      },
      {
        key: 'cache',
        check: async (key: string) => ({
          [key]: {
            message: 'timeout',
            status: 'down',
          },
        }),
      },
    ];

    const report = await runHealthCheck(indicators);

    expect(report.status).toBe('error');
    expect(report.info).toEqual({
      database: {
        latencyMs: 4,
        status: 'up',
      },
    });
    expect(report.contributors).toEqual({
      down: ['cache'],
      up: ['database'],
    });
    expect(report.error).toEqual({
      cache: {
        message: 'timeout',
        status: 'down',
      },
    });
    expect(report.details.database?.status).toBe('up');
    expect(report.details.cache?.status).toBe('down');
    expect(typeof report.checkedAt).toBe('string');
  });

  it('converts thrown errors to down results', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'redis',
        check: async () => {
          throw new Error('redis unavailable');
        },
      },
    ];

    const report = await runHealthCheck(indicators);

    expect(report.status).toBe('error');
    expect(report.contributors).toEqual({
      down: ['redis'],
      up: [],
    });
    expect(report.error.redis).toEqual({
      message: 'redis unavailable',
      status: 'down',
    });
  });

  it('preserves HealthCheckError causes from failing indicators', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'database',
        check: async () => {
          throw new HealthCheckError('database failed', {
            database: {
              latencyMs: 1_500,
              message: 'timeout',
              status: 'down',
            },
          });
        },
      },
    ];

    const report = await runHealthCheck(indicators);

    expect(report.status).toBe('error');
    expect(report.error.database).toEqual({
      latencyMs: 1_500,
      message: 'timeout',
      status: 'down',
    });
  });

  it('preserves every keyed entry returned by a multi-result indicator', async () => {
    const indicators: HealthIndicator[] = [
      {
        key: 'dependencies',
        check: async () => ({
          database: { latencyMs: 4, status: 'up' },
          redis: { message: 'timeout', status: 'down' },
        }),
      },
    ];

    const report = await runHealthCheck(indicators);

    expect(report.status).toBe('error');
    expect(report.contributors).toEqual({
      down: ['redis'],
      up: ['database'],
    });
    expect(report.info).toEqual({
      database: { latencyMs: 4, status: 'up' },
    });
    expect(report.error).toEqual({
      redis: { message: 'timeout', status: 'down' },
    });
    expect(report.details).toEqual({
      database: { latencyMs: 4, status: 'up' },
      redis: { message: 'timeout', status: 'down' },
    });
  });
});

describe('assertHealthCheck', () => {
  it('returns the report for healthy outcomes', async () => {
    const report = await runHealthCheck([
      {
        key: 'memory',
        check: async (key: string) => ({ [key]: { status: 'up' } }),
      },
    ]);

    expect(assertHealthCheck(report)).toBe(report);
  });

  it('throws HealthCheckError for failing outcomes', async () => {
    const report = await runHealthCheck([
      {
        key: 'disk',
        check: async (key: string) => ({ [key]: { message: 'disk low', status: 'down' } }),
      },
    ]);

    try {
      assertHealthCheck(report, 'custom failed message');
      throw new Error('Expected assertHealthCheck to throw HealthCheckError.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HealthCheckError);
      expect((error as HealthCheckError).message).toBe('custom failed message');
      expect((error as HealthCheckError).causes).toEqual(report.error);
    }
  });
});
