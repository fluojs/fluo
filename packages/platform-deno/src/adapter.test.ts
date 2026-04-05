import { describe, expect, it, vi } from 'vitest';

import {
  Controller,
  Get,
  Post,
  SseResponse,
  type RequestContext,
} from '@konekti/http';
import { defineModule, type ApplicationLogger } from '@konekti/runtime';

import {
  bootstrapDenoApplication,
  createDenoAdapter,
  runDenoApplication,
  type DenoServeController,
  type DenoServeHandler,
  type DenoServeOptions,
} from './adapter.js';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createServeStub() {
  const finished = createDeferred<void>();
  const shutdown = vi.fn(async () => {
    finished.resolve();
  });
  let capturedHandler: DenoServeHandler | undefined;
  let capturedOptions: DenoServeOptions | undefined;

  return {
    finished,
    get handler() {
      return capturedHandler;
    },
    get options() {
      return capturedOptions;
    },
    serve: vi.fn((options: DenoServeOptions, handler: DenoServeHandler): DenoServeController => {
      capturedOptions = options;
      capturedHandler = handler;
      return {
        finished: finished.promise,
        shutdown,
      };
    }),
    shutdown,
  };
}

describe('@konekti/platform-deno', () => {
  it('dispatches requests through the shared Web request/response core', async () => {
    @Controller('/hooks')
    class WebhookController {
      @Post('/stripe')
      handle(_input: undefined, context: RequestContext) {
        return {
          cookies: context.request.cookies,
          method: context.request.method,
          parsed: context.request.body,
          path: context.request.path,
          query: context.request.query,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
          url: context.request.url,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const server = createServeStub();
    const app = await bootstrapDenoApplication(AppModule, {
      port: 4567,
      rawBody: true,
      serve: server.serve,
    });

    await app.listen();

    expect(server.options).toMatchObject({
      hostname: '0.0.0.0',
      port: 4567,
    });
    expect(server.options?.signal?.aborted).toBe(false);

    const response = await server.handler?.(new Request('https://runtime.test/hooks/stripe?tag=one&tag=two', {
      body: JSON.stringify({ provider: 'stripe' }),
      headers: {
        cookie: 'session=abc%20123; bad=%E0%A4%A',
        'content-type': 'application/json',
      },
      method: 'POST',
    }));

    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toEqual({
      cookies: { bad: '%E0%A4%A', session: 'abc 123' },
      method: 'POST',
      parsed: { provider: 'stripe' },
      path: '/hooks/stripe',
      query: { tag: ['one', 'two'] },
      raw: '{"provider":"stripe"}',
      url: '/hooks/stripe?tag=one&tag=two',
    });

    await app.close();

    expect(server.shutdown).toHaveBeenCalledTimes(1);
    expect(server.options?.signal?.aborted).toBe(true);
  });

  it('supports SSE streaming over the shared Web response bridge', async () => {
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
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const server = createServeStub();
    const app = await bootstrapDenoApplication(AppModule, {
      serve: server.serve,
    });

    await app.listen();

    const response = await server.handler?.(new Request('https://runtime.test/events', {
      headers: {
        accept: 'text/event-stream',
      },
    }));
    const body = await response?.text();

    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: ready');
    expect(body).toContain('data: {"ready":true}');

    await app.close();
  });

  it('logs the listen target through the run helper', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const server = createServeStub();
    const logger: ApplicationLogger = {
      debug() {},
      error() {},
      log: vi.fn(),
      warn() {},
    };

    const app = await runDenoApplication(AppModule, {
      logger,
      serve: server.serve,
    });

    expect(logger.log).toHaveBeenCalledWith(
      'Listening on http://localhost:3000 (bound to 0.0.0.0:3000)',
      'KonektiFactory',
    );

    await app.close();
  });

  it('exposes a not-ready error when requests arrive before listen()', async () => {
    const adapter = createDenoAdapter();
    const response = await adapter.handle(new Request('https://runtime.test/not-ready'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
        status: 500,
      },
    });
  });
});
