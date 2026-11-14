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

describe('rate-limit memory store key capacity', () => {
  const DEFAULT_MAX_KEYS = 5_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function clientKeyResolver(ctx: MiddlewareContext): string {
    return String((ctx.request.headers as Record<string, string>)['x-client-id']);
  }

  function clientContext(id: string) {
    return createContext({ headers: { 'x-client-id': id } });
  }

  it('bounds 10,000 client-controlled keys in the default store and rejects overflow with 429', async () => {
    const middleware = createRateLimitMiddleware({ keyResolver: clientKeyResolver, limit: 1, windowMs: 60_000 });
    const next = vi.fn(async () => {});
    const contexts = Array.from({ length: 10_000 }, (_, index) => clientContext(`client-${index}`));

    for (const context of contexts) {
      await middleware.handle(context, next);
    }

    expect(next).toHaveBeenCalledTimes(DEFAULT_MAX_KEYS);
    const rejected = contexts.slice(DEFAULT_MAX_KEYS);
    expect(rejected.every((context) => context.response.statusCode === 429)).toBe(true);
    expect(rejected.every((context) => context.response.headers['Retry-After'] === '60')).toBe(true);
    expect(rejected[0]?.response.send).toHaveBeenCalledWith({
      error: {
        code: 'TOO_MANY_REQUESTS',
        details: undefined,
        message: 'Too Many Requests',
        meta: { retryAfter: 60 },
        requestId: undefined,
        status: 429,
      },
    });
  });

  it('keeps active counters instead of evicting them for new keys', async () => {
    const middleware = createRateLimitMiddleware({ keyResolver: clientKeyResolver, limit: 2, maxKeys: 2, windowMs: 60_000 });
    const next = vi.fn(async () => {});

    await middleware.handle(clientContext('a'), next);
    await middleware.handle(clientContext('b'), next);
    const overflow = clientContext('c');
    await middleware.handle(overflow, next);
    const admittedAgain = clientContext('a');
    await middleware.handle(admittedAgain, next);
    const exhausted = clientContext('a');
    await middleware.handle(exhausted, next);

    expect(overflow.response.statusCode).toBe(429);
    expect(admittedAgain.response.statusCode).toBe(200);
    expect(exhausted.response.statusCode).toBe(429);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('admits new keys after expired entries free capacity and reports the earliest live deadline', async () => {
    const middleware = createRateLimitMiddleware({ keyResolver: clientKeyResolver, limit: 1, maxKeys: 2, windowMs: 60_000 });
    const next = vi.fn(async () => {});

    await middleware.handle(clientContext('a'), next);
    vi.advanceTimersByTime(30_000);
    await middleware.handle(clientContext('b'), next);
    vi.advanceTimersByTime(10_000);
    const overflow = clientContext('c');
    await middleware.handle(overflow, next);
    vi.advanceTimersByTime(20_000);
    const afterExpiry = clientContext('c');
    await middleware.handle(afterExpiry, next);
    const stillFull = clientContext('d');
    await middleware.handle(stillFull, next);

    expect(overflow.response.statusCode).toBe(429);
    expect(overflow.response.headers['Retry-After']).toBe('20');
    expect(afterExpiry.response.statusCode).toBe(200);
    expect(stillFull.response.statusCode).toBe(429);
    expect(stillFull.response.headers['Retry-After']).toBe('30');
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('admits exactly maxKeys distinct keys from one concurrent burst', async () => {
    const middleware = createRateLimitMiddleware({ keyResolver: clientKeyResolver, limit: 1, maxKeys: 3, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const contexts = Array.from({ length: 20 }, (_, index) => clientContext(`burst-${index}`));

    await Promise.all(contexts.map((context) => middleware.handle(context, next)));

    expect(next).toHaveBeenCalledTimes(3);
    expect(contexts.filter((context) => context.response.statusCode === 429)).toHaveLength(17);
  });

  it('returns a non-admitting snapshot for a new key at capacity without storing it', () => {
    const store = createMemoryRateLimitStore({ maxKeys: 2 });
    const now = Date.now();

    store.consume?.('a', { now, windowMs: 1_000 });
    store.consume?.('b', { now: now + 200, windowMs: 1_000 });

    expect(store.consume?.('c', { now: now + 500, windowMs: 1_000 })).toEqual({
      count: Number.POSITIVE_INFINITY, resetAt: now + 1_000,
    });
    expect(store.get('c')).toBeUndefined();
    expect(store.consume?.('a', { now: now + 500, windowMs: 1_000 })).toEqual({ count: 2, resetAt: now + 1_000 });
    expect(store.consume?.('a', { now: now + 1_000, windowMs: 1_000 })).toEqual({ count: 1, resetAt: now + 2_000 });
  });

  it('sweeps short-window entries inserted after longer windows when capacity is reached', () => {
    const store = createMemoryRateLimitStore({ maxKeys: 2 });
    const now = Date.now();

    store.consume?.('long', { now, windowMs: 60_000 });
    store.consume?.('short', { now, windowMs: 1_000 });

    expect(store.consume?.('next', { now: now + 1_000, windowMs: 1_000 })).toEqual({ count: 1, resetAt: now + 2_000 });
    expect(store.get('short')).toBeUndefined();
    expect(store.get('long')).toEqual({ count: 1, resetAt: now + 60_000 });
  });

  it('allows an explicit unbounded opt-out with Number.POSITIVE_INFINITY', async () => {
    const middleware = createRateLimitMiddleware({
      keyResolver: clientKeyResolver,
      limit: 1,
      maxKeys: Number.POSITIVE_INFINITY,
      windowMs: 60_000,
    });
    const next = vi.fn(async () => {});

    for (let index = 0; index <= DEFAULT_MAX_KEYS; index++) {
      await middleware.handle(clientContext(`client-${index}`), next);
    }

    expect(next).toHaveBeenCalledTimes(DEFAULT_MAX_KEYS + 1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '10' as unknown as number])(
    'rejects invalid maxKeys %s',
    (maxKeys) => {
      expect(() => createMemoryRateLimitStore({ maxKeys })).toThrow(RangeError);
      expect(() => createRateLimitMiddleware({ limit: 1, maxKeys, windowMs: 1_000 })).toThrow(RangeError);
    },
  );

  it('rejects maxKeys combined with a custom store instead of ignoring it', () => {
    expect(() => createRateLimitMiddleware({
      limit: 1,
      maxKeys: 10,
      store: createMemoryRateLimitStore(),
      windowMs: 1_000,
    })).toThrow(TypeError);
  });

  it('fails closed when a legacy wrapper sets a new key at capacity', async () => {
    const memory = createMemoryRateLimitStore({ maxKeys: 1 });
    const store: RateLimitStore = {
      get: (key) => memory.get(key),
      set: (key, entry) => memory.set(key, entry),
      increment: (key) => memory.increment(key),
      evict: (now) => memory.evict(now),
    };
    const middleware = createRateLimitMiddleware({ keyResolver: clientKeyResolver, limit: 1, store, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const overflow = clientContext('b');

    await middleware.handle(clientContext('a'), next);
    await expect(middleware.handle(overflow, next)).rejects.toThrow(RangeError);
    expect(overflow.response.send).not.toHaveBeenCalled();
    memory.set('a', { count: 5, resetAt: Date.now() + 1_000 });
    expect(memory.get('a')).toEqual({ count: 5, resetAt: Date.now() + 1_000 });

    vi.advanceTimersByTime(1_000);
    await middleware.handle(clientContext('b'), next);

    expect(next).toHaveBeenCalledTimes(2);
  });
});
