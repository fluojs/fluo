/**
 * Injection token for the shared default `ioredis` client managed by {@link RedisModule}.
 *
 * @see getRedisClientToken For resolving the default or a named raw-client token through one helper.
 */
export const REDIS_CLIENT = Symbol.for('fluo.redis.client');

/** Stable name used when callers request the default Redis client contract. */
export const DEFAULT_REDIS_CLIENT_NAME = 'default';

function normalizeRedisClientName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const normalized = name.trim();

  if (normalized.length === 0) {
    throw new Error('Redis client name must be a non-empty string.');
  }

  return normalized;
}

/**
 * Resolves the DI token for the default or a named Redis client.
 *
 * @param name Optional Redis client name registered through `RedisModule.forRootNamed(...)`.
 * @returns The default `REDIS_CLIENT` token when `name` is omitted, otherwise a stable named token.
 *
 * @example
 * ```ts
 * const CACHE_REDIS = getRedisClientToken('cache');
 *
 * @Inject(CACHE_REDIS)
 * export class CacheInspector {
 *   constructor(private readonly redis: Redis) {}
 * }
 * ```
 *
 * @see RedisModule.forRootNamed
 * @see getRedisServiceToken
 */
export function getRedisClientToken(name?: string): symbol {
  const normalizedName = normalizeRedisClientName(name);

  if (normalizedName === undefined) {
    return REDIS_CLIENT;
  }

  return Symbol.for(`fluo.redis.client:${normalizedName}`);
}

/**
 * Builds the stable component/dependency id used by platform status snapshots.
 *
 * @param name Optional Redis client name registered through `RedisModule.forRootNamed(...)`.
 * @returns A stable component id such as `redis.default` or `redis.jobs`.
 *
 * @see getRedisClientToken
 */
export function getRedisComponentId(name?: string): string {
  return `redis.${normalizeRedisClientName(name) ?? DEFAULT_REDIS_CLIENT_NAME}`;
}
