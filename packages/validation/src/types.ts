import type { Constructor, MaybePromise, MetadataSource } from '@fluojs/core';

export interface ValidationIssue {
  /** Stable issue code for programmatic error handling. */
  code: string;
  /** Dot/bracket field path when the issue is field-scoped. */
  field?: string;
  /** Human-readable explanation for the failed rule. */
  message: string;
  /** Optional metadata source that produced this rule. */
  source?: MetadataSource;
}

/**
 * Validation engine contract used by HTTP binding and app-level validation flows.
 */
export interface Validator {
  /** Validates an existing instance without materializing nested objects. */
  validate(value: unknown, target: Constructor): MaybePromise<void>;
  /** Materializes and validates a value into a typed DTO instance. */
  materialize<T>(value: unknown, target: Constructor<T>): MaybePromise<T>;
}
