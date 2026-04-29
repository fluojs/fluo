import type Redis from 'ioredis';

import { throttlerRetryAfterMsSymbol } from './store-internals.js';
import type { ThrottlerConsumeInput, ThrottlerStore, ThrottlerStoreEntry } from './types.js';
import { validateThrottlerStoreEntry } from './validation.js';

const CONSUME_LUA = [
  "local key = KEYS[1]",
  "local ttlMs = tonumber(ARGV[1])",
  "local time = redis.call('TIME')",
  "local nowSeconds = tonumber(time[1])",
  "local nowMicros = tonumber(time[2])",
  'local now = math.floor((nowSeconds * 1000) + (nowMicros / 1000))',
  "local raw = redis.call('GET', key)",
  "local count",
  "local resetAt",
  'if not raw then',
  '  count = 1',
  '  resetAt = now + ttlMs',
  'else',
  '  local decoded = cjson.decode(raw)',
  "  count = tonumber(decoded['count']) or 0",
  "  resetAt = tonumber(decoded['resetAt']) or (now + ttlMs)",
  '  if now >= resetAt then',
  '    count = 1',
  '    resetAt = now + ttlMs',
  '  else',
  '    count = count + 1',
  '  end',
  'end',
  'local ttlMsLeft = math.max(resetAt - now, 1)',
  "redis.call('SET', key, cjson.encode({ count = count, resetAt = resetAt }), 'PX', ttlMsLeft)",
  'return {count, resetAt, ttlMsLeft}',
].join('\n');

function parseConsumeResult(result: unknown): ThrottlerStoreEntry {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Redis throttler consume script returned an invalid response.');
  }

  const count = Number(result[0]);
  const resetAt = Number(result[1]);
  const retryAfterMs = result.length >= 3 ? Number(result[2]) : Number.NaN;

  if (!Number.isFinite(count) || !Number.isFinite(resetAt)) {
    throw new Error('Redis throttler consume script returned non-numeric counters.');
  }

  const entry = validateThrottlerStoreEntry({
    count,
    resetAt,
  });

  if (Number.isFinite(retryAfterMs)) {
    Object.defineProperty(entry, throttlerRetryAfterMsSymbol, {
      configurable: false,
      enumerable: false,
      value: retryAfterMs,
      writable: false,
    });
  }

  return entry;
}

/**
 * Redis-backed throttler store for distributed rate limits.
 *
 * @remarks
 * This store uses one atomic Lua script per consume operation so concurrent
 * requests across instances observe the same counter and reset window.
 */
export class RedisThrottlerStore implements ThrottlerStore {
  constructor(private readonly client: Redis) {}

  /**
   * Consume one throttle slot for the provided key.
   *
   * @param key Stable throttle key derived from the current request.
   * @param input Current timestamp and TTL window in seconds.
   * @returns The updated counter value and reset timestamp for the current window.
   */
  async consume(key: string, input: ThrottlerConsumeInput): Promise<ThrottlerStoreEntry> {
    const result = await this.client.eval(
      CONSUME_LUA,
      1,
      key,
      String(input.ttlSeconds * 1000),
    );

    return parseConsumeResult(result);
  }
}
