import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StatsFs } from 'node:fs';

import type { HealthCheckError } from '../errors.js';

const diskState = vi.hoisted(() => ({
  error: undefined as Error | undefined,
  stats: {
    bavail: 200,
    bfree: 200,
    blocks: 1_000,
    bsize: 4_096,
    ffree: 0,
    files: 0,
    type: 0,
  } as StatsFs,
}));

vi.mock('node:fs/promises', () => ({
  statfs: vi.fn(async (_path: string) => {
    if (diskState.error) {
      throw diskState.error;
    }

    return diskState.stats;
  }),
}));

import { createDiskHealthIndicator, DiskHealthIndicator } from './disk.js';

describe('DiskHealthIndicator', () => {
  afterEach(() => {
    diskState.error = undefined;
    diskState.stats = {
      bavail: 200,
      bfree: 200,
      blocks: 1_000,
      bsize: 4_096,
      ffree: 0,
      files: 0,
      type: 0,
    };
  });

  it('returns up when free capacity is above configured thresholds', async () => {
    const indicator = new DiskHealthIndicator({
      minFreeBytes: 100_000,
      minFreeRatio: 0.1,
      path: '/data',
    });

    const result = await indicator.check('disk');

    expect(result).toMatchObject({
      disk: {
        path: '/data',
        status: 'up',
        totalBytes: 4_096_000,
      },
    });
  });

  it('throws HealthCheckError when thresholds are breached or statfs fails', async () => {
    diskState.stats = {
      bavail: 5,
      bfree: 5,
      blocks: 1_000,
      bsize: 4_096,
      ffree: 0,
      files: 0,
      type: 0,
    };

    const indicator = createDiskHealthIndicator({
      minFreeBytes: 100_000,
      path: '/data',
    });

    await expect(indicator.check('disk')).rejects.toMatchObject({
      causes: {
        disk: {
          message: 'Disk free bytes dropped below the configured threshold.',
          status: 'down',
        },
      },
      message: 'Disk health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);

    diskState.error = new Error('permission denied');
    await expect(indicator.check('disk')).rejects.toMatchObject({
      causes: {
        disk: {
          message: 'permission denied',
          status: 'down',
        },
      },
      message: 'Disk health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
  });
});
