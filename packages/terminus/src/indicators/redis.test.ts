import { describe, expect, it, vi } from 'vitest';

import { getRedisClientToken } from '@fluojs/redis';

import type { HealthCheckError } from '../errors.js';
import { createRedisHealthIndicator, createRedisHealthIndicatorProvider, RedisHealthIndicator } from './redis.js';

describe('RedisHealthIndicator', () => {
  it('uses redis ping methods when present', async () => {
    const ping = vi.fn(async () => 'PONG');
    const indicator = new RedisHealthIndicator({
      client: { ping },
    });

    await expect(indicator.check('redis')).resolves.toEqual({
      redis: {
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
