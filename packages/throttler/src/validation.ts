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

function assertNonNegativeFiniteInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid throttler ${field}: expected a non-negative finite integer.`);
  }
}

function assertOptionalBoolean(value: boolean | undefined, field: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`Invalid throttler ${field}: expected a boolean when provided.`);
  }
}

/**
 * Validate one per-handler or module-level throttle policy.
 *
 * @param options Candidate throttle settings.
 * @returns A normalized throttle policy safe for runtime use.
 */
export function validateThrottleOptions(options: ThrottlerHandlerOptions): ThrottlerHandlerOptions {
  assertPositiveFiniteInteger(options.limit, 'limit');
  assertPositiveFiniteInteger(options.ttl, 'ttl');
  return {
    limit: options.limit,
    ttl: options.ttl,
  };
}

/**
 * Validate the public module options passed to `ThrottlerModule.forRoot(...)`.
 *
 * @param options Candidate module-wide throttler settings.
 * @returns A validated copy of the throttler module options.
 */
export function validateThrottlerModuleOptions(options: ThrottlerModuleOptions): ThrottlerModuleOptions {
  validateThrottleOptions(options);
  assertOptionalBoolean(options.global, 'global');
  assertOptionalBoolean(options.trustProxyHeaders, 'trustProxyHeaders');

  if (options.keyGenerator !== undefined && typeof options.keyGenerator !== 'function') {
    throw new Error('Invalid throttler keyGenerator: expected a function when provided.');
  }

  if (options.store !== undefined && (options.store === null || typeof options.store.consume !== 'function')) {
    throw new Error('Invalid throttler store.consume: expected a function when store is provided.');
  }

  return {
    global: options.global,
    keyGenerator: options.keyGenerator,
    limit: options.limit,
    store: options.store,
    trustProxyHeaders: options.trustProxyHeaders,
    ttl: options.ttl,
  };
}

/**
 * Validate one store-consume result before enforcing throttling decisions.
 *
 * @param entry Candidate store state returned by a throttler store.
 * @returns A validated throttler store entry.
 */
export function validateThrottlerStoreEntry(entry: ThrottlerStoreEntry): ThrottlerStoreEntry {
  assertPositiveFiniteInteger(entry.count, 'store count');
  assertFiniteInteger(entry.resetAt, 'store resetAt');

  if (entry.retryAfterMs !== undefined) {
    assertNonNegativeFiniteInteger(entry.retryAfterMs, 'store retryAfterMs');
  }

  const validatedEntry: ThrottlerStoreEntry = {
    count: entry.count,
    resetAt: entry.resetAt,
  };

  if (entry.retryAfterMs !== undefined) {
    validatedEntry.retryAfterMs = entry.retryAfterMs;
  }

  return validatedEntry;
}
