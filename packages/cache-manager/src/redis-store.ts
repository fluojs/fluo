import type { CacheStore, RedisCompatibleClient } from './types.js';

export interface RedisStoreOptions {
  keyPrefix?: string;
  scanCount?: number;
}

const DEFAULT_KEY_PREFIX = 'konekti:cache:';
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

export class RedisStore implements CacheStore {
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

    return decoded.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds = 0): Promise<void> {
    const now = Date.now();
    const entry: RedisCacheEntry<T> = {
      value,
    };

    if (ttlSeconds > 0) {
      const ttlMilliseconds = Math.max(1, Math.floor(ttlSeconds * 1000));
      entry.expiresAt = now + ttlMilliseconds;
      const ttlSecondsRounded = Math.max(1, Math.ceil(ttlMilliseconds / 1000));
      await this.client.set(this.toRedisKey(key), JSON.stringify(entry), 'EX', ttlSecondsRounded);
      return;
    }

    await this.client.set(this.toRedisKey(key), JSON.stringify(entry));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.toRedisKey(key));
  }

  async reset(): Promise<void> {
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
  }
}
