import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { describe, expect, it, vi } from 'vitest';

import {
  Controller,
  Get,
  Post,
  SseResponse,
  type FrameworkRequest,
  type FrameworkResponse,
  type RequestContext,
} from '@fluojs/http';
import { defineModule, type Application, type ApplicationLogger, type ModuleType } from '@fluojs/runtime';
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/http-adapter-portability';

import {
  bootstrapDenoApplication,
  type BootstrapDenoApplicationOptions,
  DenoHttpApplicationAdapter,
  createDenoAdapter,
  runDenoApplication,
  type RunDenoApplicationOptions,
  type DenoServeController,
  type DenoServeFunction,
  type DenoServeHandler,
  type DenoServerWebSocket,
  type DenoServeOptions,
  type DenoWebSocketBinding,
  type DenoWebSocketMessage,
  type DenoUpgradeWebSocketFunction,
} from './adapter.js';

const TEST_TLS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBbj6DdMPNvDMr
yNUM0dreceSBINfH+VDV750R3X57mdoqebUgjKOXjbjR7JRkloJ4PEgAic+840rq
tyTN/MvmaAQg5OtNwsY7wp3Owaomr0sqw+wHM7NkPYMB0apxcWEBC7IWph1sKGcC
iRxNDBBMEUmhxscatvhfkB/aqlQxLYjDylFcIX0A3NzIW0Rfaydk7/3R0hqkiF5x
k/98U2cEPZn1E890q4IsfQ6mGMNi/fh1jMWiR5RFL9MlIhLEJPCyuW/sQMYSglan
T2sKcABWjIShAc4gn87ncbmSv/6IDgfXtVRD6mehvFz9iHVSbV5sGM/bE4y3pgj2
kQXpbdUnAgMBAAECggEAT8yIc7kPMmgrACw5YLGOxuhbqb3/51r+s1PIC9/B14IQ
VCejxsrejp6EGe6tBZZmOu47kiVIk5d9h7mIsIZTJDnTQjLOtGTfXTYb3nldFdqJ
exoa3JnCr18FFhIGbAinSUQm81sSllVQseYYy9xnOMqFAv27lFTZwKr3yUEtvJ9h
oYqq5/yRNwwR1AT6lfWgSJa5S9cvs9YHK4k2XCnhKTqWkQ3Bh9awKy83142r1FWy
rXk3IUwNaNAgRHSEw/9MGbcM6it+l55XjwzEBP/lI+DdDzhRhKgp3QsM/v26eHRl
CwP0NA4d4i1m2kcT8dvtSTxrnwbylSxhVRDYXrsOMQKBgQDn+f9I9LlQJdGPWRda
0YiyZtQZTGYfG/ZJvHPvhLA37rAfV7MGDqKgn22FJPJHT9vE+wVkUT531VErKKlO
dOv6GIz/C3AolVTOTDKxTZnFkicxy4J7pZYHPRo8mIVGFlsKsPQVPz63UZMUkbR6
0HkgcihnxKKlYFb+az7hNvPZbwKBgQDVdlglrw9jGreXtGplZLapsTmAc+GuL17R
fqY4/aXNul0k6MNlSrm2/cUm/KI8AsHvRn2tvdFJnM1drmzEpTvcFx5a9N2F5HOU
N1smlv31RT5B0XqoHTB7df2+zVeAGGcpDY8n27KI9/zigVdVQR/aR+fR7CFfNhCv
sI8PQUkzyQKBgQDWKHckjEF0m6VuuGoWPvD6+nF+9Ygl2jOyeRdzHUVuLZ5NITK2
OdargOOkEqrVaQVUQgYFSffou3eW54/+TXT5S6cHYjDmVo6XccMu6pw2yKoEj4Pj
0MfD4QYSwR/wx3y/TwPXha7JoLavO6Cp7UKV0K46tk8Na/aEJNBFLO1MYwKBgElV
jfTsTnn6rMYmikLpNcPYieuyY/8GcSnBu/NqWLLz6poKiU5cPK88QaYiNs4tGFlO
u1CcHLGQeBFOIjnwlj8HhjszUoN0N6zc06jPSNIhhsDv6Zal6IkRwSnyu7PbLl2x
NdQ4qv5ZS/y4+LrmU74W4/J/j/t4xITHQG66PB7ZAoGANNL4daB3T46IElDHnCbl
j4hWQezWEMRCf4Ruqy24peC4Y8CXMaGA0oN6auePuTdLmGYa9nDn0J77rMqLIG7+
v8OLobYRGfklwPOBs5puVFTEgihMq7Ejh2r9HhoRiCAZS5hIirS08BgrAskgVw9P
dM+3fSZauOH3r+7JXAvrtMo=
-----END PRIVATE KEY-----`;

const TEST_TLS_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQCAEWnETUdMHDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAkx
MjcuMC4wLjEwHhcNMjYwMzE4MDEzNTQ2WhcNMjYwMzE5MDEzNTQ2WjAUMRIwEAYD
VQQDDAkxMjcuMC4wLjEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDB
bj6DdMPNvDMryNUM0dreceSBINfH+VDV750R3X57mdoqebUgjKOXjbjR7JRkloJ4
PEgAic+840rqtyTN/MvmaAQg5OtNwsY7wp3Owaomr0sqw+wHM7NkPYMB0apxcWEB
C7IWph1sKGcCiRxNDBBMEUmhxscatvhfkB/aqlQxLYjDylFcIX0A3NzIW0Rfaydk
7/3R0hqkiF5xk/98U2cEPZn1E890q4IsfQ6mGMNi/fh1jMWiR5RFL9MlIhLEJPCy
uW/sQMYSglanT2sKcABWjIShAc4gn87ncbmSv/6IDgfXtVRD6mehvFz9iHVSbV5s
GM/bE4y3pgj2kQXpbdUnAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAJhOoDgzUsiV
XE0p5DznahRbv85K05BS6iXfMRnjgHziJyED0h6dD3vpFTnQLW9I7SQeMA21sZPx
MNm+gL8/Jq2G2CGwx0naD9bsTFYboWhBk+SuQVj8f7g8xM7ya2nB8AJg07/n3VD5
NJFlJnyXlpchaxikKeaLWWGJCzPosbqUDdS5Y9S3VkqxM3na4Z+04qLaLQSEEpSi
WZWkDdOMceoMbJC0CpyVtWCW7mKKFOwL/yEtmJ0Uw0aaHwFOEj9+FQUPYjThCcbz
fHFvqyh6pXZV7XKcPxCTNuIw2rpw2WqY5/H+lTmUFmSXieFZAAMRueGH8Y5trCHU
JNCDpGwh8us=
-----END CERTIFICATE-----`;

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

