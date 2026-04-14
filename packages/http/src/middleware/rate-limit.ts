import type { MiddlewareContext, Middleware } from '../types.js';
import { TooManyRequestsException, createErrorResponse } from '../exceptions.js';
import { resolveClientIdentity } from '../client-identity.js';

/** Snapshot of one key's current rate-limit window state. */
export interface RateLimitStoreEntry {
  count: number;
  resetAt: number;
}

/** Store contract used by `createRateLimitMiddleware(...)` request windows. */
export interface RateLimitStore {
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
   * Trust `Forwarded`, `X-Forwarded-For`, and `X-Real-IP` before the raw socket address.
   * Enable this only when the adapter sits behind a trusted proxy that overwrites spoofable headers.
   */
  trustProxyHeaders?: boolean;
}

function defaultKeyResolver(ctx: MiddlewareContext, options: RateLimitOptions): string {
  return resolveClientIdentity(ctx.request, {
    trustProxyHeaders: options.trustProxyHeaders ?? false,
  });
}

/**
 * Create the built-in in-memory store for request rate-limit windows.
 *
 * @returns Store instance that tracks request counts in process memory.
 */
export function createMemoryRateLimitStore(): RateLimitStore {
  const map = new Map<string, RateLimitStoreEntry>();
  let nextSweepAt = 0;

  return {
    get(key) {
      return map.get(key);
    },
    set(key, entry) {
      map.set(key, entry);
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

      nextSweepAt = Number.isFinite(next) ? next : 0;
    },
  };
}

/**
 * Create middleware that rejects requests once a per-key window exceeds its limit.
 *
 * @param options Limit, window, trust, and storage settings for one middleware instance.
 * @returns Middleware that enforces the configured request budget.
 */
export function createRateLimitMiddleware(options: RateLimitOptions): Middleware {
  const store = options.store ?? createMemoryRateLimitStore();

  return {
    async handle(context, next) {
      const key = options.keyResolver ? options.keyResolver(context) : defaultKeyResolver(context, options);

      const now = Date.now();

      await store.evict(now);

      const entry = await store.get(key);

      if (!entry || now >= entry.resetAt) {
        const resetAt = now + options.windowMs;

        await store.set(key, { count: 1, resetAt });

        if (1 > options.limit) {
          const retryAfter = Math.ceil(options.windowMs / 1000);
          const error = new TooManyRequestsException('Too Many Requests', {
            meta: { retryAfter },
          });

          context.response.setHeader('Retry-After', String(retryAfter));
          context.response.setStatus(429);
          await context.response.send(createErrorResponse(error, context.requestContext.requestId));
          return;
        }

        return next();
      }

      const count = await store.increment(key);

      if (count > options.limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
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
