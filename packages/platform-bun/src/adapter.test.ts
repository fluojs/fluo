import { afterEach, describe, expect, it, vi } from 'vitest';

import { All, Controller, createDispatcher, createHandlerMapping, Get, Header, HttpCode, Post, Redirect, SseResponse, Version, VersioningType, type FrameworkRequest, type FrameworkResponse, type RequestContext } from '@fluojs/http';
import { defineModule, type ApplicationLogger } from '@fluojs/runtime';

import {
  bootstrapBunApplication,
  BunHttpApplicationAdapter,
  createBunAdapter,
  createBunFetchHandler,
  runBunApplication,
  type BootstrapBunApplicationOptions,
  type BunServeOptions,
  type BunServerLike,
  type BunServerWebSocket,
  type BunWebSocketBinding,
} from './adapter.js';

type MockBunServer = BunServerLike & {
  fetch(request: Request): Promise<Response | undefined>;
  stop: ReturnType<typeof vi.fn<(closeActiveConnections?: boolean) => void>>;
  upgrade: ReturnType<typeof vi.fn<(request: Request, options?: { data?: unknown; headers?: HeadersInit }) => boolean>>;
};

type MockBun = {
  lastOptions?: BunServeOptions;
  lastServer?: MockBunServer;
  serve: ReturnType<typeof vi.fn<(options: BunServeOptions) => MockBunServer>>;
  version: string;
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function installMockBun(options: { version?: string } = {}): MockBun {
  const mockBun = {} as MockBun;
  mockBun.version = options.version ?? '1.2.3';

  mockBun.serve = vi.fn((options: BunServeOptions) => {
    const protocol = options.tls ? 'https' : 'http';
    const hostname = options.hostname ?? 'localhost';
    const port = options.port ?? 3000;
    let server!: MockBunServer;

    server = {
      fetch: async (request: Request): Promise<Response | undefined> => {
        const routed = await dispatchMockBunNativeRoute(options, request, server);

        if (routed.matched) {
          return routed.response;
        }

        return await options.fetch(request, server);
      },
      hostname,
      port,
      stop: vi.fn<(closeActiveConnections?: boolean) => void>(),
      upgrade: vi.fn((_request: Request, upgradeOptions?: { data?: unknown; headers?: HeadersInit }) => {
        const websocket = options.websocket;

        if (!websocket) {
          return false;
        }

        const socket = createMockServerWebSocket(upgradeOptions?.data);
        void Promise.resolve(websocket.open?.(socket));
        return true;
      }),
      url: new URL(`${protocol}://${hostname}:${String(port)}`),
    };

    mockBun.lastOptions = options;
    mockBun.lastServer = server;
    return server;
  });

  (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = mockBun;
  return mockBun;
}

function createMockServerWebSocket(data: unknown): BunServerWebSocket<unknown> {
  const subscriptions = new Set<string>();

  return {
    close() {},
    cork(callback: (socket: BunServerWebSocket<unknown>) => void) {
      callback(this);
    },
    data,
    isSubscribed(topic: string) {
      return subscriptions.has(topic);
    },
    publish() {},
    readyState: 1,
    remoteAddress: '127.0.0.1',
    send() {
      return 1;
    },
    subscribe(topic: string) {
      subscriptions.add(topic);
    },
    get subscriptions() {
      return [...subscriptions];
    },
    unsubscribe(topic: string) {
      subscriptions.delete(topic);
    },
  };
}

function createMockDispatcherRoute(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' = 'GET') {
  return {
    controllerToken: class TestController {},
    metadata: {
      controllerPath: '',
      effectivePath: path,
      moduleMiddleware: [],
      pathParams: path.split('/').filter((segment) => segment.startsWith(':')).map((segment) => segment.slice(1)),
    },
    methodName: 'handle',
    route: {
      method,
      path,
    },
  };
}

async function dispatchMockBunNativeRoute(
  options: BunServeOptions,
  request: Request,
  server: MockBunServer,
): Promise<{ matched: boolean; response?: Response }> {
  const matched = matchMockBunRoute(options.routes, new URL(request.url).pathname, request.method.toUpperCase());

  if (!matched) {
    return { matched: false };
  }

  const routeValue = resolveMockBunRouteValue(matched.value, request.method.toUpperCase());

  if (!routeValue) {
    return { matched: false };
  }

  if (routeValue instanceof Response) {
    return {
      matched: true,
      response: routeValue.clone(),
    };
  }

  Object.defineProperty(request, 'params', {
    configurable: true,
    enumerable: true,
    value: matched.params,
  });

  return {
    matched: true,
    response: await routeValue(request as Request & { params: Record<string, string> }, server),
  };
}

function matchMockBunRoute(
  routes: BunServeOptions['routes'],
  path: string,
  method: string,
): { params: Record<string, string>; value: NonNullable<BunServeOptions['routes']>[string] } | undefined {
  if (!routes) {
    return undefined;
  }

  const entries = Object.entries(routes);

  for (const [pattern, value] of entries) {
    if (pattern === path) {
      return isMockBunRouteMethodSupported(value, method)
        ? { params: {}, value }
        : { params: {}, value: new Response(null, { status: 404 }) };
    }
  }

  for (const [pattern, value] of entries) {
    if (!pattern.includes(':')) {
      continue;
    }

    const params = matchMockBunParamRoute(pattern, path);

    if (params) {
      return isMockBunRouteMethodSupported(value, method)
        ? { params, value }
        : { params, value: new Response(null, { status: 404 }) };
    }
  }

  for (const [pattern, value] of entries) {
    if (pattern === '/*') {
      return { params: {}, value };
    }

    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1);

      if (path.startsWith(prefix)) {
        return { params: {}, value };
      }
    }
  }

  return undefined;
}