function createNodeBackedDenoServe(): DenoServeFunction {
  return (options, handler) => {
    const finished = createDeferred<void>();
    const server = options.cert && options.key
      ? createHttpsServer({ cert: options.cert, key: options.key })
      : createHttpServer();

    server.on('request', (request, response) => {
      void dispatchNodeRequest(request, response, options, handler).catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : 'Unhandled test server error.');
      });
    });
    server.on('close', () => {
      finished.resolve();
    });
    server.on('error', (error) => {
      finished.reject(error);
    });
    options.signal?.addEventListener('abort', () => {
      server.close();
    }, { once: true });
    server.listen(options.port, options.hostname, () => {
      const address = server.address();

      if (address && typeof address !== 'string') {
        options.onListen?.({ hostname: address.address, port: address.port });
      }
    });

    return {
      finished: finished.promise,
      shutdown: async () => {
        await new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }

          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      },
    };
  };
}

async function dispatchNodeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: DenoServeOptions,
  handler: DenoServeHandler,
): Promise<void> {
  const protocol = options.cert && options.key ? 'https' : 'http';
  const host = request.headers.host ?? `${options.hostname ?? '127.0.0.1'}:${String(options.port ?? 0)}`;
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const webResponse = await handler(new Request(`${protocol}://${host}${request.url ?? '/'}`, {
    headers,
    method: request.method,
  }));
  const body = Buffer.from(await webResponse.arrayBuffer());

  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => {
    response.setHeader(name, value);
  });
  response.end(body);
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

