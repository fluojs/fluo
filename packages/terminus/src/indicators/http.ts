import type { Provider } from '@konekti/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError } from './utils.js';
import { HealthCheckError } from '../errors.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

export interface HttpHealthIndicatorOptions {
  expectedStatus?: number | readonly number[] | ((status: number) => boolean);
  headers?: Record<string, string>;
  key?: string;
  method?: string;
  timeoutMs?: number;
  url: string;
}

const DEFAULT_HTTP_TIMEOUT_MS = 2_000;

function isExpectedStatus(status: number, expected?: HttpHealthIndicatorOptions['expectedStatus']): boolean {
  if (typeof expected === 'function') {
    return expected(status);
  }

  if (Array.isArray(expected)) {
    return expected.includes(status);
  }

  if (typeof expected === 'number') {
    return status === expected;
  }

  return status >= 200 && status < 300;
}

export function createHttpHealthIndicator(options: HttpHealthIndicatorOptions): HealthIndicator {
  return new HttpHealthIndicator(options);
}

export function createHttpHealthIndicatorProvider(options: HttpHealthIndicatorOptions): Provider {
  return {
    provide: HttpHealthIndicator,
    useValue: new HttpHealthIndicator(options),
  };
}

export class HttpHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: HttpHealthIndicatorOptions) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('http', this.options.key ?? key);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const method = this.options.method ?? 'GET';

    const abortController = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`HTTP health check timed out after ${String(timeoutMs)}ms.`));
    }, timeoutMs);

    try {
      const response = await fetch(this.options.url, {
        headers: this.options.headers,
        method,
        signal: abortController.signal,
      });
      const responseTimeMs = Date.now() - startedAt;

      if (!isExpectedStatus(response.status, this.options.expectedStatus)) {
        throwHealthCheckError('HTTP health check failed.', createDownResult(indicatorKey, `Unexpected status code ${String(response.status)} from ${this.options.url}.`, {
          responseTimeMs,
          statusCode: response.status,
          url: this.options.url,
        }));
      }

      return createUpResult(indicatorKey, {
        responseTimeMs,
        statusCode: response.status,
        url: this.options.url,
      });
    } catch (error: unknown) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      throwHealthCheckError('HTTP health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : `HTTP health check failed for ${this.options.url}.`,
      ));
    } finally {
      clearTimeout(timeout);
    }
  }
}