function matchMockBunParamRoute(pattern: string, path: string): Record<string, string> | undefined {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);

  if (patternSegments.length !== pathSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];

    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }

    if (patternSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

function resolveMockBunRouteValue(value: NonNullable<BunServeOptions['routes']>[string], method: string) {
  if (value instanceof Response || typeof value === 'function') {
    return value;
  }

  return value[method as keyof typeof value];
}

function isMockBunRouteMethodSupported(value: NonNullable<BunServeOptions['routes']>[string], method: string): boolean {
  if (value instanceof Response || typeof value === 'function') {
    return true;
  }

  return value[method as keyof typeof value] !== undefined;
}

function registerBunWebRuntimePortabilitySuite(): void {
  describe('Bun web-runtime portability conformance', () => {
    it('preserves malformed cookie values', async () => {
      const mockBun = installMockBun();

      @Controller('/cookies')
      class CookieController {
        @Get('/')
        readCookies(_input: undefined, context: RequestContext) {
          return context.request.cookies;
        }
      }

      class AppModule {}
      defineModule(AppModule, { controllers: [CookieController] });

      const app = await bootstrapAndListenBunApplication(AppModule, { cors: false });

      try {
        const response = await dispatchMockBunRequest(mockBun, new Request('https://runtime.test/cookies', {
          headers: { cookie: 'good=hello%20world; bad=%E0%A4%A' },
        }));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ bad: '%E0%A4%A', good: 'hello world' });
      } finally {
        await app.close();
      }
    });

    it('preserves raw body for JSON and text requests when enabled', async () => {
      const mockBun = installMockBun();

      @Controller('/webhooks')
      class WebhookController {
        @Post('/json')
        handleJson(_input: undefined, context: RequestContext) {
          return {
            parsed: context.request.body,
            raw: decodeUtf8(context.request.rawBody),
          };
        }

        @Post('/text')
        handleText(_input: undefined, context: RequestContext) {
          return {
            parsed: context.request.body,
            raw: decodeUtf8(context.request.rawBody),
          };
        }
      }

      class AppModule {}
      defineModule(AppModule, { controllers: [WebhookController] });

      const app = await bootstrapAndListenBunApplication(AppModule, { cors: false, rawBody: true });

      try {
        const [jsonResponse, textResponse] = await Promise.all([
          dispatchMockBunRequest(mockBun, new Request('https://runtime.test/webhooks/json', {
            body: JSON.stringify({ provider: 'stripe' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })),
          dispatchMockBunRequest(mockBun, new Request('https://runtime.test/webhooks/text', {
            body: 'ping=1',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            method: 'POST',
          })),
        ]);

        expect(jsonResponse.status).toBe(201);
        expect(textResponse.status).toBe(201);
        await expect(jsonResponse.json()).resolves.toEqual({ parsed: { provider: 'stripe' }, raw: '{"provider":"stripe"}' });
        await expect(textResponse.json()).resolves.toEqual({ parsed: 'ping=1', raw: 'ping=1' });
      } finally {
        await app.close();
      }
    });

    it('does not preserve rawBody for multipart requests', async () => {
      const mockBun = installMockBun();

      @Controller('/uploads')
      class UploadController {
        @Post('/')
        upload(_input: undefined, context: RequestContext) {
          return {
            body: context.request.body,
            fileCount: context.request.files?.length ?? 0,
            hasRawBody: context.request.rawBody !== undefined,
          };
        }
      }

      class AppModule {}
      defineModule(AppModule, { controllers: [UploadController] });

      const app = await bootstrapAndListenBunApplication(AppModule, { cors: false, rawBody: true });

      try {
        const form = new FormData();
        form.set('name', 'Ada');
        form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

        const response = await dispatchMockBunRequest(mockBun, new Request('https://runtime.test/uploads', {
          body: form,
          method: 'POST',
        }));

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toEqual({ body: { name: 'Ada' }, fileCount: 1, hasRawBody: false });
      } finally {
        await app.close();
      }
    });

    it('supports SSE streaming', async () => {
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

      const app = await bootstrapAndListenBunApplication(AppModule, { cors: false });

      try {
        const response = await dispatchMockBunRequest(mockBun, new Request('https://runtime.test/events', {
          headers: { accept: 'text/event-stream' },
        }));
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        expect(body).toContain('event: ready');
        expect(body).toContain('data: {"ready":true}');
      } finally {
        await app.close();
      }
    });
  });
}

async function bootstrapAndListenBunApplication(rootModule: Parameters<typeof bootstrapBunApplication>[0], options: BootstrapBunApplicationOptions) {
  const app = await bootstrapBunApplication(rootModule, options);

  await app.listen();
  return app;
}

async function dispatchMockBunRequest(mockBun: MockBun, request: Request): Promise<Response> {
  return await mockBun.lastServer!.fetch(request) ?? new Response(null, { status: 404 });
}

function decodeUtf8(input: Uint8Array | undefined): string {
  return new TextDecoder().decode(input ?? new Uint8Array());
}

describe('@fluojs/platform-bun', () => {
  registerBunWebRuntimePortabilitySuite();

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

  it('preserves response parity for simple JSON and non-fast-path responses', async () => {
    @Controller('/responses')
    class ResponsesController {
      @Get('/object')
      getObject() {
        return { ok: true };
      }

      @Get('/array')
      getArray() {
        return [{ ok: true }];
      }

      @Get('/string')
      getString() {
        return 'plain';
      }

      @Get('/bytes')
      getBytes() {
        return Uint8Array.from([65, 66]);
      }

      @Get('/buffer')
      getBuffer() {
        return Uint8Array.from([67, 68]).buffer;
      }

      @Header('X-Contract', 'preserved')
      @HttpCode(202)
      @Get('/headers')
      getHeaders() {
        return { ok: true };
      }

      @Redirect('/responses/object', 302)
      @Get('/redirect')
      getRedirect() {
        return { ignored: true };
      }

      @Get('/error')
      getError() {
        throw new Error('bun response parity error');
      }
    }

    const fetch = createBunFetchHandler({
      dispatcher: createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: ResponsesController }]),
        rootContainer: {
          createRequestScope() {
            return {
              async dispose() {},
              resolve() {
                return new ResponsesController();
              },
            };
          },
        } as never,
      }),
    });
    const responseFor = (path: string) => fetch(new Request(`https://runtime.test${path}`));

    const objectResponse = await responseFor('/responses/object');
    const arrayResponse = await responseFor('/responses/array');
    const stringResponse = await responseFor('/responses/string');
    const bytesResponse = await responseFor('/responses/bytes');
    const bufferResponse = await responseFor('/responses/buffer');
    const headerResponse = await responseFor('/responses/headers');
    const redirectResponse = await responseFor('/responses/redirect');
    const errorResponse = await responseFor('/responses/error');

    expect(objectResponse.status).toBe(200);
    expect(objectResponse.headers.get('content-type')).toContain('application/json');
    await expect(objectResponse.json()).resolves.toEqual({ ok: true });
    expect(arrayResponse.status).toBe(200);
    expect(arrayResponse.headers.get('content-type')).toContain('application/json');
    await expect(arrayResponse.json()).resolves.toEqual([{ ok: true }]);
    expect(stringResponse.headers.get('content-type')).toContain('text/plain');
    await expect(stringResponse.text()).resolves.toBe('plain');
    expect(bytesResponse.headers.get('content-type')).toContain('application/octet-stream');
    await expect(bytesResponse.text()).resolves.toBe('AB');
    expect(bufferResponse.headers.get('content-type')).toContain('application/octet-stream');
    await expect(bufferResponse.text()).resolves.toBe('CD');
    expect(headerResponse.status).toBe(202);
    expect(headerResponse.headers.get('x-contract')).toBe('preserved');
    await expect(headerResponse.json()).resolves.toEqual({ ok: true });
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get('location')).toBe('/responses/object');
    expect(errorResponse.status).toBe(500);
    await expect(errorResponse.json()).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
      },
    });
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
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/webhooks/json': {
          POST: expect.any(Function),
        },
      });

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

  it('registers Bun native param routes without changing fluo path-param semantics', async () => {
    const mockBun = installMockBun();

    @Controller('/users')
    class UsersController {
      @Get('/:userId')
      getById(_input: undefined, context: RequestContext) {
        return { userId: context.request.params.userId };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [UsersController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4314,
    });

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/users/:userId': {
          GET: expect.any(Function),
        },
      });

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4314/users/a%2Fb'));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ userId: 'a%2Fb' });
    } finally {
      await app.close();
    }
  });

  it('preserves shared dispatcher method-miss semantics for Bun native routes', async () => {
    const mockBun = installMockBun();

    @Controller('/users')
    class UsersController {
      @Get('/:userId')
      getById(_input: undefined, context: RequestContext) {
        return { userId: context.request.params.userId };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [UsersController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4319,
    });

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/users/:userId': {
          GET: expect.any(Function),
          POST: expect.any(Function),
        },
      });

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4319/users/123', {
        headers: { 'x-request-id': 'req-bun-method-miss' },
        method: 'POST',
      }));

      expect(response?.status).toBe(404);
      await expect(response?.json()).resolves.toMatchObject({
        error: {
          code: 'NOT_FOUND',
          message: 'No handler registered for POST /users/123.',
          requestId: 'req-bun-method-miss',
          status: 404,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('hands safe Bun native routes to the dispatcher without rematching', async () => {
    const mockBun = installMockBun();

    @Controller('/native')
    class NativeController {
      @Get('/:id')
      getById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id };
      }
    }

    const baseMapping = createHandlerMapping([{ controllerToken: NativeController }]);
    const dispatcher = createDispatcher({
      handlerMapping: {
        descriptors: baseMapping.descriptors,
        match: vi.fn(() => {
          throw new Error('Bun native handoff should bypass handlerMapping.match');
        }),
      },
      rootContainer: {
        createRequestScope() {
          return {
            async dispose() {},
            resolve() {
              return new NativeController();
            },
          };
        },
      } as never,
    });
    const adapter = createBunAdapter({
      hostname: '127.0.0.1',
      port: 4320,
    }) as BunHttpApplicationAdapter;

    await adapter.listen(dispatcher);

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/native/:id': {
          GET: expect.any(Function),
        },
      });

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4320/native/123'));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ id: '123' });
    } finally {
      await adapter.close();
    }
  });

  it('hands every safe explicit method for the same Bun native path to the dispatcher without rematching', async () => {
    const mockBun = installMockBun();

    @Controller('/native-multi')
    class NativeMultiController {
      @Get('/:id')
      getById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id, method: 'GET' };
      }

      @Post('/:id')
      postById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id, method: 'POST' };
      }
    }

    const baseMapping = createHandlerMapping([{ controllerToken: NativeMultiController }]);
    const dispatcher = createDispatcher({
      handlerMapping: {
        descriptors: baseMapping.descriptors,
        match: vi.fn(() => {
          throw new Error('Bun native handoff should bypass handlerMapping.match for every explicit method');
        }),
      },
      rootContainer: {
        createRequestScope() {
          return {
            async dispose() {},
            resolve() {
              return new NativeMultiController();
            },
          };
        },
      } as never,
    });
    const adapter = createBunAdapter({
      hostname: '127.0.0.1',
      port: 4322,
    }) as BunHttpApplicationAdapter;

    await adapter.listen(dispatcher);

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/native-multi/:id': {
          GET: expect.any(Function),
          POST: expect.any(Function),
        },
      });

      const [getResponse, postResponse] = await Promise.all([
        mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4322/native-multi/read')),
        mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4322/native-multi/write', {
          method: 'POST',
        })),
      ]);

      expect(getResponse?.status).toBe(200);
      expect(postResponse?.status).toBe(201);
      await expect(getResponse?.json()).resolves.toEqual({ id: 'read', method: 'GET' });
      await expect(postResponse?.json()).resolves.toEqual({ id: 'write', method: 'POST' });
    } finally {
      await adapter.close();
    }
  });

  it('falls back to fetch-only dispatch for same-shape parameter routes that would change fluo matching semantics', async () => {
    const mockBun = installMockBun();

    @Controller('/items')
    class FirstController {
      @Get('/:firstId')
      first(_input: undefined, context: RequestContext) {
        return { firstId: context.request.params.firstId, route: 'first' };
      }
    }

    @Controller('/items')
    class SecondController {
      @Get('/:secondId')
      second(_input: undefined, context: RequestContext) {
        return { route: 'second', secondId: context.request.params.secondId };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [FirstController, SecondController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4315,
    });

    try {
      expect(mockBun.lastOptions?.routes).toBeUndefined();

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4315/items/123'));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ firstId: '123', route: 'first' });
    } finally {
      await app.close();
    }
  });

  it('keeps ALL handlers on fetch-only dispatch without native route registration', async () => {
    const mockBun = installMockBun();

    @Controller('/catch-all')
    class CatchAllController {
      @All('/:slug')
      handle(_input: undefined, context: RequestContext) {
        return {
          method: context.request.method,
          slug: context.request.params.slug,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [CatchAllController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4316,
    });

    try {
      expect(mockBun.lastOptions?.routes).toBeUndefined();

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4316/catch-all/fallback-check', {
        method: 'POST',
      }));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({
        method: 'POST',
        slug: 'fallback-check',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps version-sensitive Bun routes on fetch-only dispatch', async () => {
    const mockBun = installMockBun();

    @Controller('/versions')
    class VersionedController {
      @Get('/')
      @Version('1')
      v1() {
        return { route: 'version', version: '1' };
      }

      @Get('/')
      latest() {
        return { route: 'version', version: 'latest' };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [VersionedController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4323,
      versioning: {
        header: 'x-api-version',
        type: VersioningType.HEADER,
      },
    });

    try {
      expect(mockBun.lastOptions?.routes).toBeUndefined();

      const [versionedResponse, latestResponse] = await Promise.all([
        mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4323/versions', {
          headers: { 'x-api-version': '1' },
        })),
        mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4323/versions')),
      ]);

      expect(versionedResponse?.status).toBe(200);
      expect(latestResponse?.status).toBe(200);
      await expect(versionedResponse?.json()).resolves.toEqual({ route: 'version', version: '1' });
      await expect(latestResponse?.json()).resolves.toEqual({ route: 'version', version: 'latest' });
    } finally {
      await app.close();
    }
  });

  it('falls back to generic dispatch for normalization-sensitive Bun native requests', async () => {
    const mockBun = installMockBun();

    @Controller('/normalize')
    class NormalizeController {
      @Get('/:itemId')
      getItem(_input: undefined, context: RequestContext) {
        return { itemId: context.request.params.itemId };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [NormalizeController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4324,
    });

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/normalize/:itemId': {
          GET: expect.any(Function),
        },
      });

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4324/normalize//abc/'));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ itemId: 'abc' });
    } finally {
      await app.close();
    }
  });

  it('keeps OPTIONS CORS preflight on shared middleware for Bun native routes', async () => {
    const mockBun = installMockBun();

    @Controller('/cors')
    class CorsController {
      @Get('/')
      getCors() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [CorsController] });

    const app = await runBunApplication(AppModule, {
      cors: 'https://client.test',
      hostname: '127.0.0.1',
      port: 4325,
    });

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/cors': {
          GET: expect.any(Function),
          OPTIONS: expect.any(Function),
        },
      });

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4325/cors', {
        headers: { origin: 'https://client.test' },
        method: 'OPTIONS',
      }));

      expect(response?.status).toBe(204);
      expect(response?.headers.get('access-control-allow-origin')).toBe('https://client.test');
      expect(response?.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    } finally {
      await app.close();
    }
  });

  it('falls back to fetch-only dispatch on Bun versions below 1.2.3', async () => {
    const mockBun = installMockBun({ version: '1.2.2' });

    @Controller('/version-gate')
    class VersionGateController {
      @Get('/:itemId')
      getItem(_input: undefined, context: RequestContext) {
        return { itemId: context.request.params.itemId };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [VersionGateController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4317,
    });

    try {
      expect(mockBun.lastOptions?.routes).toBeUndefined();

      const response = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4317/version-gate/legacy-runtime'));

      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ itemId: 'legacy-runtime' });
    } finally {
      await app.close();
    }
  });

  it('preserves shared dispatcher error responses for both native-route and fetch-only fallback requests', async () => {
    const mockBun = installMockBun();

    @Controller('/errors')
    class ErrorController {
      @Get('/native')
      nativeRoute() {
        throw new Error('native boom');
      }

      @All('/fallback')
      fallbackRoute() {
        throw new Error('fallback boom');
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [ErrorController] });

    const app = await runBunApplication(AppModule, {
      hostname: '127.0.0.1',
      port: 4318,
    });

    try {
      expect(mockBun.lastOptions?.routes).toMatchObject({
        '/errors/native': {
          GET: expect.any(Function),
        },
      });
      expect(mockBun.lastOptions?.routes?.['/errors/fallback']).toBeUndefined();

      const [nativeResponse, fallbackResponse] = await Promise.all([
        mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4318/errors/native', {
          headers: { 'x-request-id': 'req-bun-native-error' },
        })),
        mockBun.lastServer?.fetch(new Request('http://127.0.0.1:4318/errors/fallback', {
          headers: { 'x-request-id': 'req-bun-fallback-error' },
          method: 'POST',
        })),
      ]);

      expect(nativeResponse?.status).toBe(500);
      expect(fallbackResponse?.status).toBe(500);
      await expect(nativeResponse?.json()).resolves.toMatchObject({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error.',
          requestId: 'req-bun-native-error',
          status: 500,
        },
      });
      await expect(fallbackResponse?.json()).resolves.toMatchObject({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error.',
          requestId: 'req-bun-fallback-error',
          status: 500,
        },
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
      expect(loggerEvents).toContain('log:FluoFactory:Listening on http://127.0.0.1:4312');
      expect(process.listeners(signal).length).toBe(listenersBefore + 1);
    } finally {
      await app.close();
    }

    expect(process.listeners(signal).length).toBe(listenersBefore);
  });

  it('marks shutdown timeout via exitCode without forcing process termination', async () => {
    vi.useFakeTimers();

    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log() {},
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

    const originalExitCode = process.exitCode;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as typeof process.exit);
    const app = await runBunApplication(AppModule, {
      forceExitTimeoutMs: 25,
      hostname: '127.0.0.1',
      logger,
      port: 4313,
      shutdownSignals: ['SIGTERM'],
    });

    const originalClose = app.close.bind(app);
    app.close = () => new Promise<void>(() => {});

    try {
      expect(mockBun.lastServer).toBeDefined();

      process.emit('SIGTERM', 'SIGTERM');
      await vi.advanceTimersByTimeAsync(26);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(loggerEvents).toContain(
        'error:FluoFactory:Shutdown timeout exceeded after 25ms; leaving process termination to the host.:none',
      );
    } finally {
      app.close = originalClose;
      await app.close();
      exitSpy.mockRestore();
      process.exitCode = originalExitCode;
      vi.useRealTimers();
    }
  });

  it('drains in-flight requests before Bun close resolves', async () => {
    const mockBun = installMockBun();
    const adapter = createBunAdapter() as BunHttpApplicationAdapter;
    const deferred = createDeferred<void>();
    let closeSettled = false;

    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        await deferred.promise;
        response.setStatus(200);
        await response.send({ ok: true });
      },
    });

    const responsePromise = mockBun.lastServer!.fetch(new Request('http://127.0.0.1:3000/drain'));
    const closePromise = adapter.close().then(() => {
      closeSettled = true;
    });

    await Promise.resolve();

    expect(closeSettled).toBe(false);
    expect(mockBun.lastServer?.stop).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await expect(responsePromise).resolves.toBeInstanceOf(Response);
    await closePromise;

    expect(closeSettled).toBe(true);
    expect(adapter.getServer()).toBeUndefined();
  });

  it('clears the shutdown timeout handle after close resolves', async () => {
    vi.useFakeTimers();

    try {
      const mockBun = installMockBun();
      const adapter = createBunAdapter() as BunHttpApplicationAdapter;
      const deferred = createDeferred<void>();

      await adapter.listen({
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          await deferred.promise;
          response.setStatus(200);
        },
      });

      const responsePromise = mockBun.lastServer!.fetch(new Request('http://127.0.0.1:3000/timer-cleanup'));
      const closePromise = adapter.close();

      expect(vi.getTimerCount()).toBe(1);

      deferred.resolve();
      await Promise.resolve();
      await responsePromise;
      await closePromise;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the Bun dispatcher until drain settles even when close() times out', async () => {
    vi.useFakeTimers();

    try {
      const mockBun = installMockBun();
      const adapter = createBunAdapter() as BunHttpApplicationAdapter;
      const deferred = createDeferred<void>();
      const dispatcher = {
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          await deferred.promise;
          response.setStatus(200);
          await response.send({ ok: true });
        },
      };

      await adapter.listen(dispatcher);

      const responsePromise = mockBun.lastServer!.fetch(new Request('http://127.0.0.1:3000/timeout-check'));
      await Promise.resolve();
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

  it('throws a clear error when Bun.serve() is unavailable', async () => {
    delete (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;

    const adapter = createBunAdapter();

    await expect(adapter.listen({ dispatch: async () => undefined })).rejects.toThrow(
      'Bun adapter requires globalThis.Bun.serve()',
    );
  });

  it('reports supported fetch-style websocket hosting for the official Bun binding seam', () => {
    const adapter = createBunAdapter();

    expect(adapter.getRealtimeCapability?.()).toEqual({
      contract: 'raw-websocket-expansion',
      kind: 'fetch-style',
      mode: 'request-upgrade',
      reason:
        'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @fluojs/websockets/bun for the official raw websocket binding.',
      support: 'supported',
      version: 1,
    });
  });

  it('delegates websocket upgrade requests through a configured Bun websocket binding before HTTP dispatch', async () => {
    const mockBun = installMockBun();
    const adapter = new BunHttpApplicationAdapter();
    const dispatcher = {
      dispatch: vi.fn(async (_request: FrameworkRequest, response: FrameworkResponse) => {
        response.setStatus(200);
      }),
      describeRoutes: () => [createMockDispatcherRoute('/chat')],
    };
    const bindingFetch = vi.fn<BunWebSocketBinding['fetch']>(async (request, server) => {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const upgraded = server.upgrade(request, { data: { path: '/chat' } });
        return upgraded ? undefined : new Response(null, { status: 400 });
      }

      return undefined;
    });

    adapter.configureWebSocketBinding({
      fetch: bindingFetch,
      websocket: {},
    });

    await adapter.listen(dispatcher);

    expect(mockBun.lastOptions?.routes).toMatchObject({
      '/chat': {
        GET: expect.any(Function),
      },
    });

    const upgradeResponse = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:3000/chat', {
      headers: { upgrade: 'websocket' },
    }));
    const httpResponse = await mockBun.lastServer?.fetch(new Request('http://127.0.0.1:3000/chat'));

    expect(mockBun.lastOptions?.websocket).toBeDefined();
    expect(upgradeResponse).toBeUndefined();
    expect(mockBun.lastServer?.upgrade).toHaveBeenCalledTimes(1);
    expect(httpResponse?.status).toBe(200);
    expect(bindingFetch).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});
