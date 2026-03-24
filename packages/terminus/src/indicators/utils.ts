import { HealthCheckError } from '../errors.js';
import type { HealthIndicatorResult } from '../types.js';

export interface IndicatorTimeoutOptions {
  timeoutMs?: number;
}

export function createUpResult(key: string, details: Record<string, unknown> = {}): HealthIndicatorResult {
  return {
    [key]: {
      ...details,
      status: 'up',
    },
  };
}

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

export function resolveIndicatorKey(
  fallbackKey: string,
  key: string | undefined,
): string {
  return key && key.trim().length > 0 ? key : fallbackKey;
}

export function throwHealthCheckError(message: string, causes: HealthIndicatorResult): never {
  throw new HealthCheckError(message, causes);
}
