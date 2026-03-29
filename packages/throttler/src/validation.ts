import type { ThrottlerHandlerOptions, ThrottlerModuleOptions } from './types.js';

function assertPositiveFiniteInteger(value: number, field: 'limit' | 'ttl'): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid throttler ${field}: expected a positive finite integer.`);
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
