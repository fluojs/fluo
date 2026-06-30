import { describe, expect, it, vi } from 'vitest';

import type { HealthCheckError } from '../errors.js';
import { createPrismaHealthIndicator, createPrismaHealthIndicatorProvider, PrismaHealthIndicator } from './prisma.js';

function createReadyPrismaSnapshot() {
  return {
    details: {
      lifecycleState: 'ready',
    },
    health: {
      status: 'healthy' as const,
    },
    readiness: {
      status: 'ready' as const,
    },
  };
}

describe('PrismaHealthIndicator', () => {
  it('marks indicator up when ping callback succeeds', async () => {
    const indicator = new PrismaHealthIndicator({
      ping: vi.fn(async () => undefined),
    });

    await expect(indicator.check('prisma')).resolves.toEqual({
      prisma: {
        status: 'up',
      },
    });
  });

  it('uses query-capable prisma handles and throws HealthCheckError on failures', async () => {
    const okIndicator = createPrismaHealthIndicator({
      client: {
        $queryRawUnsafe: vi.fn(async (_query: string) => undefined),
      },
    });

    await expect(okIndicator.check('prisma')).resolves.toEqual({
      prisma: {
        status: 'up',
      },
    });

    const failingIndicator = new PrismaHealthIndicator({
      client: {
        $queryRawUnsafe: vi.fn(async (_query: string) => {
          throw new Error('prisma unavailable');
        }),
      },
    });

    await expect(failingIndicator.check('db')).rejects.toMatchObject({
      causes: {
        db: {
          message: 'prisma unavailable',
          status: 'down',
        },
      },
      message: 'Prisma health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
  });

  it('uses lifecycle-aware Prisma service facades before probing the current client', async () => {
    const query = vi.fn(async (_query: string) => undefined);
    const indicator = createPrismaHealthIndicator({
      service: {
        createPlatformStatusSnapshot: createReadyPrismaSnapshot,
        current: () => ({
          $queryRawUnsafe: query,
        }),
      },
    });

    await expect(indicator.check('prisma')).resolves.toEqual({
      prisma: {
        details: {
          lifecycleState: 'ready',
        },
        healthStatus: 'healthy',
        readinessStatus: 'ready',
        status: 'up',
      },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports Prisma lifecycle state as down before raw probes run', async () => {
    const query = vi.fn(async (_query: string) => undefined);
    const indicator = createPrismaHealthIndicator({
      service: {
        createPlatformStatusSnapshot: () => ({
          details: {
            lifecycleState: 'shutting-down',
          },
          health: {
            reason: 'Prisma integration is draining request transactions during shutdown.',
            status: 'degraded',
          },
          readiness: {
            reason: 'Prisma integration is shutting down.',
            status: 'not-ready',
          },
        }),
        current: () => ({
          $queryRawUnsafe: query,
        }),
      },
    });

    await expect(indicator.check('prisma')).rejects.toMatchObject({
      causes: {
        prisma: {
          details: {
            lifecycleState: 'shutting-down',
          },
          healthStatus: 'degraded',
          message: 'Prisma integration is shutting down.',
          readinessStatus: 'not-ready',
          status: 'down',
        },
      },
      message: 'Prisma health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves explicit Prisma service tokens before fallback client tokens in provider helpers', () => {
    const serviceToken = Symbol('custom-prisma-service');
    const clientToken = Symbol('custom-prisma-client');
    const provider = createPrismaHealthIndicatorProvider({ clientToken, serviceToken });

    if (typeof provider !== 'object' || provider === null || !('inject' in provider) || !('provide' in provider)) {
      throw new Error('Expected createPrismaHealthIndicatorProvider to return a factory provider.');
    }

    expect(typeof provider.provide).toBe('symbol');
    expect(provider.inject).toEqual([
      { __optional__: true, token: serviceToken },
      { __optional__: true, token: clientToken },
    ]);
  });

  it('rejects invalid timeoutMs before starting the Prisma probe', async () => {
    const ping = vi.fn(async () => undefined);
    const indicator = createPrismaHealthIndicator({
      ping,
      timeoutMs: -1,
    });

    await expect(indicator.check('prisma')).rejects.toMatchObject({
      causes: {
        prisma: {
          message: 'prisma health indicator timeoutMs must be a positive finite number.',
          status: 'down',
        },
      },
      message: 'Prisma health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
    expect(ping).not.toHaveBeenCalled();
  });
});
