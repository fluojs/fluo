import type { Provider } from '@fluojs/di';
import { createRedisPlatformStatusSnapshot, getRedisClientToken, getRedisComponentId, type RedisStatusAdapterInput } from '@fluojs/redis';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError, withIndicatorTimeout } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

interface RedisClientLike {
  ping?: () => Promise<unknown>;
  status?: RedisStatusAdapterInput['status'];
}

/**
 * Options for probing Redis connectivity.
 *
 * `client` may be a raw `ioredis`-compatible handle resolved from `@fluojs/redis`.
 * When that handle exposes a Redis `status`, Terminus maps the lifecycle state into
 * health/readiness metadata before issuing `PING`, so shutdown or disconnected clients
 * fail readiness even if a raw ping callback would still be callable.
 */
export interface RedisHealthIndicatorOptions {
  /** Raw Redis client to probe. Its `status` is used for lifecycle-aware readiness when available. */
  client?: RedisClientLike;
  /** Named Redis registration to resolve when using `createRedisHealthIndicatorProvider(...)`. */
  clientName?: string;
  /** Indicator result key override. Defaults to the key passed to `check(...)`, then `redis`. */
  key?: string;
  /** Custom ping callback for manual probes or tests. Lifecycle state is only mapped when `client.status` is available. */
  ping?: () => Promise<unknown> | unknown;
  /** Maximum time to wait for the ping operation. Defaults to `2_000` ms. */
  timeoutMs?: number;
}

const DEFAULT_REDIS_TIMEOUT_MS = 2_000;

async function runRedisPing(options: RedisHealthIndicatorOptions): Promise<void> {
  if (options.ping) {
    await options.ping();
    return;
  }

  const client = options.client;

  if (!client || typeof client.ping !== 'function') {
    throw new Error('Redis indicator requires a client with ping() or a ping callback.');
  }

  await client.ping();
}

function createRedisLifecycleDownResult(
  indicatorKey: string,
  options: RedisHealthIndicatorOptions,
): HealthIndicatorResult | undefined {
  const status = options.client?.status;

  if (!status) {
    return undefined;
  }

  const snapshot = createRedisPlatformStatusSnapshot({
    componentId: getRedisComponentId(options.clientName),
    status,
  });

  if (snapshot.health.status === 'healthy' && snapshot.readiness.status === 'ready') {
    return undefined;
  }

  const message = snapshot.readiness.reason
    ?? snapshot.health.reason
    ?? `Redis lifecycle reported health=${snapshot.health.status} readiness=${snapshot.readiness.status}.`;

  return createDownResult(indicatorKey, message, {
    details: snapshot.details,
    healthStatus: snapshot.health.status,
    readinessStatus: snapshot.readiness.status,
  });
}

function createRedisLifecycleUpDetails(options: RedisHealthIndicatorOptions): Record<string, unknown> {
  const status = options.client?.status;

  if (!status) {
    return {};
  }

  const snapshot = createRedisPlatformStatusSnapshot({
    componentId: getRedisComponentId(options.clientName),
    status,
  });

  return {
    details: snapshot.details,
    healthStatus: snapshot.health.status,
    readinessStatus: snapshot.readiness.status,
  };
}

/**
 * Create a Redis health indicator.
 *
 * @param options Optional Redis client, named-client hint, ping callback, timeout, and key override.
 * @returns A health indicator that checks Redis lifecycle status before `PING` when client state is available.
 */
export function createRedisHealthIndicator(options: RedisHealthIndicatorOptions = {}): HealthIndicator {
  return new RedisHealthIndicator(options);
}

/**
 * Create a provider that resolves a Redis client from DI and wraps it as an indicator.
 *
 * The provider resolves `getRedisClientToken(options.clientName)`, preserving the
 * default-vs-named client lifecycle boundary from `@fluojs/redis` while keeping the
 * Redis-specific peer dependency isolated to `@fluojs/terminus/redis`.
 *
 * @param options Optional named-client hint, timeout, key override, or custom ping callback.
 * @returns A factory provider that exposes `RedisHealthIndicator` from the DI container.
 */
export function createRedisHealthIndicatorProvider(options: Omit<RedisHealthIndicatorOptions, 'client'> = {}): Provider {
  const indicatorProviderToken = Symbol('fluo.terminus.redis-health-indicator');

  return {
    inject: [getRedisClientToken(options.clientName)],
    provide: indicatorProviderToken,
    useFactory: (client: unknown) => new RedisHealthIndicator({ ...options, client: client as RedisClientLike }),
  };
}

/** Health indicator that maps Redis lifecycle status and checks reachability with a ping-like operation. */
export class RedisHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: RedisHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('redis', this.options.key ?? key);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_REDIS_TIMEOUT_MS;

    try {
      const lifecycleDownResult = createRedisLifecycleDownResult(indicatorKey, this.options);

      if (lifecycleDownResult) {
        throwHealthCheckError('Redis health check failed.', lifecycleDownResult);
      }

      await withIndicatorTimeout(runRedisPing(this.options), timeoutMs, indicatorKey);
      return createUpResult(indicatorKey, createRedisLifecycleUpDetails(this.options));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'HealthCheckError') {
        throw error;
      }

      throwHealthCheckError('Redis health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : 'Redis health check failed.',
      ));
    }
  }
}