function installDenoSignalMock() {
  const originalDeno = (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
  const listeners = new Map<string, () => void>();
  const addSignalListener = vi.fn((signal: string, handler: () => void) => {
    listeners.set(signal, handler);
  });
  const removeSignalListener = vi.fn((signal: string, handler: () => void) => {
    if (listeners.get(signal) === handler) {
      listeners.delete(signal);
    }
  });

  (globalThis as typeof globalThis & {
    Deno?: {
      addSignalListener: typeof addSignalListener;
      removeSignalListener: typeof removeSignalListener;
    };
  }).Deno = {
    addSignalListener,
    removeSignalListener,
  };

  return {
    addSignalListener,
    emit(signal: string) {
      listeners.get(signal)?.();
    },
    removeSignalListener,
    restore() {
      if (originalDeno === undefined) {
        delete (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
        return;
      }

      (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
    },
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

describe('@fluojs/platform-deno', () => {
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
      'FluoFactory',
    );

    await app.close();
  });

  it('forwards HTTPS certificate options to Deno.serve and reports an HTTPS listen target', async () => {
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
      hostname: '127.0.0.1',
      https: {
        cert: TEST_TLS_CERTIFICATE,
        key: TEST_TLS_PRIVATE_KEY,
      },
      logger,
      port: 3443,
      serve: server.serve,
    });

    expect(server.options).toMatchObject({
      cert: TEST_TLS_CERTIFICATE,
      hostname: '127.0.0.1',
      key: TEST_TLS_PRIVATE_KEY,
      port: 3443,
    });
    expect(logger.log).toHaveBeenCalledWith(
      'Listening on https://127.0.0.1:3443',
      'FluoFactory',
    );

    await app.close();
  });

  it('satisfies the shared HTTPS startup portability expectation', async () => {
    const createServe = () => createNodeBackedDenoServe();
    const harness = createHttpAdapterPortabilityHarness<BootstrapDenoApplicationOptions, RunDenoApplicationOptions>({
      bootstrap: async (rootModule: ModuleType, options: BootstrapDenoApplicationOptions): Promise<Application> => await bootstrapDenoApplication(rootModule, {
        ...options,
        serve: createServe(),
      }),
      name: 'deno',
      run: async (rootModule: ModuleType, options: RunDenoApplicationOptions): Promise<Application> => await runDenoApplication(rootModule, {
        ...options,
        serve: createServe(),
        shutdownSignals: false,
      }),
    });

    await harness.assertReportsHttpsStartupUrl({
      cert: TEST_TLS_CERTIFICATE,
      key: TEST_TLS_PRIVATE_KEY,
    });
  });

  it('formats explicit IPv6 listen targets with brackets', () => {
    const adapter = createDenoAdapter({
      hostname: '::1',
      port: 3000,
    });

    expect(adapter.getListenTarget()).toEqual({
      bindTarget: '[::1]:3000',
      url: 'http://[::1]:3000',
    });
  });

  it('formats IPv6 wildcard listen targets with a bracketed bind target and localhost URL', () => {
    const adapter = createDenoAdapter({
      hostname: '::',
      port: 3000,
    });

    expect(adapter.getListenTarget()).toEqual({
      bindTarget: '[::]:3000',
      url: 'http://localhost:3000',
    });
  });

  it('registers and removes Deno shutdown signal listeners through the run helper', async () => {
    const signals = installDenoSignalMock();

    try {
      class AppModule {}
      defineModule(AppModule, {});

      const server = createServeStub();
      const app = await runDenoApplication(AppModule, {
        serve: server.serve,
        shutdownSignals: ['SIGTERM'],
      });

      expect(signals.addSignalListener).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

      await app.close();

      expect(signals.removeSignalListener).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    } finally {
      signals.restore();
    }
  });

  it('closes the Deno application when a registered shutdown signal fires', async () => {
    const signals = installDenoSignalMock();

    try {
      class AppModule {}
      defineModule(AppModule, {});

      const server = createServeStub();
      const app = await runDenoApplication(AppModule, {
        serve: server.serve,
        shutdownSignals: ['SIGTERM'],
      });
      const closeSpy = vi.spyOn(app, 'close');

      signals.emit('SIGTERM');
      await Promise.resolve();
      await Promise.resolve();

      expect(closeSpy).toHaveBeenCalledWith('SIGTERM');
      await app.close();
    } finally {
      signals.restore();
    }
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

  it('clears the Deno shutdown timer once close settles', async () => {
    vi.useFakeTimers();

    try {
      const shutdownDeferred = createDeferred<void>();
      const finishedDeferred = createDeferred<void>();
      const adapter = new DenoHttpApplicationAdapter({
        hostname: '0.0.0.0',
        port: 3000,
        serve: vi.fn(() => ({
          finished: finishedDeferred.promise,
          shutdown: async () => {
            await shutdownDeferred.promise;
          },
        })),
      });

      await adapter.listen({
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          response.setStatus(204);
        },
      });

      const closePromise = adapter.close();

      expect(vi.getTimerCount()).toBe(1);

      shutdownDeferred.resolve();
      finishedDeferred.resolve();
      await Promise.resolve();
      await closePromise;

      expect(vi.getTimerCount()).toBe(0);
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
        'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @fluojs/websockets/deno for the official raw websocket binding.',
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
