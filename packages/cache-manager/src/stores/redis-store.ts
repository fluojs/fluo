import {
  type CacheAtomicUpdate,
  type CacheStoreUpdateOptions,
  CacheUpdateError,
  CacheUpdateQueue,
  type CacheUpdateReducer,
  checkUpdateSignal,
  resolveUpdateExpiry,
} from '../atomic-update.js';
import type { CacheStore, RedisAtomicClient, RedisCompatibleClient } from '../types.js';

/**
 * Redis store configuration for key ownership and reset scanning.
 */
export interface RedisStoreOptions {
  /** Opt in to distributed WATCH transactions; reserves the namespace's NUL-prefixed epoch key. */
  atomicUpdates?: boolean;
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
const UPDATE_EPOCH_KEY = '\0atomic-update-epoch';
const UPDATE_INVALIDATION_PREFIX = '\0atomic-update-key:';

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

function normalizePositiveTtlMilliseconds(ttlSeconds: number, maximumTtlMilliseconds: number): number {
  return Math.min(maximumTtlMilliseconds, Math.max(1, Math.ceil(ttlSeconds * 1000)));
}

function normalizeRedisExpirySeconds(ttlSeconds: number, maximumTtlSeconds: number): number {
  return Math.min(maximumTtlSeconds, Math.max(1, Math.ceil(ttlSeconds)));
}

function escapeRedisGlobPattern(value: string): string {
  return value.replace(/[\\*?[\]]/g, '\\$&');
}

/**
 * Cache store implementation backed by a Redis-compatible client.
 */
export class RedisStore implements CacheStore {
  private readonly ownedKeys = new Set<string>();
  private readonly keyPrefix: string;
  private readonly scanCount: number;
  private readonly updates = new CacheUpdateQueue();
  /** Distributed capability exists only when atomicUpdates was explicitly enabled. */
  readonly atomicUpdate?: CacheAtomicUpdate;

  constructor(
    private readonly client: RedisCompatibleClient,
    options: RedisStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.scanCount = options.scanCount ?? DEFAULT_SCAN_COUNT;
    if (options.atomicUpdates) {
      if (!client.duplicate) throw new CacheUpdateError('unsupported');
      if (this.keyPrefix.length === 0) {
        throw new RangeError('Redis atomic updates require a non-empty keyPrefix.');
      }
      this.atomicUpdate = {
        scope: 'distributed',
        update: <T>(key: string, reducer: CacheUpdateReducer<T>, updateOptions: CacheStoreUpdateOptions = {}) =>
          this.updates.run(key, updateOptions, (signal, maxAttempts) =>
            this.updateWatched(key, reducer, updateOptions, signal, maxAttempts)),
      };
    }
  }

  private toRedisKey(key: string): string {
    if (this.atomicUpdate && (key === UPDATE_EPOCH_KEY || key.startsWith(UPDATE_INVALIDATION_PREFIX))) {
      throw new RangeError('Redis atomic update metadata keys are reserved.');
    }
    return `${this.keyPrefix}${key}`;
  }

  private createUpdateClient(): RedisAtomicClient {
    if (!this.client.duplicate) throw new CacheUpdateError('unsupported');
    return this.client.duplicate({ lazyConnect: false });
  }

