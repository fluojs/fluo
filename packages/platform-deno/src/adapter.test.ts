import { describe, expect, it, vi } from 'vitest';

import {
  Controller,
  Get,
  Post,
  SseResponse,
  type FrameworkRequest,
  type FrameworkResponse,
  type RequestContext,
} from '@konekti/http';
import { defineModule, type ApplicationLogger } from '@konekti/runtime';

import {
  bootstrapDenoApplication,
  DenoHttpApplicationAdapter,
  createDenoAdapter,
  runDenoApplication,
  type DenoServeController,
  type DenoServeHandler,
  type DenoServerWebSocket,
  type DenoServeOptions,
  type DenoWebSocketBinding,
  type DenoWebSocketMessage,
  type DenoUpgradeWebSocketFunction,
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

function createUpgradeWebSocketStub() {
  const socket = createMockDenoSocket();
  const upgrade = vi.fn<DenoUpgradeWebSocketFunction>(() => ({
    response: new Response(null, { status: 200 }),
    socket,
  }));

  return {
    socket,
    upgrade,
  };
}

function createMockDenoSocket(): DenoServerWebSocket {
  const listeners = {
    close: [] as Array<(event: Event) => void>,
    error: [] as Array<(event: Event) => void>,
    message: [] as Array<(event: MessageEvent<DenoWebSocketMessage>) => void>,
  };
  let readyState = 1;

  return {
    addEventListener(type: 'close' | 'error' | 'message', listener: EventListenerOrEventListenerObject | null) {
      if (!listener) {
        return;
      }

      const callback: (event: Event) => void = typeof listener === 'function'
        ? (event: Event) => listener(event)
        : (event: Event) => listener.handleEvent(event);

      if (type === 'close') {
        listeners.close.push(callback);
        return;
      }

      if (type === 'error') {
        listeners.error.push(callback);
        return;
      }

      listeners.message.push(callback as (event: MessageEvent<DenoWebSocketMessage>) => void);
    },
    close(code?: number, reason?: string) {
      readyState = 3;
      const event = new Event('close') as Event & { code: number; reason: string };
      Object.defineProperties(event, {
        code: { value: code ?? 1000 },
        reason: { value: reason ?? '' },
      });

      for (const listener of listeners.close) {
        listener(event);
      }
    },
    get readyState() {
      return readyState;
    },
    removeEventListener() {},
    send() {},
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

  it('drains in-flight requests before Deno close resolves', async () => {
    const server = createServeStub();
    const adapter = new DenoHttpApplicationAdapter({
      hostname: '0.0.0.0',
      port: 3000,
      serve: server.serve,
    });
    const deferred = createDeferred<void>();
    let closeSettled = false;

    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        await deferred.promise;
        response.setStatus(200);
        await response.send({ ok: true });
      },
    });

    const responsePromise = server.handler!(new Request('https://runtime.test/drain'));
    const closePromise = adapter.close().then(() => {
      closeSettled = true;
    });

    await Promise.resolve();

    expect(closeSettled).toBe(false);
    expect(server.shutdown).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await expect(responsePromise).resolves.toBeInstanceOf(Response);
    await closePromise;

    expect(closeSettled).toBe(true);
    expect(adapter.getServer()).toBeUndefined();
  });

  it('keeps the Deno dispatcher until drain settles even when close() times out', async () => {
    vi.useFakeTimers();

    try {
      const server = createServeStub();
      const adapter = new DenoHttpApplicationAdapter({
        hostname: '0.0.0.0',
        port: 3000,
        serve: server.serve,
      });
      const deferred = createDeferred<void>();
      const dispatcher = {
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          await deferred.promise;
          response.setStatus(200);
          await response.send({ ok: true });
        },
      };

      await adapter.listen(dispatcher);

      const responsePromise = server.handler!(new Request('https://runtime.test/timeout-check'));
      const closeResultPromise = adapter.close().catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(10_001);

      await expect(closeResultPromise).resolves.toBeInstanceOf(Error);
      expect(Reflect.get(adapter, 'dispatcher')).toBe(dispatcher);

      deferred.resolve();
      await responsePromise;
      vi.useRealTimers();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(Reflect.get(adapter, 'dispatcher')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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

  it('reports supported fetch-style websocket hosting for the official Deno binding seam', () => {
    const adapter = createDenoAdapter();

    expect(adapter.getRealtimeCapability()).toEqual({
      contract: 'raw-websocket-expansion',
      kind: 'fetch-style',
      mode: 'request-upgrade',
      reason:
        'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @konekti/websockets/deno for the official raw websocket binding.',
      support: 'supported',
      version: 1,
    });
  });

  it('delegates websocket upgrade requests through a configured Deno websocket binding before HTTP dispatch', async () => {
    const server = createServeStub();
    const upgraded = createUpgradeWebSocketStub();
    const adapter = new DenoHttpApplicationAdapter({
      hostname: '0.0.0.0',
      port: 3000,
      serve: server.serve,
      upgradeWebSocket: upgraded.upgrade,
    });
    const dispatcher = {
      dispatch: vi.fn(async () => undefined),
    };
    const bindingFetch = vi.fn<DenoWebSocketBinding['fetch']>(async (request, host) => {
      const result = host.upgrade(request);
      expect(result.socket).toBe(upgraded.socket);
      return result.response;
    });

    adapter.configureWebSocketBinding({
      fetch: bindingFetch,
    });

    await adapter.listen(dispatcher);

    const upgradeResponse = await server.handler?.(new Request('https://runtime.test/chat', {
      headers: { upgrade: 'websocket' },
    }));
    const httpResponse = await server.handler?.(new Request('https://runtime.test/http'));

    expect(upgradeResponse?.status).toBe(200);
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    expect(upgraded.upgrade).toHaveBeenCalledTimes(1);
    expect(httpResponse?.status).toBe(200);
  });
});
