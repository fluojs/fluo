import type { ThrottlerHandlerOptions, ThrottlerModuleOptions, ThrottlerStoreEntry } from './types.js';

function assertPositiveFiniteInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid throttler ${field}: expected a positive finite integer.`);
  }
}

function assertFiniteInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Invalid throttler ${field}: expected a finite integer.`);
  }
}

export function validateThrottleOptions(options: ThrottlerHandlerOptions): ThrottlerHandlerOptions {
  assertPositiveFiniteInteger(options.limit, 'limit');
  assertPositiveFiniteInteger(options.ttl, 'ttl');
  return {
    limit: options.limit,
    ttl: options.ttl,
  };
}

export function validateThrottlerModuleOptions(options: ThrottlerModuleOptions): ThrottlerModuleOptions {
  validateThrottleOptions(options);
  return options;
}

export function validateThrottlerStoreEntry(entry: ThrottlerStoreEntry): ThrottlerStoreEntry {
  assertPositiveFiniteInteger(entry.count, 'store count');
  assertFiniteInteger(entry.resetAt, 'store resetAt');

  return {
    count: entry.count,
    resetAt: entry.resetAt,
  };
}
