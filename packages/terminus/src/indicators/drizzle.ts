import { optional, type Provider } from '@fluojs/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError, withIndicatorTimeout } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

const DRIZZLE_DATABASE = Symbol.for('fluo.drizzle.database');
const DRIZZLE_HANDLE_PROVIDER = Symbol.for('fluo.drizzle.handle-provider');

interface DrizzleExecuteLike {
  execute?: (query: unknown) => Promise<unknown>;
}

interface DrizzleLifecycleSnapshotLike {
  details?: Record<string, unknown>;
  health: {
    reason?: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
  };
  readiness: {
    reason?: string;
    status: 'ready' | 'not-ready';
  };
}

interface DrizzleHandleProviderLike {
  createPlatformStatusSnapshot?: () => DrizzleLifecycleSnapshotLike;
  current?: () => DrizzleExecuteLike | unknown;
}

/** Options for probing Drizzle-backed database connectivity. */
export interface DrizzleHealthIndicatorOptions {
  database?: DrizzleExecuteLike;
  handleProvider?: DrizzleHandleProviderLike;
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

  const database = options.database ?? resolveCurrentDatabase(options.handleProvider);

  if (!database || typeof database.execute !== 'function') {
    throw new Error(
      'Drizzle indicator requires an execute-capable database handle or a ping callback.',
    );
  }

  await database.execute(options.query ?? DEFAULT_DRIZZLE_QUERY);
}

function resolveCurrentDatabase(handleProvider: DrizzleHandleProviderLike | undefined): DrizzleExecuteLike | undefined {
  if (!handleProvider || typeof handleProvider.current !== 'function') {
    return undefined;
  }

  return handleProvider.current() as DrizzleExecuteLike;
}

function createDrizzleLifecycleDownResult(
  indicatorKey: string,
  snapshot: DrizzleLifecycleSnapshotLike,
): HealthIndicatorResult | undefined {
  const healthStatus = snapshot.health.status;
  const readinessStatus = snapshot.readiness.status;

  if (healthStatus === 'healthy' && readinessStatus === 'ready') {
    return undefined;
  }

  const message = snapshot.readiness.reason
    ?? snapshot.health.reason
    ?? `Drizzle lifecycle reported health=${healthStatus} readiness=${readinessStatus}.`;

  return createDownResult(indicatorKey, message, {
    details: snapshot.details,
    healthStatus,
    readinessStatus,
  });
}

function createDrizzleLifecycleSnapshot(
  handleProvider: DrizzleHandleProviderLike | undefined,
): DrizzleLifecycleSnapshotLike | undefined {
  if (!handleProvider || typeof handleProvider.createPlatformStatusSnapshot !== 'function') {
    return undefined;
  }

  return handleProvider.createPlatformStatusSnapshot();
}

/**
 * Create a Drizzle health indicator.
 *
 * @param options Optional lifecycle-aware handle provider, database handle, ping callback, timeout, query, and key override.
 * @returns A health indicator that checks Drizzle lifecycle state before executing a lightweight query.
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
export function createDrizzleHealthIndicatorProvider(options: Omit<DrizzleHealthIndicatorOptions, 'database' | 'handleProvider'> = {}): Provider {
  return {
    inject: [optional(DRIZZLE_HANDLE_PROVIDER), optional(DRIZZLE_DATABASE)],
    provide: DrizzleHealthIndicator,
    useFactory: (handleProvider: unknown, database: unknown) => {
      const resolvedHandleProvider = typeof handleProvider === 'object' && handleProvider !== null
        ? handleProvider as DrizzleHandleProviderLike
        : undefined;

      return new DrizzleHealthIndicator({
        ...options,
        database: database as DrizzleExecuteLike | undefined,
        handleProvider: resolvedHandleProvider,
      });
    },
  };
}

/** Health indicator that maps Drizzle lifecycle state and probes connectivity with an execute-capable handle. */
export class DrizzleHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: DrizzleHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('drizzle', this.options.key ?? key);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_DRIZZLE_TIMEOUT_MS;

    try {
      const snapshot = createDrizzleLifecycleSnapshot(this.options.handleProvider);
      const lifecycleDownResult = snapshot
        ? createDrizzleLifecycleDownResult(indicatorKey, snapshot)
        : undefined;

      if (lifecycleDownResult) {
        throwHealthCheckError('Drizzle health check failed.', lifecycleDownResult);
      }

      await withIndicatorTimeout(runDrizzlePing(this.options), timeoutMs, indicatorKey);
      return createUpResult(indicatorKey, snapshot
        ? {
            details: snapshot.details,
            healthStatus: snapshot.health.status,
            readinessStatus: snapshot.readiness.status,
          }
        : {});
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'HealthCheckError') {
        throw error;
      }

      throwHealthCheckError('Drizzle health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : 'Drizzle health check failed.',
      ));
    }
  }
}
