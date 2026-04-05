import { afterEach, describe, expect, it, vi } from 'vitest';

import { Controller, Get, Post, SseResponse, type FrameworkRequest, type FrameworkResponse, type RequestContext } from '@konekti/http';
import { defineModule, type ApplicationLogger } from '@konekti/runtime';

import {
  createBunAdapter,
  createBunFetchHandler,
  runBunApplication,
  type BunServeOptions,
  type BunServerLike,
} from './adapter.js';

type MockBunServer = BunServerLike & {
  fetch(request: Request): Promise<Response>;
  stop: ReturnType<typeof vi.fn<(closeActiveConnections?: boolean) => void>>;
};

type MockBun = {
  lastOptions?: BunServeOptions;
  lastServer?: MockBunServer;
  serve: ReturnType<typeof vi.fn<(options: BunServeOptions) => MockBunServer>>;
};

const originalBun = (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;

afterEach(() => {
  if (originalBun === undefined) {
    delete (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
  } else {
    (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = originalBun;
  }

  vi.restoreAllMocks();
});

function installMockBun(): MockBun {
  const mockBun = {} as MockBun;

  mockBun.serve = vi.fn((options: BunServeOptions) => {
    const protocol = options.tls ? 'https' : 'http';
    const hostname = options.hostname ?? 'localhost';
    const port = options.port ?? 3000;
    let server!: MockBunServer;

    server = {
      fetch: async (request: Request): Promise<Response> => await options.fetch(request, server),
      hostname,
      port,
      stop: vi.fn<(closeActiveConnections?: boolean) => void>(),
      url: new URL(`${protocol}://${hostname}:${String(port)}`),
    };

    mockBun.lastOptions = options;
    mockBun.lastServer = server;
    return server;
  });

  (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = mockBun;
  return mockBun;
}

describe('@konekti/platform-bun', () => {
  it('translates Bun-style Request semantics into the framework request contract', async () => {
    const fetch = createBunFetchHandler({
      dispatcher: {
        async dispatch(request: FrameworkRequest, response: FrameworkResponse) {
          expect(request.method).toBe('POST');
          expect(request.path).toBe('/hooks/stripe');
          expect(request.url).toBe('/hooks/stripe?tag=one&tag=two');
          expect(request.query).toEqual({ tag: ['one', 'two'] });
          expect(request.cookies).toEqual({ bad: '%E0%A4%A', session: 'abc 123' });
          expect(request.body).toEqual({ provider: 'stripe' });
          expect(Buffer.from(request.rawBody ?? new Uint8Array()).toString('utf8')).toBe('{"provider":"stripe"}');

          response.setStatus(202);
          response.setHeader('x-runtime', 'bun');
        },
      },
      rawBody: true,
    });

    const response = await fetch(new Request('https://runtime.test/hooks/stripe?tag=one&tag=two', {
      body: JSON.stringify({ provider: 'stripe' }),
      headers: {
        cookie: 'session=abc%20123; bad=%E0%A4%A',
        'content-type': 'application/json',
      },
      method: 'POST',
    }));

    expect(response.status).toBe(202);
    expect(response.headers.get('x-runtime')).toBe('bun');
    await expect(response.text()).resolves.toBe('');
  });

  it('bridges rawBody-preserving app requests through Bun.serve()', async () => {
    const mockBun = installMockBun();

    @Controller('/webhooks')
    class WebhookController {
      @Post('/json')
      handleJson(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [WebhookController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4310,
      rawBody: true,
    });

    try {
      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4310/webhooks/json', {
        body: JSON.stringify({ provider: 'stripe' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }));

      expect(response?.status).toBe(201);
      await expect(response?.json()).resolves.toEqual({
        parsed: { provider: 'stripe' },
        raw: '{"provider":"stripe"}',
      });
    } finally {
      await app.close();
    }
  });

  it('supports SSE streaming through the shared web adapter core', async () => {
    const mockBun = installMockBun();

    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);

        stream.comment('connected');
        stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });
        stream.close();

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [EventsController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4311,
    });

    try {
      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4311/events', {
        headers: { accept: 'text/event-stream' },
      }));
      const body = await response?.text();

      expect(response?.status).toBe(200);
      expect(response?.headers.get('content-type')).toContain('text/event-stream');
      expect(body).toContain('event: ready');
      expect(body).toContain('data: {"ready":true}');
    } finally {
      await app.close();
    }
  });

  it('logs listen target and removes registered shutdown listeners on close', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message: string, context?: string) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };
    const mockBun = installMockBun();

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [HealthController] });

    const signal = 'SIGTERM' as const;
    const listenersBefore = process.listeners(signal).length;
    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      logger,
      port: 4312,
      shutdownSignals: [signal],
    });

    try {
      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4312/health'));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ ok: true });
      expect(loggerEvents).toContain('log:KonektiFactory:Listening on http://127.0.0.1:4312');
      expect(process.listeners(signal).length).toBe(listenersBefore + 1);
    } finally {
      await app.close();
    }

    expect(process.listeners(signal).length).toBe(listenersBefore);
  });

  it('throws a clear error when Bun.serve() is unavailable', async () => {
    delete (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;

    const adapter = createBunAdapter();

    await expect(adapter.listen({ dispatch: async () => undefined })).rejects.toThrow(
      'Bun adapter requires globalThis.Bun.serve()',
    );
  });
});
