import { describe, expect, it, vi } from 'vitest';

import { getRedisClientToken, type RedisStatusAdapterInput } from '@fluojs/redis';

import type { HealthCheckError } from '../errors.js';
import { createRedisHealthIndicator, createRedisHealthIndicatorProvider, RedisHealthIndicator } from './redis.js';

const unavailableRedisStates = [
  {
    healthStatus: 'degraded',
    message: 'Redis client is still in lazyConnect wait state.',
    readinessStatus: 'not-ready',
    status: 'wait',
  },
  {
    healthStatus: 'degraded',
    message: 'Redis client is connecting.',
    readinessStatus: 'degraded',
    status: 'connecting',
  },
  {
    healthStatus: 'degraded',
    message: 'Redis client is reconnecting.',
    readinessStatus: 'degraded',
    status: 'reconnecting',
  },
  {
    healthStatus: 'unhealthy',
    message: 'Redis client is close.',
    readinessStatus: 'not-ready',
    status: 'close',
  },
  {
    healthStatus: 'unhealthy',
    message: 'Redis client is end.',
    readinessStatus: 'not-ready',
    status: 'end',
  },
] satisfies ReadonlyArray<{
  healthStatus: 'degraded' | 'unhealthy';
  message: string;
  readinessStatus: 'degraded' | 'not-ready';
  status: RedisStatusAdapterInput['status'];
}>;

describe('RedisHealthIndicator', () => {
  it('uses redis ping methods when present', async () => {
    const ping = vi.fn(async () => 'PONG');
    const indicator = new RedisHealthIndicator({
      client: { ping, status: 'ready' },
    });

    await expect(indicator.check('redis')).resolves.toEqual({
      redis: {
        details: {
          componentId: 'redis.default',
          connectionState: 'ready',
          lazyConnect: true,
        },
        healthStatus: 'healthy',
        readinessStatus: 'ready',
        status: 'up',
      },
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('uses a custom ping callback without adding lifecycle metadata when client status is absent', async () => {
    const ping = vi.fn(async () => 'PONG');
    const indicator = createRedisHealthIndicator({ ping });

    await expect(indicator.check('redis')).resolves.toEqual({
      redis: {
        status: 'up',
      },
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  for (const state of unavailableRedisStates) {
    it(`maps Redis ${state.status} lifecycle readiness before pinging`, async () => {
      const ping = vi.fn(async () => 'PONG');
      const indicator = createRedisHealthIndicator({
        client: { ping, status: state.status },
      });

      await expect(indicator.check('redis')).rejects.toMatchObject({
        causes: {
          redis: {
            details: {
              componentId: 'redis.default',
              connectionState: state.status,
              lazyConnect: true,
            },
            healthStatus: state.healthStatus,
            message: state.message,
            readinessStatus: state.readinessStatus,
            status: 'down',
          },
        },
        message: 'Redis health check failed.',
        name: 'HealthCheckError',
      } satisfies Partial<HealthCheckError>);
      expect(ping).not.toHaveBeenCalled();
    });
  }

  it('rejects invalid timeoutMs before starting the Redis probe', async () => {
    const ping = vi.fn(async () => 'PONG');
    const indicator = createRedisHealthIndicator({
      client: { ping, status: 'ready' },
      timeoutMs: Number.NaN,
    });

    await expect(indicator.check('redis')).rejects.toMatchObject({
      causes: {
        redis: {
          message: 'redis health indicator timeoutMs must be a positive finite number.',
          status: 'down',
        },
      },
      message: 'Redis health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
    expect(ping).not.toHaveBeenCalled();
  });

  it('uses named Redis lifecycle metadata for named clients', async () => {
    const ping = vi.fn(async () => 'PONG');
    const indicator = createRedisHealthIndicator({
      client: { ping, status: 'ready' },
      clientName: 'cache',
      key: 'cache-redis',
    });

    await expect(indicator.check('redis')).resolves.toMatchObject({
      'cache-redis': {
        details: {
          componentId: 'redis.cache',
          connectionState: 'ready',
        },
        healthStatus: 'healthy',
        readinessStatus: 'ready',
        status: 'up',
      },
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('throws HealthCheckError when ping path is unavailable', async () => {
    const missingPing = createRedisHealthIndicator({ client: {} });

    await expect(missingPing.check('redis')).rejects.toMatchObject({
      causes: {
        redis: {
          message: 'Redis indicator requires a client with ping() or a ping callback.',
          status: 'down',
        },
      },
      message: 'Redis health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);

    const failingPing = createRedisHealthIndicator({
      ping: vi.fn(async () => {
        throw new Error('redis timeout');
      }),
    });

    await expect(failingPing.check('cache')).rejects.toMatchObject({
      causes: {
        cache: {
          message: 'redis timeout',
          status: 'down',
        },
      },
      message: 'Redis health check failed.',
      name: 'HealthCheckError',
    } satisfies Partial<HealthCheckError>);
  });

  it('uses helper tokens for default and named redis indicator providers', () => {
    const defaultProvider = createRedisHealthIndicatorProvider({ key: 'redis' });
    const namedProvider = createRedisHealthIndicatorProvider({ clientName: 'cache', key: 'cache-redis' });

    expect(defaultProvider).toMatchObject({ inject: [getRedisClientToken()] });
    expect(namedProvider).toMatchObject({ inject: [getRedisClientToken('cache')] });
    expect('provide' in defaultProvider && 'provide' in namedProvider && defaultProvider.provide).not.toBe(
      'provide' in namedProvider ? namedProvider.provide : undefined,
    );
  });
});
