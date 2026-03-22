import type Redis from 'ioredis';

import type { ThrottlerConsumeInput, ThrottlerStore, ThrottlerStoreEntry } from './types.js';

const CONSUME_LUA = [
  "local key = KEYS[1]",
  "local now = tonumber(ARGV[1])",
  "local ttlMs = tonumber(ARGV[2])",
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
  'local ttlMsLeft = resetAt - now',
  "if ttlMsLeft > 0 then",
  '  local ttlSeconds = math.floor((ttlMsLeft + 999) / 1000)',
  "  redis.call('SET', key, cjson.encode({ count = count, resetAt = resetAt }), 'EX', ttlSeconds)",
  'end',
  'return {count, resetAt}',
].join('\n');

function parseConsumeResult(result: unknown): ThrottlerStoreEntry {
  if (!Array.isArray(result) || result.length < 2) {
    throw new Error('Redis throttler consume script returned an invalid response.');
  }

  const count = Number(result[0]);
  const resetAt = Number(result[1]);

  if (!Number.isFinite(count) || !Number.isFinite(resetAt)) {
    throw new Error('Redis throttler consume script returned non-numeric counters.');
  }

  return { count, resetAt };
}

export class RedisThrottlerStore implements ThrottlerStore {
  constructor(private readonly client: Redis) {}

  async consume(key: string, input: ThrottlerConsumeInput): Promise<ThrottlerStoreEntry> {
    const result = await this.client.eval(
      CONSUME_LUA,
      1,
      key,
      String(input.now),
      String(input.ttlSeconds * 1000),
    );

    return parseConsumeResult(result);
  }
}
