import type { Provider } from '@fluojs/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

/** Options for checking process heap and RSS thresholds. */
export interface MemoryHealthIndicatorOptions {
  heapUsedThresholdBytes?: number;
  heapUsedThresholdRatio?: number;
  key?: string;
  rssThresholdBytes?: number;
}

const DEFAULT_HEAP_RATIO_THRESHOLD = 0.95;

function exceedsRatioThreshold(used: number, total: number, threshold: number): boolean {
  if (total <= 0) {
    return false;
  }

  return used / total >= threshold;
}

/**
 * Create a process-memory health indicator.
 *
 * @param options Optional heap and RSS thresholds plus an indicator key override.
 * @returns A health indicator backed by `process.memoryUsage()`.
 */
export function createMemoryHealthIndicator(options: MemoryHealthIndicatorOptions = {}): HealthIndicator {
  return new MemoryHealthIndicator(options);
}

/**
 * Create a provider that registers a `MemoryHealthIndicator` instance.
 *
 * @param options Optional heap and RSS thresholds plus an indicator key override.
 * @returns A value provider that exposes `MemoryHealthIndicator` from the DI container.
 */
export function createMemoryHealthIndicatorProvider(options: MemoryHealthIndicatorOptions = {}): Provider {
  return {
    provide: MemoryHealthIndicator,
    useValue: new MemoryHealthIndicator(options),
  };
}

/** Health indicator that checks local process heap and RSS usage. */
export class MemoryHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: MemoryHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('memory', this.options.key ?? key);
    const heapRatioThreshold = this.options.heapUsedThresholdRatio ?? DEFAULT_HEAP_RATIO_THRESHOLD;

    const usage = process.memoryUsage();
    const usageDetails = {
      arrayBuffers: usage.arrayBuffers,
      external: usage.external,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      rss: usage.rss,
    };

    if (
      this.options.heapUsedThresholdBytes !== undefined
      && usage.heapUsed >= this.options.heapUsedThresholdBytes
    ) {
      throwHealthCheckError('Memory health check failed.', createDownResult(indicatorKey, 'Heap usage exceeded the configured byte threshold.', usageDetails));
    }

    if (this.options.rssThresholdBytes !== undefined && usage.rss >= this.options.rssThresholdBytes) {
      throwHealthCheckError('Memory health check failed.', createDownResult(indicatorKey, 'RSS usage exceeded the configured byte threshold.', usageDetails));
    }

    if (exceedsRatioThreshold(usage.heapUsed, usage.heapTotal, heapRatioThreshold)) {
      throwHealthCheckError('Memory health check failed.', createDownResult(indicatorKey, 'Heap usage exceeded the configured ratio threshold.', {
        ...usageDetails,
        heapUsedRatio: usage.heapTotal > 0 ? usage.heapUsed / usage.heapTotal : 0,
      }));
    }

    return createUpResult(indicatorKey, usageDetails);
  }
}
