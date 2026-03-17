import type { MiddlewareContext, Middleware } from './types.js';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyResolver?: (ctx: MiddlewareContext) => string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

function defaultKeyResolver(ctx: MiddlewareContext): string {
  const raw = ctx.request.raw as { socket?: { remoteAddress?: string } } | undefined;
  return raw?.socket?.remoteAddress ?? 'unknown';
}

function evictExpiredEntries(store: Map<string, WindowEntry>, now: number): number {
  let nextResetAt = Number.POSITIVE_INFINITY;

  for (const [key, entry] of store) {
    if (now >= entry.resetAt) {
      store.delete(key);
      continue;
    }

    nextResetAt = Math.min(nextResetAt, entry.resetAt);
  }

  return nextResetAt;
}

export function createRateLimitMiddleware(options: RateLimitOptions): Middleware {
  const store = new Map<string, WindowEntry>();
  let nextSweepAt = 0;

  return {
    async handle(context, next) {
      const key = options.keyResolver
        ? options.keyResolver(context)
        : defaultKeyResolver(context);

      const now = Date.now();

      if (now >= nextSweepAt) {
        nextSweepAt = evictExpiredEntries(store, now);
      }

      const entry = store.get(key);

      if (!entry || now >= entry.resetAt) {
        const resetAt = now + options.windowMs;

        store.set(key, { count: 1, resetAt });
        nextSweepAt = Math.min(nextSweepAt, resetAt);
        return next();
      }

      if (entry.count >= options.limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

        context.response.setHeader('Retry-After', String(retryAfter));
        context.response.setStatus(429);
        await context.response.send({ message: 'Too Many Requests' });
        return;
      }

      entry.count++;
      return next();
    },
  };
}
