import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryRateLimitStore, createRateLimitMiddleware } from './rate-limit.js';
import type { MiddlewareContext } from '../types.js';

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

  it('uses forwarded headers before the proxy socket address', async () => {
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

    expect(next).toHaveBeenCalledTimes(2);
    expect(firstContext.response.statusCode).toBe(200);
    expect(secondContext.response.statusCode).toBe(200);
  });

  it('normalizes ipv4 forwarded identities that include client ports', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
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

  it('normalizes bracketed ipv6 forwarded identities that include client ports', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
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

  it('normalizes comma-separated proxy identities when the first hop includes a port', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
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

  it('accepts proxied requests when the raw socket address is unavailable', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const context = createContext({
      headers: { forwarded: 'for="[2001:db8:cafe::17]";proto=https' },
      raw: {},
    });

    await middleware.handle(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.response.statusCode).toBe(200);
  });

  it('throws when no proxy or socket client identity is available', async () => {
    const middleware = createRateLimitMiddleware({ limit: 1, windowMs: 1_000 });
    const next = vi.fn(async () => {});
    const context = createContext({ headers: {}, raw: {} });

    await expect(middleware.handle(context, next)).rejects.toThrow(/resolve client identity/i);
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
