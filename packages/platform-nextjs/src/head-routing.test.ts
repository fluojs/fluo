import { Module, Scope } from '@fluojs/core';
import {
  All,
  Controller,
  createByteRangeResponse,
  Get,
  type GuardContext,
  Head,
  type MiddlewareContext,
  type Next,
  NotFoundException,
  type RequestContext,
  Sse,
  SseResponse,
  UseGuards,
} from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createNextAdapter,
  createNextAppRouterHandler,
  type NextAdapterOptions,
} from './index.js';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

it('selects GET once for an opted-in HEAD request without rewriting its method', async () => {
  // Given a real GET-only Fluo application.
  const methods: string[] = [];
  @Controller('/articles')
  class ArticlesController {
    @Get('/:id')
    get(_input: undefined, context: RequestContext) {
      methods.push(context.request.method);
      context.response.setHeader('x-article', context.request.params.id);
      return { title: 'Fluo' };
    }
  }
  @Module({ controllers: [ArticlesController] })
  class AppModule {}
  const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
  const app = await FluoFactory.create(AppModule, { adapter });
  try {
    await app.listen();
    // When Next invokes GET with the original HEAD request.
    const response = await adapter.GET(new Request('https://next.test/articles/42', {
      method: 'HEAD',
    }));
    // Then one GET handler supplies metadata without a response body.
    expect(response.status).toBe(200);
    expect(response.headers.get('x-article')).toBe('42');
    expect(methods).toEqual(['HEAD']);
    expect(response.body).toBeNull();
  } finally {
    await app.close();
  }
});

