import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRateLimitMiddleware } from './rate-limit.js';
import type { MiddlewareContext } from './types.js';

function createContext(remoteAddress = '127.0.0.1') {
  const response = {
    committed: false,
    headers: {} as Record<string, string>,
    redirect() {},
    send: vi.fn(async function send(this: { committed: boolean }, _body: unknown) {
      this.committed = true;
    }),
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
    },
    statusCode: 200,
  };

  return {
    request: {
      raw: {
        socket: {
          remoteAddress,
        },
      },
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
    expect(context.response.send).toHaveBeenCalledWith({ message: 'Too Many Requests' });
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
});
