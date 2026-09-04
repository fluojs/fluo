import type { Constructor, MaybePromise, MetadataSource } from '@fluojs/core';

/**
 * Describes the validation issue contract.
 */
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

/** Controls DTO materialization behavior. */
export interface MaterializeOptions {
  /** Policy for safe own enumerable input properties not declared by the DTO. */
  readonly undeclaredProperties?: 'preserve' | 'reject';
}

/**
 * Validation engine contract used by HTTP binding and app-level validation flows.
 */
export interface Validator {
  /**
   * Validates an existing root DTO or plain object.
   * Plain nested values may be temporarily materialized for nested DTO rules
   * without replacing the caller's properties.
   */
  validate(value: unknown, target: Constructor): MaybePromise<void>;
  /**
   * Materializes and validates a value into a typed DTO instance.
   *
   * @param value Root value to materialize.
   * @param target Requested DTO constructor.
   * @param options Optional materialization policy.
   */
  materialize<T>(value: unknown, target: Constructor<T>, options?: MaterializeOptions): MaybePromise<T>;
}
