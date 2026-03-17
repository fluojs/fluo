import { describe, expect, it } from 'vitest';
import { Container } from '@konekti/di';

import type { FrameworkResponse, Middleware, MiddlewareContext, MiddlewareLike, Next } from './types.js';
import { forRoutes, isMiddlewareRouteConfig, runMiddlewareChain } from './middleware.js';

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(_status: number, _location: string) {},
    send(_body: unknown) {},
    setHeader(_name: string, _value: string) {},
    setStatus(_code: number) {},
  };
}

describe('isMiddlewareRouteConfig', () => {
  it('returns true for a MiddlewareRouteConfig object', () => {
    class SomeMW { async handle() {} }
    const config: MiddlewareLike = { middleware: SomeMW, routes: ['/users'] };
    expect(isMiddlewareRouteConfig(config)).toBe(true);
  });

  it('returns false for a plain middleware object (handle method)', () => {
    const mw: MiddlewareLike = { handle: async () => {} } as any;
    expect(isMiddlewareRouteConfig(mw)).toBe(false);
  });

  it('returns false for a string token', () => {
    const token: MiddlewareLike = 'LoggingMiddleware' as any;
    expect(isMiddlewareRouteConfig(token)).toBe(false);
  });

  it('returns false for a constructor/class token', () => {
    class SomeMW { async handle() {} }
    const token: MiddlewareLike = SomeMW as any;
    expect(isMiddlewareRouteConfig(token)).toBe(false);
  });

  it('returns true for empty routes array', () => {
    class SomeMW { async handle() {} }
    const config: MiddlewareLike = { middleware: SomeMW, routes: [] };
    expect(isMiddlewareRouteConfig(config)).toBe(true);
  });
});

describe('forRoutes', () => {
  it('creates a config with one route', () => {
    class SomeMW implements Middleware {
      async handle(_context: MiddlewareContext, _next: Next) {}
    }

    expect(forRoutes(SomeMW, '/users')).toEqual({ middleware: SomeMW, routes: ['/users'] });
  });

  it('creates a config with empty routes when omitted', () => {
    class SomeMW implements Middleware {
      async handle(_context: MiddlewareContext, _next: Next) {}
    }

    expect(forRoutes(SomeMW)).toEqual({ middleware: SomeMW, routes: [] });
  });

  it('creates a config with multiple routes', () => {
    class SomeMW implements Middleware {
      async handle(_context: MiddlewareContext, _next: Next) {}
    }

    expect(forRoutes(SomeMW, '/a', '/b')).toEqual({ middleware: SomeMW, routes: ['/a', '/b'] });
  });
});

describe('matchRoute behavior via runMiddlewareChain', () => {
  it('normalizes trailing slashes for exact matching', async () => {
    const events: string[] = [];

    class SomeMW implements Middleware {
      async handle(_context: MiddlewareContext, next: Next) {
        events.push('mw');
        await next();
      }
    }

    const container = new Container();
    container.register(SomeMW);

    const context = {
      request: { path: '/users/' },
      requestContext: { container },
      response: createResponse(),
    } as unknown as MiddlewareContext;

    await runMiddlewareChain([forRoutes(SomeMW, '/users')], context, async () => {
      events.push('terminal');
    });

    expect(events).toEqual(['mw', 'terminal']);
  });

  it('matches wildcard routes for nested paths', async () => {
    const events: string[] = [];

    class SomeMW implements Middleware {
      async handle(_context: MiddlewareContext, next: Next) {
        events.push('mw');
        await next();
      }
    }

    const container = new Container();
    container.register(SomeMW);

    const context = {
      request: { path: '/cats/123/posts' },
      requestContext: { container },
      response: createResponse(),
    } as unknown as MiddlewareContext;

    await runMiddlewareChain([forRoutes(SomeMW, '/cats/*')], context, async () => {
      events.push('terminal');
    });

    expect(events).toEqual(['mw', 'terminal']);
  });

  it('skips middleware when route does not match', async () => {
    const events: string[] = [];

    class SomeMW implements Middleware {
      async handle(_context: MiddlewareContext, next: Next) {
        events.push('mw');
        await next();
      }
    }

    const container = new Container();
    container.register(SomeMW);

    const context = {
      request: { path: '/dogs' },
      requestContext: { container },
      response: createResponse(),
    } as unknown as MiddlewareContext;

    await runMiddlewareChain([forRoutes(SomeMW, '/cats/*')], context, async () => {
      events.push('terminal');
    });

    expect(events).toEqual(['terminal']);
  });
});
