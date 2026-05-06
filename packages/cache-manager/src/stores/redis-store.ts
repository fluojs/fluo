import type { CacheStore, RedisCompatibleClient } from '../types.js';

/**
 * Redis store configuration for key ownership and reset scanning.
 */
export interface RedisStoreOptions {
  /**
   * Prefix used to scope keys owned by this cache store when deleting entries or resetting the store.
   */
  keyPrefix?: string;
  /**
   * Maximum number of keys requested per Redis SCAN iteration during reset.
   */
  scanCount?: number;
}

const DEFAULT_KEY_PREFIX = 'fluo:cache:';
const DEFAULT_SCAN_COUNT = 100;

interface RedisCacheEntry<T = unknown> {
  expiresAt?: number;
  value: T;
}

function parseEntry(raw: string): RedisCacheEntry | undefined {
  try {
    const decoded = JSON.parse(raw) as Partial<RedisCacheEntry>;

    if (!decoded || typeof decoded !== 'object' || !('value' in decoded)) {
      return undefined;
    }

    if (decoded.expiresAt !== undefined && (typeof decoded.expiresAt !== 'number' || !Number.isFinite(decoded.expiresAt))) {
      return undefined;
    }

    return {
      expiresAt: decoded.expiresAt,
      value: decoded.value,
    };
  } catch {
    return undefined;
  }
}

function normalizeScanResponse(result: [string | number, string[]]): { cursor: string; keys: string[] } {
  const [cursor, keys] = result;

  return {
    cursor: String(cursor),
    keys,
  };
}

function normalizePositiveTtlMilliseconds(ttlSeconds: number): number {
  return Math.max(1, Math.ceil(ttlSeconds * 1000));
}

function normalizeRedisExpirySeconds(ttlSeconds: number): number {
  return Math.max(1, Math.ceil(ttlSeconds));
}

/**
 * Cache store implementation backed by a Redis-compatible client.
 */
export class RedisStore implements CacheStore {
  private readonly ownedKeys = new Set<string>();
  private readonly keyPrefix: string;
  private readonly scanCount: number;

  constructor(
    private readonly client: RedisCompatibleClient,
    options: RedisStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
  }

  private toRedisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const redisKey = this.toRedisKey(key);
    const raw = await this.client.get(redisKey);

    if (raw === null) {
      return undefined;
    }

    const decoded = parseEntry(raw);

    if (!decoded) {
      return undefined;
    }

    if (decoded.expiresAt !== undefined && decoded.expiresAt <= Date.now()) {
      return undefined;
    }

    return decoded.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds = 0): Promise<void> {
    const now = Date.now();
    const redisKey = this.toRedisKey(key);
    const entry: RedisCacheEntry<T> = {
      value,
    };

    if (ttlSeconds > 0) {
      const ttlMilliseconds = normalizePositiveTtlMilliseconds(ttlSeconds);
      entry.expiresAt = now + ttlMilliseconds;
      const ttlSecondsRounded = normalizeRedisExpirySeconds(ttlSeconds);
      await this.client.set(redisKey, JSON.stringify(entry), 'EX', ttlSecondsRounded);
      this.trackOwnedKey(redisKey);
      return;
    }

    await this.client.set(redisKey, JSON.stringify(entry));
    this.trackOwnedKey(redisKey);
  }

  private trackOwnedKey(redisKey: string): void {
    if (this.keyPrefix.length === 0) {
      this.ownedKeys.add(redisKey);
    }
  }

  async del(key: string): Promise<void> {
    const redisKey = this.toRedisKey(key);

    await this.client.del(redisKey);
    this.ownedKeys.delete(redisKey);
  }

  async reset(): Promise<void> {
    if (this.keyPrefix.length === 0) {
      const keys = Array.from(this.ownedKeys);

      if (keys.length > 0) {
        const [firstKey, ...restKeys] = keys;

        if (firstKey !== undefined) {
          await this.client.del(firstKey, ...restKeys);
        }
      }

      this.ownedKeys.clear();
      return;
    }

    let cursor = '0';
    const pattern = `${this.keyPrefix}*`;

    do {
      const scanResult = normalizeScanResponse(
        await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', this.scanCount),
      );
      cursor = scanResult.cursor;

      if (scanResult.keys.length > 0) {
        const [firstKey, ...restKeys] = scanResult.keys;

        if (firstKey) {
          await this.client.del(firstKey, ...restKeys);
        }
      }
    } while (cursor !== '0');

    this.ownedKeys.clear();
  }
}
