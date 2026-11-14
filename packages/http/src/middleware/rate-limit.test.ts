import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareContext } from '../types.js';
import type { RateLimitStore } from './rate-limit.js';
import { createMemoryRateLimitStore, createRateLimitMiddleware } from './rate-limit.js';

function createContext(
  options:
    | string
    | {
        headers?: Record<string, string | string[]>;
        raw?: unknown;
      } = '127.0.0.1',
) {
  const headers = typeof options === 'string' ? {} : (options.headers ?? {});
  const raw =
    typeof options === 'string'
      ? {
          socket: {
            remoteAddress: options,
          },
        }
      : (options.raw ?? {
          socket: {
            remoteAddress: '127.0.0.1',
          },
        });
  const response = {
    committed: false,
    headers: {} as Record<string, string | string[]>,
    redirect() {},
    send: vi.fn(async function send(this: { committed: boolean }, _body: unknown) {
      this.committed = true;
    }),
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
    },
    statusCode: 200,
  };

  return {
    request: {
      headers,
      raw,
    },
    requestContext: {},
    response,
  } as unknown as MiddlewareContext & { response: typeof response };
}

describe('createRateLimitMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([undefined, 60_000, 60_001])('enforces one allowance for a concurrent burst at window offset %s', async (offset) => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 60_000 });
    if (offset !== undefined) {
      await middleware.handle(createContext(), async () => {});
      vi.advanceTimersByTime(offset);
    }
    const contexts = Array.from({ length: 20 }, (_, index) => {
      const context = createContext();
      context.requestContext.requestId = `request-${index}`;
      return context;
    });
    const next = vi.fn(async () => {});

    await Promise.all(contexts.map((context) => middleware.handle(context, next)));

    expect(next).toHaveBeenCalledTimes(1);
    expect(contexts.filter((context) => context.response.statusCode === 429)).toHaveLength(19);
    for (const context of contexts.filter((context) => context.response.statusCode === 429)) {
      expect(context.response.headers['Retry-After']).toBe('60');
      expect(context.response.send).toHaveBeenCalledWith({
        error: {
          code: 'TOO_MANY_REQUESTS',
          details: undefined,
          message: 'Too Many Requests',
          meta: { retryAfter: 60 },
          requestId: context.requestContext.requestId,
          status: 429,
        },
      });
    }
  });

  it('returns 429 with Retry-After after the limit is exceeded', async () => {
    const middleware = createRateLimitMiddleware({ limit: 2, windowMs: 1_000 });
    const context = createContext();
    const next = vi.fn(async () => {});

    await middleware.handle(context, next);
    await middleware.handle(context, next);
    await middleware.handle(context, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(context.response.statusCode).toBe(429);
    expect(context.response.headers['Retry-After']).toBe('1');
    expect(context.response.send).toHaveBeenCalledWith({
      error: {
        code: 'TOO_MANY_REQUESTS',
        details: undefined,
        message: 'Too Many Requests',
        meta: { retryAfter: 1 },
        requestId: undefined,
        status: 429,
      },
    });
  });

  it('resets the counter after the window expires', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const context = createContext();
    const next = vi.fn(async () => {});

    await middleware.handle(context, next);
    await middleware.handle(context, next);

    vi.advanceTimersByTime(1_001);

    await middleware.handle(context, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps separate counters for separate keys', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const firstContext = createContext('127.0.0.1');
    const secondContext = createContext('127.0.0.2');
    const next = vi.fn(async () => {});

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(firstContext.response.statusCode).toBe(200);
    expect(secondContext.response.statusCode).toBe(200);
  });

  it('accepts a custom keyResolver', async () => {
    const middleware = createRateLimitMiddleware({
      keyResolver: (ctx) => String((ctx.request as unknown as { headers: Record<string, string> }).headers['x-api-key'] ?? 'anon'),
      limit: 1,
      windowMs: 1_000,
    });
    const contextA = createContext('127.0.0.1');
    (contextA.request as unknown as { headers: Record<string, string> }).headers = { 'x-api-key': 'key-a' };
    const contextB = createContext('127.0.0.1');
    (contextB.request as unknown as { headers: Record<string, string> }).headers = { 'x-api-key': 'key-b' };
    const next = vi.fn(async () => {});

    await middleware.handle(contextA, next);
    await middleware.handle(contextB, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('uses raw socket identity by default even when proxy headers are present', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.10, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.11, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(secondContext.response.statusCode).toBe(429);
  });

  it('trusts forwarded headers when trustProxyHeaders is enabled', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxyHeaders: true, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.10, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.11, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(secondContext.response.statusCode).toBe(200);
  });

  it('uses the configured trusted proxy boundary for client buckets', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxy: 1, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.11' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(secondContext.response.statusCode).toBe(200);
  });

  it('uses X-Real-IP client buckets when trustProxyHeaders is enabled', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxyHeaders: true, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { 'x-real-ip': '198.51.100.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { 'x-real-ip': '198.51.100.11' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);
    await middleware.handle(firstContext, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(firstContext.response.statusCode).toBe(429);
    expect(secondContext.response.statusCode).toBe(200);
  });

  it('normalizes ipv4 forwarded identities that include client ports when trustProxyHeaders is enabled', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxyHeaders: true, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { forwarded: 'for=198.51.100.10:1234;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { forwarded: 'for=198.51.100.10:5678;proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(secondContext.response.statusCode).toBe(429);
  });

  it('normalizes bracketed ipv6 forwarded identities that include client ports when trustProxyHeaders is enabled', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxyHeaders: true, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { forwarded: 'for="[2001:db8::1]:1234";proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { forwarded: 'for="[2001:db8::1]:5678";proto=https' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(secondContext.response.statusCode).toBe(429);
  });

  it('normalizes comma-separated proxy identities when the first hop includes a port and trustProxyHeaders is enabled', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxyHeaders: true, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const firstContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.10:1234, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });
    const secondContext = createContext({
      headers: { 'x-forwarded-for': '198.51.100.10:5678, 10.0.0.10' },
      raw: { socket: { remoteAddress: '10.0.0.1' } },
    });

    await middleware.handle(firstContext, next);
    await middleware.handle(secondContext, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(secondContext.response.statusCode).toBe(429);
  });

  it('accepts proxied requests when trustProxyHeaders is enabled and the raw socket address is unavailable', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, trustProxyHeaders: true, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const context = createContext({
      headers: { forwarded: 'for="[2001:db8:cafe::17]";proto=https' },
      raw: {},
    });

    await middleware.handle(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.response.statusCode).toBe(200);
  });

  it('rejects spoofable proxy headers by default when the raw socket address is unavailable', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const context = createContext({
      headers: { 'x-forwarded-for': '198.51.100.10, 10.0.0.10' },
      raw: {},
    });

    await expect(middleware.handle(context, next)).rejects.toThrow(/trusted request transport/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws when no proxy or socket client identity is available', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const context = createContext({ headers: {}, raw: {} });

    await expect(middleware.handle(context, next)).rejects.toThrow(/trusted request transport/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a custom store implementation', async () => {
    const entries = new Map<string, { count: number; resetAt: number }>();
    const customStore = {
      evict: vi.fn(),
      get: vi.fn((key: string) => entries.get(key)),
      increment: vi.fn((key: string) => {
        const entry = entries.get(key);

        if (!entry) {
          return 0;
        }

        entry.count++;
        return entry.count;
      }),
      set: vi.fn((key: string, entry: { count: number; resetAt: number }) => {
        entries.set(key, entry);
      }),
    };
    const middleware = createRateLimitMiddleware({ limit: 1, store: customStore, windowMs: 1_000 });
    const context = createContext();
    const next = vi.fn(async () => {});

    await middleware.handle(context, next);
    await middleware.handle(context, next);

    expect(customStore.get).toHaveBeenCalled();
    expect(customStore.set).toHaveBeenCalled();
    expect(customStore.evict).toHaveBeenCalled();
    expect(context.response.statusCode).toBe(429);
  });

  it('keeps legacy async store operations executable across resets', async () => {
    const memory = createMemoryRateLimitStore();
    const store: RateLimitStore = {
      get: async (key) => memory.get(key),
      set: async (key, entry) => memory.set(key, entry),
      increment: async (key) => memory.increment(key),
      evict: async (now) => memory.evict(now),
    };
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000, store });
    const next = vi.fn(async () => {});
    const rejected = createContext();

    await middleware.handle(createContext(), next);
    vi.advanceTimersByTime(500);
    await middleware.handle(rejected, next);
    expect(await store.get('127.0.0.1')).toEqual({ count: 2, resetAt: Date.now() + 500 });
    vi.advanceTimersByTime(500);
    await middleware.handle(createContext(), next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(rejected.response.headers['Retry-After']).toBe('1');
    expect(await store.increment('127.0.0.1')).toBe(2);
  });

  it.each([false, true])('uses custom atomic consumption with async=%s and no legacy reads or writes', async (asyncStore) => {
    const memory = createMemoryRateLimitStore();
    const consume = vi.fn((key: string, options: { now: number; windowMs: number }) => {
      const entry = memory.consume?.(key, options);
      if (!entry) {
        throw new Error('Missing memory consumption capability');
      }
      return asyncStore ? Promise.resolve(entry) : entry;
    });
    const store: RateLimitStore = {
      ...memory,
      consume,
      get: vi.fn(() => { throw new Error('Unexpected get'); }),
      set: vi.fn(() => { throw new Error('Unexpected set'); }),
      increment: vi.fn(() => { throw new Error('Unexpected increment'); }),
    };
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 60_000, store });
    const next = vi.fn(async () => {});
    const contexts = Array.from({ length: 20 }, () => createContext());

    await Promise.all(contexts.map((context) => middleware.handle(context, next)));

    expect(next).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(20);
    expect(consume).toHaveBeenCalledWith('127.0.0.1', { now: Date.now(), windowMs: 60_000 });
    expect(contexts.filter((context) => context.response.statusCode === 429)).toHaveLength(19);
  });

  it('propagates atomic store failures without turning them into 429 responses', async () => {
    const failure = new Error('Store unavailable');
    const store: RateLimitStore = {
      ...createMemoryRateLimitStore(),
      consume: async () => { throw failure; },
    };
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000, store });
    const context = createContext();
    const next = vi.fn(async () => {});

    await expect(middleware.handle(context, next)).rejects.toBe(failure);

    expect(next).not.toHaveBeenCalled();
    expect(context.response.send).not.toHaveBeenCalled();
    expect(context.response.headers['Retry-After']).toBeUndefined();
  });

  it('returns independent atomic snapshots and counts every ongoing-window request without extending the deadline', async () => {
    const store = createMemoryRateLimitStore();
    const now = Date.now();
    const first = await store.consume?.('client', { now, windowMs: 1_000 });

    const burst = await Promise.all(Array.from({ length: 20 }, () =>
      store.consume?.('client', { now: now + 500, windowMs: 1_000 })));

    expect(first).toEqual({ count: 1, resetAt: now + 1_000 });
    expect(burst.map((entry) => entry?.count)).toEqual(Array.from({ length: 20 }, (_, index) => index + 2));
    expect(burst.every((entry) => entry?.resetAt === now + 1_000)).toBe(true);
    expect(await store.consume?.('other', { now: now + 500, windowMs: 1_000 })).toEqual({
      count: 1, resetAt: now + 1_500,
    });
    expect(await store.consume?.('client', { now: now + 1_000, windowMs: 1_000 })).toEqual({
      count: 1, resetAt: now + 2_000,
    });
    await store.evict(now + 2_000);
    expect(await store.get('client')).toBeUndefined();
  });

  it('uses an independent in-process store per middleware instance', async () => {
    const first = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const second = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const context = createContext();
    const next = vi.fn(async () => {});

    await first.handle(context, next);
    await first.handle(context, next);

    expect(context.response.statusCode).toBe(429);

    context.response.statusCode = 200;
    context.response.committed = false;

    await second.handle(context, next);

    expect(context.response.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('keeps eviction active after an initial empty sweep', async () => {
    const store = createMemoryRateLimitStore();
    const now = Date.now();

    await store.evict(now);
    await store.set('client-1', {
      count: 1,
      resetAt: now - 1,
    });

    await store.evict(now + 1);

    expect(store.get('client-1')).toBeUndefined();
  });
});
