import { resolveClientIdentity } from '../client-identity.js';
import type { TrustProxyPolicy } from '../connection.js';
import { createErrorResponse, TooManyRequestsException } from '../exceptions.js';
import type { Middleware, MiddlewareContext } from '../types.js';

/** Snapshot of one key's current rate-limit window state. */
export interface RateLimitStoreEntry {
  count: number;
  resetAt: number;
}

/** Store contract used by `createRateLimitMiddleware(...)` request windows. */
export interface RateLimitStore {
  /**
   * Atomically initialize or reset a window and count the current request.
   *
   * @param key Request budget identity.
   * @param options Current epoch milliseconds and window duration in milliseconds.
   * @returns Independent snapshot including this request, even when over the limit.
   * @remarks Reset when `now >= resetAt`; otherwise keep the deadline unchanged.
   * Distributed stores must implement this as one backend atomic operation.
   * Without this capability middleware uses the legacy non-atomic get/set/increment path.
   */
  consume?(key: string, options: { now: number; windowMs: number }): RateLimitStoreEntry | Promise<RateLimitStoreEntry>;
  get(key: string): RateLimitStoreEntry | undefined | Promise<RateLimitStoreEntry | undefined>;
  set(key: string, entry: RateLimitStoreEntry): void | Promise<void>;
  increment(key: string): number | Promise<number>;
  evict(now: number): void | Promise<void>;
}

/** Public configuration contract for `createRateLimitMiddleware(...)`. */
export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyResolver?: (ctx: MiddlewareContext) => string;
  store?: RateLimitStore;
  /**
   * Broad legacy compatibility mode for forwarding headers.
   *
   * This trusts the complete `Forwarded`, `X-Forwarded-For`, or `X-Real-IP`
   * chain and is not limited to the direct peer. Use `trustProxy` instead for
   * new deployments with a known proxy boundary.
   */
  trustProxyHeaders?: boolean;
  /**
   * Explicit proxy boundary used for default client identity resolution.
   *
   * @remarks
   * Prefer this policy over the broad legacy `trustProxyHeaders` mode.
   */
  trustProxy?: TrustProxyPolicy;
  /**
   * Live-key capacity of the default memory store created when `store` is omitted.
   *
   * @remarks
   * Defaults to 5,000. See {@link MemoryRateLimitStoreOptions.maxKeys}. Combining it with
   * `store` throws; configure a custom memory store with `createMemoryRateLimitStore({ maxKeys })`.
   */
  maxKeys?: number;
}

/** Configuration for `createMemoryRateLimitStore(...)`. */
export interface MemoryRateLimitStoreOptions {
  /**
   * Maximum number of live keys tracked at once.
   *
   * @remarks
   * Defaults to 5,000. Must be a positive safe integer, or `Number.POSITIVE_INFINITY` to opt out of the bound.
   * At capacity, a new key is rejected rather than evicting an active counter; existing keys keep counting.
   */
  maxKeys?: number;
}

const DEFAULT_MEMORY_RATE_LIMIT_MAX_KEYS = 5_000;

function resolveMaxKeys(maxKeys: number | undefined): number {
  if (maxKeys === undefined) {
    return DEFAULT_MEMORY_RATE_LIMIT_MAX_KEYS;
  }

  if (maxKeys === Number.POSITIVE_INFINITY || (Number.isSafeInteger(maxKeys) && maxKeys > 0)) {
    return maxKeys;
  }

  throw new RangeError('Rate-limit maxKeys must be a positive safe integer or Number.POSITIVE_INFINITY.');
}

function defaultKeyResolver(ctx: MiddlewareContext, options: RateLimitOptions): string {
  return resolveClientIdentity(ctx.request, {
    trustProxy: options.trustProxy,
    trustProxyHeaders: options.trustProxyHeaders ?? false,
  });
}

