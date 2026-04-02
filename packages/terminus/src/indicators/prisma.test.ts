import { describe, expect, it, vi } from 'vitest';

import type { HealthCheckError } from '../errors.js';
import { createPrismaHealthIndicator, PrismaHealthIndicator } from './prisma.js';

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
});
