import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HealthCheckError } from '../errors.js';
import { createMemoryHealthIndicator, MemoryHealthIndicator } from './memory.js';

function createMemoryUsage(overrides: Partial<NodeJS.MemoryUsage>): NodeJS.MemoryUsage {
  return {
    arrayBuffers: overrides.arrayBuffers ?? 10,
    external: overrides.external ?? 20,
    heapTotal: overrides.heapTotal ?? 100,
    heapUsed: overrides.heapUsed ?? 20,
    rss: overrides.rss ?? 120,
  };
}

describe('MemoryHealthIndicator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns up when usage is below configured thresholds', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue(createMemoryUsage({
      heapTotal: 100,
      heapUsed: 20,
      rss: 80,
    }));

    const indicator = new MemoryHealthIndicator({
      heapUsedThresholdBytes: 90,
      heapUsedThresholdRatio: 0.9,
      rssThresholdBytes: 100,
    });

    await expect(indicator.check('memory')).resolves.toEqual({
      memory: {
        arrayBuffers: 10,
        external: 20,
        heapTotal: 100,
        heapUsed: 20,
        rss: 80,
        status: 'up',
      },
    });
  });

  it('throws HealthCheckError when byte or ratio thresholds are exceeded', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue(createMemoryUsage({
      heapTotal: 100,
      heapUsed: 95,
      rss: 150,
    }));

    const ratioIndicator = createMemoryHealthIndicator({
      heapUsedThresholdRatio: 0.9,
    });

    await expect(ratioIndicator.check('memory')).rejects.toMatchObject({
      causes: {
        memory: {
          message: 'Heap usage exceeded the configured ratio threshold.',
          status: 'down',
        },
      },
      message: 'Memory health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);

    const rssIndicator = createMemoryHealthIndicator({
      heapUsedThresholdRatio: 0.99,
      rssThresholdBytes: 120,
    });

    await expect(rssIndicator.check('memory')).rejects.toMatchObject({
      causes: {
        memory: {
          message: 'RSS usage exceeded the configured byte threshold.',
          status: 'down',
        },
      },
      message: 'Memory health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
  });
});
