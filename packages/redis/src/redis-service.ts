import { Inject, type Token } from '@fluojs/core';
import type Redis from 'ioredis';

import { REDIS_CLIENT, getRedisClientToken } from './tokens.js';

function decodeRedisValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * JSON-aware facade over the shared Redis client.
 *
 * Use this service for common key-value access when you want Fluo to handle
 * JSON serialization and lifecycle-managed connection reuse.
 *
 * @example
 * ```ts
 * import { Inject } from '@fluojs/core';
 * import { RedisService } from '@fluojs/redis';
 *
 * @Inject(RedisService)
 * export class SessionStore {
 *   constructor(private readonly redis: RedisService) {}
 *
 *   async save(sessionId: string, value: object) {
 *     await this.redis.set(`session:${sessionId}`, value, 300);
 *   }
 * }
 * ```
 *
 * @see getRedisServiceToken For resolving a named `RedisService` binding.
 */
@Inject(REDIS_CLIENT)
export class RedisService {
  constructor(private readonly client: Redis) {}

  /**
   * Reads one Redis value and attempts to decode JSON payloads automatically.
   *
   * @param key Redis key to fetch from the shared client.
   * @returns The parsed JSON value, the raw string payload, or `null` when the key is missing.
   */
  async get<T>(key: string): Promise<T | string | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }

    return decodeRedisValue(raw) as T | string;
  }

  /**
   * Stores one value after JSON serialization.
   *
   * @param key Redis key to write.
   * @param value Serializable value stored as JSON.
   * @param ttlSeconds Optional TTL in seconds. Omit or pass a non-positive value for a persistent key.
   * @returns A promise that resolves after Redis acknowledges the write.
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Deletes one key from Redis.
   *
   * @param key Redis key to remove.
   * @returns A promise that resolves once the delete command completes.
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Returns the underlying `ioredis` client for advanced commands.
   *
   * @returns The lifecycle-managed raw Redis client instance.
   */
  getRawClient(): Redis {
    return this.client;
  }
}

/**
 * Resolves the facade token for the default or a named `RedisService` binding.
 *
 * @param name Optional Redis client name registered through `RedisModule.forRootNamed(...)`.
 * @returns `RedisService` for the default client path, otherwise a stable named service token.
 *
 * @example
 * ```ts
 * const ANALYTICS_REDIS = getRedisServiceToken('analytics');
 *
 * @Inject(ANALYTICS_REDIS)
 * export class AnalyticsStore {
 *   constructor(private readonly redis: RedisService) {}
 * }
 * ```
 *
 * @see RedisModule.forRootNamed
 * @see getRedisClientToken
 */
export function getRedisServiceToken(name?: string): Token<RedisService> {
  if (getRedisClientToken(name) === REDIS_CLIENT) {
    return RedisService;
  }

  return Symbol.for(`fluo.redis.service:${name?.trim()}`) as Token<RedisService>;
}
