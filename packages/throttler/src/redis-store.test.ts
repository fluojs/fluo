import { describe, expect, it, vi } from 'vitest';

import type Redis from 'ioredis';

import { RedisThrottlerStore } from './redis-store.js';

function createRedisClientMock(result: unknown) {
  return {
    eval: vi.fn(async () => result),
  } as unknown as Pick<Redis, 'eval'>;
}

function createRedisTimeAnchoredClient(baseNow: number) {
  let redisNow = baseNow;
  let entry: { count: number; resetAt: number } | undefined;

  return {
    client: {
      eval: vi.fn(async () => {
        const ttlMs = 60_000;

        if (!entry || redisNow >= entry.resetAt) {
          entry = {
            count: 1,
            resetAt: redisNow + ttlMs,
          };

          return [entry.count, entry.resetAt, entry.resetAt - redisNow];
        }

        entry = {
          count: entry.count + 1,
          resetAt: entry.resetAt,
        };

        return [entry.count, entry.resetAt, entry.resetAt - redisNow];
      }),
    } as unknown as Pick<Redis, 'eval'>,
    setRedisNow(nextNow: number) {
      redisNow = nextNow;
    },
  };
}

describe('RedisThrottlerStore', () => {
  it('persists the reset window at the TTL boundary with millisecond precision', async () => {
    const now = 1_710_000_000_000;
    const client = createRedisClientMock([1, now + 60_000, 60_000]);
    const store = new RedisThrottlerStore(client as Redis);

    const entry = await store.consume('throttle:auth:127.0.0.1', {
      now,
      ttlSeconds: 60,
    });

    expect(entry).toEqual({ count: 1, resetAt: now + 60_000 });
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('TIME')"),
      1,
      'throttle:auth:127.0.0.1',
      '60000',
    );
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET', key, cjson.encode({ count = count, resetAt = resetAt }), 'PX', ttlMsLeft)"),
      1,
      'throttle:auth:127.0.0.1',
      '60000',
    );
  });

  it('anchors Redis windows to Redis server time across skewed app nodes', async () => {
    const baseNow = 1_710_000_000_000;
    const { client, setRedisNow } = createRedisTimeAnchoredClient(baseNow);
    const store = new RedisThrottlerStore(client as Redis);

    const first = await store.consume('throttle:auth:127.0.0.1', {
      now: baseNow - 30_000,
      ttlSeconds: 60,
    });

    setRedisNow(baseNow + 59_000);

    const second = await store.consume('throttle:auth:127.0.0.1', {
      now: baseNow + 30_000,
      ttlSeconds: 60,
    });

    setRedisNow(baseNow + 60_001);

    const third = await store.consume('throttle:auth:127.0.0.1', {
      now: baseNow - 45_000,
      ttlSeconds: 60,
    });

    expect(first).toEqual({ count: 1, resetAt: baseNow + 60_000 });
    expect(second).toEqual({ count: 2, resetAt: baseNow + 60_000 });
    expect(third).toEqual({ count: 1, resetAt: baseNow + 120_001 });
    expect(client.eval).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed consume-script responses', async () => {
    const client = createRedisClientMock(['not-a-number', 'still-not-a-number']);
    const store = new RedisThrottlerStore(client as Redis);

    await expect(
      store.consume('throttle:auth:127.0.0.1', {
        now: 1_710_000_000_000,
        ttlSeconds: 60,
      }),
    ).rejects.toThrow('Redis throttler consume script returned non-numeric counters.');
  });
});
