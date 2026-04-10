import { describe, expect, it } from 'vitest';

import type { Middleware } from '@fluojs/http';

import { defineModule } from './bootstrap.js';
import { createHttpAdapterMiddleware, runHttpAdapterApplication } from './http-adapter-shared.js';
import type { ApplicationLogger } from './types.js';

type TestContext = {
  request: {
    headers: Record<string, string | string[] | undefined>;
    method: string;
    path: string;
    url: string;
  };
  requestContext: {
    requestId?: string;
  };
  response: {
    committed: boolean;
    headers: Record<string, string | string[] | undefined>;
    payload?: unknown;
    setHeader: (name: string, value: string | string[]) => void;
    setStatus: (code: number) => void;
    send: (body: unknown) => Promise<void>;
    statusCode?: number;
  };
};

function createTestContext(path: string, url: string = path, method = 'GET'): TestContext {
  const headers: Record<string, string | string[] | undefined> = {};

  return {
    request: {
      headers: {
        origin: 'https://client.test',
      },
      method,
      path,
      url,
    },
    requestContext: {
      requestId: 'req-1',
    },
    response: {
      committed: false,
      headers,
      setHeader(name: string, value: string | string[]) {
        headers[name] = value;
      },
      setStatus(code: number) {
        this.statusCode = code;
      },
      async send(body: unknown) {
        this.committed = true;
        this.payload = body;
      },
      statusCode: undefined,
    },
  };
}

async function runMiddlewareChain(
  context: TestContext,
  onTerminal: (context: TestContext) => Promise<void> | void = async () => {},
): Promise<void> {
  const middleware = createHttpAdapterMiddleware({
    cors: ['https://client.test'],
    globalPrefix: '/api',
    globalPrefixExclude: ['/health'],
    middleware: [{
      async handle(innerContext: unknown, next: () => Promise<void>) {
        await onTerminal(innerContext as TestContext);
        await next();
      },
    }],
  });

  const dispatch = async (index: number): Promise<void> => {
    const current = middleware[index];

    if (!current) {
      return;
    }

    if (!isMiddlewareInstance(current)) {
      throw new Error('Expected object middleware in shared middleware test harness.');
    }

    await current.handle(context as never, async () => {
      await dispatch(index + 1);
    });
  };

  await dispatch(0);
}

function isMiddlewareInstance(value: unknown): value is Middleware {
  return typeof value === 'object' && value !== null && 'handle' in value && typeof value.handle === 'function';
}

describe('createHttpAdapterMiddleware', () => {
  it('shares CORS, security headers, and global prefix rewriting across adapters', async () => {
    const context = createTestContext('/api/users', '/api/users?sort=asc');
    const snapshots: Array<{ path: string; url: string; xcto: string | string[] | undefined }> = [];

    await runMiddlewareChain(context, async (current) => {
      snapshots.push({
        path: current.request.path,
        url: current.request.url,
        xcto: current.response.headers['X-Content-Type-Options'],
      });
    });

    expect(snapshots).toEqual([
      {
        path: '/users',
        url: '/users?sort=asc',
        xcto: 'nosniff',
      },
    ]);
    expect(context.response.headers['Access-Control-Allow-Origin']).toBe('https://client.test');
    expect(context.response.headers['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type');
    expect(context.response.headers['Access-Control-Expose-Headers']).toBe('X-Request-Id');
    expect(context.response.headers.Vary).toBe('Origin');
  });

  it('preserves excluded paths and rejects unprefixed requests consistently', async () => {
    const excluded = createTestContext('/health');
    const visited: string[] = [];

    await runMiddlewareChain(excluded, async (current) => {
      visited.push(current.request.path);
    });

    expect(visited).toEqual(['/health']);
    expect(excluded.response.statusCode).toBeUndefined();

    const rejected = createTestContext('/users');

    await runMiddlewareChain(rejected);

    expect(rejected.response.statusCode).toBe(404);
    expect(rejected.response.committed).toBe(true);
    expect(rejected.response.payload).toMatchObject({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found.',
        requestId: 'req-1',
        status: 404,
      },
    });
  });
});

describe('runHttpAdapterApplication', () => {
  it('uses explicit shutdown registration supplied by the owning runtime', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const events: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error() {},
      log() {},
      warn() {},
    };
    const adapter = {
      close: async () => {
        events.push('adapter:close');
      },
      getListenTarget() {
        return {
          bindTarget: 'runtime://test',
          url: 'runtime://test',
        };
      },
      async listen() {
        events.push('adapter:listen');
      },
    };

    const app = await runHttpAdapterApplication(AppModule, {
      forceExitTimeoutMs: 123,
      logger,
      shutdownRegistration(application, _logger, forceExitTimeoutMs) {
        events.push(`register:${application.state}:${String(forceExitTimeoutMs)}`);
        return () => {
          events.push('unregister');
        };
      },
    }, adapter);

    expect(events).toEqual([
      'adapter:listen',
      'register:ready:123',
    ]);

    await app.close('SIGTERM');

    expect(events).toEqual([
      'adapter:listen',
      'register:ready:123',
      'unregister',
      'adapter:close',
    ]);
  });
});