/**
 * Create the built-in in-memory store for request rate-limit windows.
 *
 * @param options Optional live-key capacity; defaults to 5,000 keys.
 * @returns Store instance that tracks request counts in process memory.
 * @remarks
 * When `maxKeys` live keys exist after sweeping expired entries, `consume` for a new key stores nothing and
 * returns `{ count: Number.POSITIVE_INFINITY, resetAt }` with the earliest live deadline, so middleware answers
 * 429 with `Retry-After` until capacity frees. `set` of a new key at capacity throws a `RangeError`.
 * @throws {RangeError} When `maxKeys` is not a positive safe integer or `Number.POSITIVE_INFINITY`.
 */
export function createMemoryRateLimitStore(options: MemoryRateLimitStoreOptions = {}): RateLimitStore {
  const maxKeys = resolveMaxKeys(options.maxKeys);
  const map = new Map<string, RateLimitStoreEntry>();
  // Lower bound of every stored deadline; sweeping is skipped until it passes.
  let nextSweepAt = Number.POSITIVE_INFINITY;

  function store(key: string, entry: RateLimitStoreEntry): void {
    map.set(key, entry);
    nextSweepAt = Math.min(nextSweepAt, entry.resetAt);
  }

  function sweep(now: number): void {
    if (now < nextSweepAt) {
      return;
    }

    let next = Number.POSITIVE_INFINITY;

    for (const [key, entry] of map) {
      if (now >= entry.resetAt) {
        map.delete(key);
        continue;
      }

      next = Math.min(next, entry.resetAt);
    }

    nextSweepAt = next;
  }

  return {
    consume(key, { now, windowMs }) {
      const entry = map.get(key);

      if (!entry && map.size >= maxKeys) {
        sweep(now);

        if (map.size >= maxKeys) {
          return { count: Number.POSITIVE_INFINITY, resetAt: nextSweepAt };
        }
      }

      const current = !entry || now >= entry.resetAt
        ? { count: 1, resetAt: now + windowMs }
        : { count: entry.count + 1, resetAt: entry.resetAt };

      store(key, current);
      return { ...current };
    },
    get(key) {
      return map.get(key);
    },
    set(key, entry) {
      if (!map.has(key) && map.size >= maxKeys) {
        throw new RangeError(`Rate-limit memory store reached its maxKeys capacity of ${maxKeys} live keys.`);
      }

      store(key, entry);
    },
    increment(key) {
      const entry = map.get(key);

      if (!entry) {
        return 0;
      }

      entry.count++;
      return entry.count;
    },
    evict(now) {
      sweep(now);
    },
  };
}

/**
 * Create middleware that rejects requests once a per-key window exceeds its limit.
 *
 * @param options Limit, window, trust, and storage settings for one middleware instance.
 * @returns Middleware that enforces the configured request budget.
 * @throws {TypeError} When `maxKeys` is combined with a custom `store`.
 * @throws {RangeError} When `maxKeys` is invalid.
 */
export function createRateLimitMiddleware(options: RateLimitOptions): Middleware {
  if (options.store && options.maxKeys !== undefined) {
    throw new TypeError(
      'Rate-limit maxKeys configures only the default memory store; pass createMemoryRateLimitStore({ maxKeys }) as store instead.',
    );
  }

  const store = options.store ?? createMemoryRateLimitStore({ maxKeys: options.maxKeys });

  return {
    async handle(context, next) {
      const key = options.keyResolver ? options.keyResolver(context) : defaultKeyResolver(context, options);

      const now = Date.now();

      await store.evict(now);

      let current: RateLimitStoreEntry;
      if (store.consume) {
        current = await store.consume(key, { now, windowMs: options.windowMs });
      } else {
        const entry = await store.get(key);
        if (!entry || now >= entry.resetAt) {
          current = { count: 1, resetAt: now + options.windowMs };
          await store.set(key, current);
        } else {
          current = { count: await store.increment(key), resetAt: entry.resetAt };
        }
      }

      if (current.count > options.limit) {
        const retryAfter = Math.ceil((current.resetAt - now) / 1000);
        const error = new TooManyRequestsException('Too Many Requests', {
          meta: { retryAfter },
        });

        context.response.setHeader('Retry-After', String(retryAfter));
        context.response.setStatus(429);
        await context.response.send(createErrorResponse(error, context.requestContext.requestId));
        return;
      }

      return next();
    },
  };
}
