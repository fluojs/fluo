import { describe, expect, it, vi } from 'vitest';

import type { HealthCheckError } from '../errors.js';
import { createDrizzleHealthIndicator, createDrizzleHealthIndicatorProvider, DrizzleHealthIndicator } from './drizzle.js';

describe('DrizzleHealthIndicator', () => {
  it('supports execute-capable drizzle handles', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const indicator = new DrizzleHealthIndicator({
      database: { execute },
    });

    await expect(indicator.check('drizzle')).resolves.toEqual({
      drizzle: {
        status: 'up',
      },
    });
    expect(execute).toHaveBeenCalledWith('select 1');
  });

  it('maps Drizzle lifecycle readiness before pinging', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const indicator = createDrizzleHealthIndicator({
      handleProvider: {
        createPlatformStatusSnapshot: () => ({
          details: {
            activeRequestTransactions: 0,
            lifecycleState: 'shutting-down',
          },
          health: {
            reason: 'Drizzle integration is draining request transactions during shutdown.',
            status: 'degraded',
          },
          readiness: {
            reason: 'Drizzle integration is shutting down.',
            status: 'not-ready',
          },
        }),
        current: () => ({ execute }),
      },
    });

    await expect(indicator.check('drizzle')).rejects.toMatchObject({
      causes: {
        drizzle: {
          details: {
            activeRequestTransactions: 0,
            lifecycleState: 'shutting-down',
          },
          healthStatus: 'degraded',
          message: 'Drizzle integration is shutting down.',
          readinessStatus: 'not-ready',
          status: 'down',
        },
      },
      message: 'Drizzle health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
    expect(execute).not.toHaveBeenCalled();
  });

  it('includes lifecycle status when lifecycle-aware Drizzle is ready', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const indicator = createDrizzleHealthIndicator({
      handleProvider: {
        createPlatformStatusSnapshot: () => ({
          details: {
            activeRequestTransactions: 0,
            lifecycleState: 'ready',
          },
          health: { status: 'healthy' },
          readiness: { status: 'ready' },
        }),
        current: () => ({ execute }),
      },
    });

    await expect(indicator.check('drizzle')).resolves.toEqual({
      drizzle: {
        details: {
          activeRequestTransactions: 0,
          lifecycleState: 'ready',
        },
        healthStatus: 'healthy',
        readinessStatus: 'ready',
        status: 'up',
      },
    });
    expect(execute).toHaveBeenCalledWith('select 1');
  });

  it('provider factory prefers lifecycle-aware Drizzle handles over raw pings', async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const provider = createDrizzleHealthIndicatorProvider();

    if (typeof provider === 'function' || !('useFactory' in provider)) {
      throw new Error('Expected Drizzle health indicator provider factory.');
    }

    const indicator = provider.useFactory({
      createPlatformStatusSnapshot: () => ({
        details: { lifecycleState: 'stopped' },
        health: { reason: 'Drizzle integration has been disposed.', status: 'unhealthy' },
        readiness: { reason: 'Drizzle integration is stopped.', status: 'not-ready' },
      }),
      current: () => ({ execute }),
    }, { execute }) as DrizzleHealthIndicator;

    await expect(indicator.check('drizzle')).rejects.toMatchObject({
      causes: {
        drizzle: {
          healthStatus: 'unhealthy',
          message: 'Drizzle integration is stopped.',
          readinessStatus: 'not-ready',
          status: 'down',
        },
      },
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
    expect(execute).not.toHaveBeenCalled();
  });

  it('supports ping callbacks and throws HealthCheckError for unsupported handles', async () => {
    const callbackIndicator = createDrizzleHealthIndicator({
      ping: vi.fn(async () => undefined),
    });

    await expect(callbackIndicator.check('db')).resolves.toEqual({
      db: {
        status: 'up',
      },
    });

    const unsupported = createDrizzleHealthIndicator({
      database: {},
    });

    await expect(unsupported.check('drizzle')).rejects.toMatchObject({
      causes: {
        drizzle: {
          message: 'Drizzle indicator requires an execute-capable database handle or a ping callback.',
          status: 'down',
        },
      },
      message: 'Drizzle health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
  });
});