describe('HEAD route selection and single execution', () => {
  it.each([
    { path: 'get', status: 200, selected: 'get' },
    { path: 'explicit', status: 202, selected: 'head' },
    { path: 'head-not-found', status: 404, selected: 'head-404' },
    { path: 'get-not-found', status: 404, selected: 'get-404' },
    { path: 'all', status: 203, selected: 'all' },
    { path: 'missing', status: 404, selected: undefined },
  ])('selects $selected for $path without retrying a response', async ({ path, status, selected }) => {
    // Given real middleware, guards, observers, and controller dispatch.
    const events: string[] = [];
    function handle(name: string, context: RequestContext, code = 200) {
      events.push(name);
      expect(context.request.method).toBe('HEAD');
      expect(context.request.raw).toBe(request);
      context.response.setStatus(code);
      context.response.setHeader('x-selected', name);
      context.response.setHeader('set-cookie', ['first=1', 'second=2']);
      return { selected: name };
    }
    class Guard {
      canActivate({ requestContext }: GuardContext) {
        events.push(`guard:${requestContext.request.method}`);
        return true;
      }
    }
    class ModuleMiddleware {
      async handle(context: MiddlewareContext, next: Next) {
        events.push(`module:${context.request.method}`);
        await next();
      }
    }
    @Controller('/routes')
    @UseGuards(Guard)
    class Routes {
      @Get('/get')
      get(_input: undefined, context: RequestContext) { return handle('get', context); }
      @Get('/explicit')
      explicitGet(_input: undefined, context: RequestContext) { return handle('wrong-get', context); }
      @Head('/explicit')
      head(_input: undefined, context: RequestContext) { return handle('head', context, 202); }
      @Get('/head-not-found')
      notFoundGet(_input: undefined, context: RequestContext) { return handle('wrong-retry', context); }
      @Head('/head-not-found')
      head404(_input: undefined, context: RequestContext) { return handle('head-404', context, 404); }
      @Get('/get-not-found')
      get404(_input: undefined, context: RequestContext) { return handle('get-404', context, 404); }
      @Get('/all')
      allGet(_input: undefined, context: RequestContext) { return handle('wrong-all-get', context); }
      @All('/all')
      all(_input: undefined, context: RequestContext) { return handle('all', context, 203); }
    }
    @Module({ controllers: [Routes], middleware: [ModuleMiddleware], providers: [Guard] })
    class AppModule {}
    const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
    const app = await FluoFactory.create(AppModule, {
      adapter,
      middleware: [{
        async handle(context, next) {
          events.push(`app:${context.request.method}`);
          await next();
        },
      }],
      observers: [{ onRequestFinish() { events.push('finish'); } }],
    });
    const request = new Request(`https://next.test/routes/${path}`, { method: 'HEAD' });
    try {
      await app.listen();
      // When a direct HEAD export receives the request.
      const response = await adapter.HEAD(request);
      // Then the complete pipeline runs at most once, including handler-produced 404s.
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe('');
      expect(response.headers.get('x-selected')).toBe(selected ?? null);
      expect(events).toEqual(selected
        ? ['app:HEAD', 'module:HEAD', 'guard:HEAD', selected, 'finish']
        : ['app:HEAD', 'finish']);
      if (selected) expect(response.headers.getSetCookie()).toEqual(['first=1', 'second=2']);
    } finally {
      await app.close();
    }
  });

  it('keeps GET-only routes unmatched when the policy is omitted', async () => {
    // Given the existing default adapter.
    @Controller('/default')
    class Routes {
      @Get()
      get() { throw new Error('HEAD must not invoke GET by default'); }
    }
    @Module({ controllers: [Routes] })
    class AppModule {}
    const adapter = createNextAdapter();
    const app = await FluoFactory.create(AppModule, { adapter });
    try {
      await app.listen();
      // When HEAD has no explicit handler.
      const response = await adapter.HEAD(new Request('https://next.test/default', { method: 'HEAD' }));
      // Then the ordinary route miss is preserved.
      expect(response.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('keeps concurrent HEAD fallback and GET requests isolated behind one lazy loader', async () => {
    // Given two requests held inside the same handler until both arrive.
    const arrived = deferred();
    const release = deferred();
    const methods: string[] = [];
    @Controller('/concurrent')
    class Routes {
      @Get()
      async get(_input: undefined, context: RequestContext) {
        methods.push(context.request.method);
        if (methods.length === 2) arrived.resolve();
        await release.promise;
        context.response.setHeader('x-method', context.request.method);
        return context.request.method;
      }
    }
    @Module({ controllers: [Routes] })
    class AppModule {}
    const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
    const app = await FluoFactory.create(AppModule, { adapter });
    let loads = 0;
    const handlers = createNextAppRouterHandler(async () => { loads += 1; return adapter; });
    try {
      await app.listen();
      // When both requests overlap at the exact handler-entry event.
      const pending = Promise.all([
        handlers.GET(new Request('https://next.test/concurrent', { method: 'HEAD' })),
        handlers.GET(new Request('https://next.test/concurrent')),
      ]);
      await arrived.promise;
      release.resolve();
      const [head, get] = await pending;
      // Then neither method nor body policy leaks to the other request.
      expect(loads).toBe(1);
      expect(methods.sort()).toEqual(['GET', 'HEAD']);
      expect(head.headers.get('x-method')).toBe('HEAD');
      expect(head.body).toBeNull();
      expect(get.headers.get('x-method')).toBe('GET');
      expect(await get.text()).toBe('GET');
    } finally {
      release.resolve();
      await app.close();
    }
  });
});

describe('HEAD metadata and resource ownership', () => {
  it.each<{
    headers: Record<string, string>;
    status: number;
    length: string | null;
    calls: number;
  }>([
    { headers: {}, status: 200, length: '5', calls: 1 },
    { headers: { range: 'bytes=1-3' }, status: 206, length: '3', calls: 1 },
    { headers: { range: 'bytes=9-' }, status: 416, length: '0', calls: 1 },
    { headers: { 'if-none-match': '"v1"' }, status: 304, length: null, calls: 0 },
    { headers: { 'if-match': '"other"' }, status: 412, length: null, calls: 0 },
  ])('preserves conditional/range status $status without opening a stream', async ({ headers, status, length, calls }) => {
    // Given a representation with exact size and validators.
    let handlerCalls = 0;
    let opened = 0;
    let resolutions = 0;
    @Controller('/bytes')
    class Routes {
      @Get()
      get() {
        handlerCalls += 1;
        return createByteRangeResponse(() => {
          opened += 1;
          return new ReadableStream<Uint8Array>();
        }, { contentType: 'application/octet-stream', size: 5 });
      }
    }
    @Module({ controllers: [Routes] })
    class AppModule {}
    const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
    const app = await FluoFactory.create(AppModule, {
      adapter,
      conditionalRequest: {
        resolve({ request }) {
          resolutions += 1;
          expect(request.method).toBe('HEAD');
          return { exists: true, validators: { etag: { opaqueValue: 'v1', strength: 'strong' } } };
        },
      },
    });
    try {
      await app.listen();
      // When HEAD falls back to the GET representation.
      const response = await adapter.HEAD(new Request('https://next.test/bytes', {
        method: 'HEAD', headers,
      }));
      // Then conditional evaluation and range metadata remain HTTP-owned.
      expect(response.status).toBe(status);
      expect(response.headers.get('etag')).toBe('"v1"');
      expect(response.headers.get('content-length')).toBe(length);
      if (status === 206) expect(response.headers.get('content-range')).toBe('bytes 1-3/5');
      if (status === 416) expect(response.headers.get('content-range')).toBe('bytes */5');
      expect(response.body).toBeNull();
      expect(handlerCalls).toBe(calls);
      expect(resolutions).toBe(1);
      expect(opened).toBe(0);
    } finally {
      await app.close();
    }
  });

  it.each(['manual', 'managed', 'handler-error', 'cleanup-error', 'send'] as const)(
    'cleans request resources for %s before returning an empty HEAD response',
    async (kind) => {
      // Given a request-scoped controller and real Web response stream.
      const events: string[] = [];
      const cleanupStarted = deferred();
      const releaseCleanup = deferred();
      const failure = new Error('iterator cleanup failed');
      const errors: unknown[] = [];
      let stream: SseResponse | undefined;
      let returned = 0;
      @Scope('request')
      @Controller('/lifecycle')
      class Routes {
        @Sse()
        async get(_input: undefined, context: RequestContext) {
          events.push('handler');
          if (kind === 'handler-error') throw new NotFoundException('article missing');
          if (kind === 'send') {
            context.response.setStatus(404);
            await context.response.send('owned body');
            return;
          }
          if (kind === 'manual') {
            stream = new SseResponse(context);
            return stream;
          }
          return {
            [Symbol.asyncIterator](): AsyncIterator<string> {
              return {
                next: () => new Promise(() => undefined),
                async return() {
                  returned += 1;
                  events.push('iterator-return');
                  cleanupStarted.resolve();
                  await releaseCleanup.promise;
                  if (kind === 'cleanup-error') throw failure;
                  return { done: true, value: undefined };
                },
              };
            },
          };
        }
        async onDestroy() { events.push('dispose'); }
      }
      @Module({ controllers: [Routes] })
      class AppModule {}
      const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
      const app = await FluoFactory.create(AppModule, {
        adapter,
        observers: [{
          onRequestError(_context, error) { errors.push(error); },
          onRequestFinish() { events.push('finish'); },
        }],
      });
      try {
        await app.listen();
        // When HEAD cancellation closes the real stream and awaits iterator cleanup.
        const pending = adapter.HEAD(new Request('https://next.test/lifecycle', { method: 'HEAD' }));
        if (kind === 'managed' || kind === 'cleanup-error') {
          await cleanupStarted.promise;
          expect(events).toEqual(['handler', 'iterator-return']);
          releaseCleanup.resolve();
        }
        const response = await pending;
        // Then neither direct sends nor error bodies escape, and the scope is disposed.
        expect(response.status).toBe(kind === 'handler-error' || kind === 'send' ? 404 : 200);
        expect(response.body).toBeNull();
        expect(events.slice(-2)).toEqual(['finish', 'dispose']);
        expect(returned).toBe(kind === 'managed' || kind === 'cleanup-error' ? 1 : 0);
        if (stream) await expect(stream.completion).resolves.toBeUndefined();
        if (kind === 'cleanup-error') expect(errors).toContain(failure);
      } finally {
        releaseCleanup.resolve();
        await app.close();
      }
    },
  );

  it('finishes an aborted HEAD without late success or leaked request scope', async () => {
    // Given a controller paused at an exact entry event.
    const entered = deferred();
    const release = deferred();
    const events: string[] = [];
    @Scope('request')
    @Controller('/abort')
    class Routes {
      @Get()
      async get() {
        entered.resolve();
        await release.promise;
        return 'late body';
      }
      onDestroy() { events.push('dispose'); }
    }
    @Module({ controllers: [Routes] })
    class AppModule {}
    const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
    const app = await FluoFactory.create(AppModule, {
      adapter,
      observers: [{
        onRequestSuccess() { events.push('success'); },
        onRequestFinish() { events.push('finish'); },
      }],
    });
    const abort = new AbortController();
    try {
      await app.listen();
      // When cancellation occurs after handler entry, before its result.
      const pending = adapter.HEAD(new Request('https://next.test/abort', {
        method: 'HEAD', signal: abort.signal,
      }));
      await entered.promise;
      abort.abort();
      release.resolve();
      const response = await pending;
      // Then cleanup completes and no success event or body is committed.
      expect(response.body).toBeNull();
      expect(events).toEqual(['finish', 'dispose']);
    } finally {
      release.resolve();
      await app.close();
    }
  });

  it.each(['not-ready', 'closed'] as const)('returns bodyless 503 when %s', async (state) => {
    // Given an unavailable opt-in adapter.
    const adapter = createNextAdapter({ headRouting: 'explicit-or-get' });
    if (state === 'closed') await adapter.close();
    // When HEAD reaches the adapter boundary.
    const response = await adapter.HEAD(new Request('https://next.test/unavailable', { method: 'HEAD' }));
    // Then failure metadata is preserved without its JSON body.
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.body).toBeNull();
  });

  it('exposes the additive option through public types', () => {
    // Given the public option and normalized request contracts.
    type Policy = 'explicit-or-get' | undefined;
    // When comparing their caller-visible fields.
    expectTypeOf<NextAdapterOptions['headRouting']>().toEqualTypeOf<Policy>();
    // Then adapters and the HTTP matcher share one opt-in shape.
    expectTypeOf<RequestContext['request']['headRouting']>().toEqualTypeOf<Policy>();
  });
});