  private async updateWatched<T>(
    key: string,
    reducer: CacheUpdateReducer<T>,
    options: CacheStoreUpdateOptions,
    signal: AbortSignal,
    maxAttempts: number,
  ): Promise<T | undefined> {
    const redisKey = this.toRedisKey(key);
    const epochKey = `${this.keyPrefix}${UPDATE_EPOCH_KEY}`;
    const invalidationKey = `${this.keyPrefix}${UPDATE_INVALIDATION_PREFIX}${key}`;
    const client = this.createUpdateClient();
    try {
      let initialEpoch: string | null | undefined;
      let initialInvalidation: string | null | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        checkUpdateSignal(signal);
        await client.watch(redisKey, epochKey, invalidationKey);
        const [epoch, invalidation] = await Promise.all([client.get(epochKey), client.get(invalidationKey)]);
        if ((initialEpoch !== undefined && epoch !== initialEpoch) ||
            (initialInvalidation !== undefined && invalidation !== initialInvalidation)) {
          throw new CacheUpdateError('invalidated');
        }
        initialEpoch = epoch;
        initialInvalidation = invalidation;
        const raw = await client.get(redisKey);
        const decoded = raw === null ? undefined : parseEntry(raw);
        const entry = decoded?.expiresAt !== undefined && decoded.expiresAt <= Date.now() ? undefined : decoded;
        checkUpdateSignal(signal);
        // JSON decoding is the same caller-typed boundary as get<T>().
        const decision = await reducer(entry?.value as T | undefined, { signal, attempt });
        checkUpdateSignal(signal);
        if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
          throw new CacheUpdateError('invalidated');
        }
        const transaction = client.multi();
        let result: T | undefined;
        switch (decision.action) {
          case 'delete':
            transaction.del(redisKey);
            break;
          case 'set': {
            const expiresAt = resolveUpdateExpiry(
              decision.ttlSeconds, entry?.expiresAt, entry !== undefined, options.defaultTtlSeconds ?? 0,
            );
            const serialized = JSON.stringify({ value: decision.value, expiresAt });
            if (!parseEntry(serialized)) throw new TypeError('Cache update requires a JSON-compatible value.');
            if (expiresAt === undefined) transaction.set(redisKey, serialized);
            else transaction.set(redisKey, serialized, 'PXAT', expiresAt);
            result = decision.value;
            break;
          }
        }
        checkUpdateSignal(signal);
        const committed = await transaction.exec();
        if (committed !== null) {
          for (const [error] of committed) if (error) throw error;
          return result;
        }
        checkUpdateSignal(signal);
        // Deletion (including missing-key invalidation), expiry, and reset are not retried.
        const [nextEpoch, nextInvalidation, nextRaw] = await Promise.all([
          client.get(epochKey), client.get(invalidationKey), client.get(redisKey),
        ]);
        const nextEntry = nextRaw === null ? undefined : parseEntry(nextRaw);
        if (nextEpoch !== initialEpoch || nextInvalidation !== initialInvalidation || !nextEntry ||
            (nextEntry.expiresAt !== undefined && nextEntry.expiresAt <= Date.now())) {
          throw new CacheUpdateError('invalidated');
        }
      }
      throw new CacheUpdateError('conflict');
    } finally {
      // This connection is never shared: closing also releases WATCH on every failure path.
      client.disconnect();
    }
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
      const maximumTtlMilliseconds = Number.MAX_SAFE_INTEGER - now;
      const ttlMilliseconds = normalizePositiveTtlMilliseconds(ttlSeconds, maximumTtlMilliseconds);
      entry.expiresAt = now + ttlMilliseconds;
      const maximumTtlSeconds = Math.floor(maximumTtlMilliseconds / 1000);
      const ttlSecondsRounded = normalizeRedisExpirySeconds(ttlSeconds, maximumTtlSeconds);
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

    this.updates.invalidate(key);
    if (this.atomicUpdate) {
      const client = this.createUpdateClient();
      try {
        // Retain invalidation identity across delete/recreate, including missing-key creators.
        const invalidationKey = `${this.keyPrefix}${UPDATE_INVALIDATION_PREFIX}${key}`;
        const result = await client.multi().set(invalidationKey, globalThis.crypto.randomUUID()).del(redisKey).exec();
        if (result === null) throw new CacheUpdateError('conflict');
        for (const [error] of result) if (error) throw error;
      } finally {
        client.disconnect();
      }
      return;
    }
    await this.client.del(redisKey);
    this.ownedKeys.delete(redisKey);
  }

  async reset(): Promise<void> {
    this.updates.invalidate();
    const epochKey = this.atomicUpdate ? `${this.keyPrefix}${UPDATE_EPOCH_KEY}` : undefined;
    if (epochKey !== undefined) {
      await this.client.set(epochKey, globalThis.crypto.randomUUID());
    }
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
    const pattern = `${escapeRedisGlobPattern(this.keyPrefix)}*`;

    do {
      const scanResult = normalizeScanResponse(
        await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', this.scanCount),
      );
      cursor = scanResult.cursor;

      if (scanResult.keys.length > 0) {
        const [firstKey, ...restKeys] = scanResult.keys.filter((key) => key !== epochKey);

        if (firstKey) {
          await this.client.del(firstKey, ...restKeys);
        }
      }
    } while (cursor !== '0');

    this.ownedKeys.clear();
  }
}
