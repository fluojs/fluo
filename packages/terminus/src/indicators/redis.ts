import type { Provider } from '@fluojs/di';

import { createDownResult, createUpResult, resolveIndicatorKey, throwHealthCheckError, withIndicatorTimeout } from './utils.js';
import type { HealthIndicator, HealthIndicatorResult } from '../types.js';

const REDIS_CLIENT = Symbol.for('konekti.redis.client');

interface RedisClientLike {
  ping?: () => Promise<unknown>;
}

/** Options for probing Redis connectivity. */
export interface RedisHealthIndicatorOptions {
  client?: RedisClientLike;
  key?: string;
  ping?: () => Promise<unknown> | unknown;
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

/**
 * Create a Redis health indicator.
 *
 * @param options Optional Redis client, ping callback, timeout, and key override.
 * @returns A health indicator that checks Redis with `PING` semantics.
 */
export function createRedisHealthIndicator(options: RedisHealthIndicatorOptions = {}): HealthIndicator {
  return new RedisHealthIndicator(options);
}

/**
 * Create a provider that resolves a Redis client from DI and wraps it as an indicator.
 *
 * @param options Optional timeout, key override, or custom ping callback.
 * @returns A factory provider that exposes `RedisHealthIndicator` from the DI container.
 */
export function createRedisHealthIndicatorProvider(options: Omit<RedisHealthIndicatorOptions, 'client'> = {}): Provider {
  return {
    inject: [REDIS_CLIENT],
    provide: RedisHealthIndicator,
    useFactory: (client: unknown) => new RedisHealthIndicator({ ...options, client: client as RedisClientLike }),
  };
}

/** Health indicator that checks Redis reachability with a ping-like operation. */
export class RedisHealthIndicator implements HealthIndicator {
  readonly key: string | undefined;

  constructor(private readonly options: RedisHealthIndicatorOptions = {}) {
    this.key = options.key;
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicatorKey = resolveIndicatorKey('redis', this.options.key ?? key);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_REDIS_TIMEOUT_MS;

    try {
      await withIndicatorTimeout(runRedisPing(this.options), timeoutMs, indicatorKey);
      return createUpResult(indicatorKey);
    } catch (error: unknown) {
      throwHealthCheckError('Redis health check failed.', createDownResult(
        indicatorKey,
        error instanceof Error ? error.message : 'Redis health check failed.',
      ));
    }
  }
}
