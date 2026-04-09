import { describe, expect, it, vi } from 'vitest';

import type Redis from 'ioredis';

import { RedisThrottlerStore } from './redis-store.js';

function createRedisClientMock(result: unknown) {
  return {
    eval: vi.fn(async () => result),
  } as unknown as Pick<Redis, 'eval'>;
}

describe('RedisThrottlerStore', () => {
  it('persists the reset window at the TTL boundary with millisecond precision', async () => {
    const now = 1_710_000_000_000;
    const client = createRedisClientMock([1, now + 60_000]);
    const store = new RedisThrottlerStore(client as Redis);

    const entry = await store.consume('throttle:auth:127.0.0.1', {
      now,
      ttlSeconds: 60,
    });

    expect(entry).toEqual({ count: 1, resetAt: now + 60_000 });
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("math.max(resetAt - now, 1)"),
      1,
      'throttle:auth:127.0.0.1',
      String(now),
      '60000',
    );
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET', key, cjson.encode({ count = count, resetAt = resetAt }), 'PX', ttlMsLeft)"),
      1,
      'throttle:auth:127.0.0.1',
      String(now),
      '60000',
    );
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
