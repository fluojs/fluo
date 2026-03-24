import { statfs } from 'node:fs/promises';

import type { Provider } from '@konekti/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

export interface DiskHealthIndicatorOptions {
  key?: string;
  minFreeBytes?: number;
  minFreeRatio?: number;
  path?: string;
}

const DEFAULT_DISK_FREE_RATIO_THRESHOLD = 0.1;

function toNumber(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function createDiskHealthIndicator(options: DiskHealthIndicatorOptions = {}): HealthIndicator {
  return new DiskHealthIndicator(options);
}

export function createDiskHealthIndicatorProvider(options: DiskHealthIndicatorOptions = {}): Provider {
  return {
    provide: DiskHealthIndicator,
    useValue: new DiskHealthIndicator(options),
  };
}

export class DiskHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: DiskHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('disk', this.options.key ?? key);
    const path = this.options.path ?? '.';
    const minFreeRatio = this.options.minFreeRatio ?? DEFAULT_DISK_FREE_RATIO_THRESHOLD;

    try {
      const stats = await statfs(path);
      const blockSize = toNumber(stats.bsize);
      const blocks = toNumber(stats.blocks);
      const availableBlocks = toNumber(stats.bavail);
      const freeBytes = availableBlocks * blockSize;
      const totalBytes = blocks * blockSize;
      const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1;

      const details = {
        freeBytes,
        freeRatio,
        path,
        totalBytes,
      };

      if (this.options.minFreeBytes !== undefined && freeBytes < this.options.minFreeBytes) {
        throwHealthCheckError('Disk health check failed.', createDownResult(indicatorKey, 'Disk free bytes dropped below the configured threshold.', details));
      }

      if (freeRatio < minFreeRatio) {
        throwHealthCheckError('Disk health check failed.', createDownResult(indicatorKey, 'Disk free ratio dropped below the configured threshold.', details));
      }

      return createUpResult(indicatorKey, details);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'HealthCheckError') {
        throw error;
      }

      throwHealthCheckError('Disk health check failed.', createDownResult(indicatorKey, error instanceof Error ? error.message : 'Disk health check failed.'));
    }
  }
}
