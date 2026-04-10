import type { Provider } from '@fluojs/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError, withIndicatorTimeout } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

const DRIZZLE_DATABASE = Symbol.for('konekti.drizzle.database');

interface DrizzleExecuteLike {
  execute?: (query: unknown) => Promise<unknown>;
}

/** Options for probing Drizzle-backed database connectivity. */
export interface DrizzleHealthIndicatorOptions {
  database?: DrizzleExecuteLike;
  key?: string;
  ping?: () => Promise<unknown> | unknown;
  query?: unknown;
  timeoutMs?: number;
}

const DEFAULT_DRIZZLE_TIMEOUT_MS = 2_000;
const DEFAULT_DRIZZLE_QUERY = 'select 1';

async function runDrizzlePing(options: DrizzleHealthIndicatorOptions): Promise<void> {
  if (options.ping) {
    await options.ping();
    return;
  }

  const database = options.database;

  if (!database || typeof database.execute !== 'function') {
    throw new Error(
      'Drizzle indicator requires an execute-capable database handle or a ping callback.',
    );
  }

  await database.execute(options.query ?? DEFAULT_DRIZZLE_QUERY);
}

/**
 * Create a Drizzle health indicator.
 *
 * @param options Optional database handle, ping callback, timeout, query, and key override.
 * @returns A health indicator that executes a lightweight Drizzle query.
 */
export function createDrizzleHealthIndicator(options: DrizzleHealthIndicatorOptions = {}): HealthIndicator {
  return new DrizzleHealthIndicator(options);
}

/**
 * Create a provider that resolves a Drizzle database handle from DI and wraps it as an indicator.
 *
 * @param options Optional timeout, query override, key override, or custom ping callback.
 * @returns A factory provider that exposes `DrizzleHealthIndicator` from the DI container.
 */
export function createDrizzleHealthIndicatorProvider(options: Omit<DrizzleHealthIndicatorOptions, 'database'> = {}): Provider {
  return {
    inject: [DRIZZLE_DATABASE],
    provide: DrizzleHealthIndicator,
    useFactory: (database: unknown) => new DrizzleHealthIndicator({ ...options, database: database as DrizzleExecuteLike }),
  };
}

/** Health indicator that probes Drizzle connectivity with an execute-capable handle. */
export class DrizzleHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: DrizzleHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('drizzle', this.options.key ?? key);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_DRIZZLE_TIMEOUT_MS;

    try {
      await withIndicatorTimeout(runDrizzlePing(this.options), timeoutMs, indicatorKey);
      return createUpResult(indicatorKey);
    } catch (error: unknown) {
      throwHealthCheckError('Drizzle health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : 'Drizzle health check failed.',
      ));
    }
  }
}
