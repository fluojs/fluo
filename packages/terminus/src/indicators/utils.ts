import { HealthCheckError } from '../errors.js';
import type { HealthIndicatorResult } from '../types.js';

/** Timeout settings shared by indicators that call external dependencies. */
export interface IndicatorTimeoutOptions {
  timeoutMs?: number;
}

/**
 * Create an `up` indicator result payload.
 *
 * @param key Indicator key used in the aggregated report.
 * @param details Optional structured details to merge into the success state.
 * @returns A one-entry health indicator result marked as `up`.
 */
export function createUpResult(key: string, details: Record<string, unknown> = {}): HealthIndicatorResult {
  return {
    [key]: {
      ...details,
      status: 'up',
    },
  };
}

/**
 * Create a `down` indicator result payload.
 *
 * @param key Indicator key used in the aggregated report.
 * @param message Human-readable failure message.
 * @param details Optional structured details to merge into the failure state.
 * @returns A one-entry health indicator result marked as `down`.
 */
export function createDownResult(
  key: string,
  message: string,
  details: Record<string, unknown> = {},
): HealthIndicatorResult {
  return {
    [key]: {
      ...details,
      message,
      status: 'down',
    },
  };
}

/**
 * Race an indicator promise against a timeout.
 *
 * @param promise Indicator promise that should finish within the timeout budget.
 * @param timeoutMs Timeout budget in milliseconds.
 * @param indicatorName Indicator name used in the timeout error message.
 * @returns The original promise result when it finishes in time.
 */
export function withIndicatorTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  indicatorName: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${indicatorName} health indicator timed out after ${String(timeoutMs)}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolve the effective key used in reports for one indicator execution.
 *
 * @param fallbackKey Built-in fallback key for the indicator type.
 * @param key Optional caller-supplied override.
 * @returns The trimmed override key when present, otherwise the fallback key.
 */
export function resolveIndicatorKey(
  fallbackKey: string,
  key: string | undefined,
): string {
  return key && key.trim().length > 0 ? key : fallbackKey;
}

/**
 * Throw a `HealthCheckError` with a structured cause payload.
 *
 * @param message Human-readable error message.
 * @param causes Structured indicator result payload to preserve in the exception.
 * @throws {HealthCheckError} Always throws with the provided message and causes.
 */
export function throwHealthCheckError(message: string, causes: HealthIndicatorResult): never {
  throw new HealthCheckError(message, causes);
}
