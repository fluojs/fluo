import type { MiddlewareContext, Middleware } from './types.js';
import { TooManyRequestsException, createErrorResponse } from './exceptions.js';

export interface RateLimitStoreEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  get(key: string): RateLimitStoreEntry | undefined | Promise<RateLimitStoreEntry | undefined>;
  set(key: string, entry: RateLimitStoreEntry): void | Promise<void>;
  increment(key: string): number | Promise<number>;
  evict(now: number): void | Promise<void>;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyResolver?: (ctx: MiddlewareContext) => string;
  store?: RateLimitStore;
}

function defaultKeyResolver(ctx: MiddlewareContext): string {
  const raw = ctx.request.raw as { socket?: { remoteAddress?: string } } | undefined;
  return raw?.socket?.remoteAddress ?? 'unknown';
}

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

      nextSweepAt = next;
    },
  };
}

export function createRateLimitMiddleware(options: RateLimitOptions): Middleware {
  const store = options.store ?? createMemoryRateLimitStore();

  return {
    async handle(context, next) {
      const key = options.keyResolver
        ? options.keyResolver(context)
        : defaultKeyResolver(context);

      const now = Date.now();

      await store.evict(now);

      const entry = await store.get(key);

      if (!entry || now >= entry.resetAt) {
        const resetAt = now + options.windowMs;

        await store.set(key, { count: 1, resetAt });
        return next();
      }

      if (entry.count >= options.limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        const error = new TooManyRequestsException('Too Many Requests', {
          meta: { retryAfter },
        });

        context.response.setHeader('Retry-After', String(retryAfter));
        context.response.setStatus(429);
        await context.response.send(createErrorResponse(error, context.requestContext.requestId));
        return;
      }

      await store.increment(key);
      return next();
    },
  };
}
