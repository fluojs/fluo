import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { QueueLifecycleService } from './service.js';
import { QUEUE, QUEUE_OPTIONS } from './tokens.js';
import type { NormalizedQueueModuleOptions, QueueModuleOptions, QueueRateLimiterOptions } from './types.js';

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);

  if (normalized < 1) {
    return fallback;
  }

  return normalized;
}

function normalizeQueueModuleOptions(options: QueueModuleOptions = {}): NormalizedQueueModuleOptions {
  const defaultRateLimiter = normalizeRateLimiter(options.defaultRateLimiter);

  return {
    defaultAttempts: normalizePositiveInteger(options.defaultAttempts, 1),
    defaultBackoff: options.defaultBackoff
      ? {
          delayMs: options.defaultBackoff.delayMs,
          type: options.defaultBackoff.type,
        }
      : undefined,
    defaultConcurrency: normalizePositiveInteger(options.defaultConcurrency, 1),
    defaultRateLimiter,
  };
}

function normalizeRateLimiter(rateLimiter: QueueRateLimiterOptions | undefined): QueueRateLimiterOptions | undefined {
  if (!rateLimiter) {
    return undefined;
  }

  return {
    duration: normalizePositiveInteger(rateLimiter.duration, 1_000),
    max: normalizePositiveInteger(rateLimiter.max, 1),
  };
}

export function createQueueProviders(options: QueueModuleOptions = {}): Provider[] {
  return [
    {
      provide: QUEUE_OPTIONS,
      useValue: normalizeQueueModuleOptions(options),
    },
    {
      provide: QUEUE,
      useClass: QueueLifecycleService,
    },
  ];
}

export function createQueueModule(options: QueueModuleOptions = {}): ModuleType {
  class QueueModule {}

  return defineModule(QueueModule, {
    exports: [QUEUE],
    global: true,
    providers: createQueueProviders(options),
  });
}
