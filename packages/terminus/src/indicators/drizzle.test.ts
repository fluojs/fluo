import { describe, expect, it, vi } from 'vitest';

import type { HealthCheckError } from '../errors.js';
import { createDrizzleHealthIndicator, DrizzleHealthIndicator } from './drizzle.js';

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
