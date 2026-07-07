import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Controller,
  Get,
  Post,
  type FrameworkRequest,
  type FrameworkResponse,
  type RequestContext,
} from '@fluojs/http';
import { defineModule, fluoFactory } from '@fluojs/runtime';
import * as runtimeWeb from '@fluojs/runtime/web';

import {
  bootstrapCloudflareWorkerApplication,
  CloudflareWorkerHttpApplicationAdapter,
  createCloudflareWorkerAdapter,
  createCloudflareWorkerEntrypoint,
  type CloudflareWorkerWebSocket,
  type CloudflareWorkerWebSocketBinding,
  type CloudflareWorkerWebSocketPair,
  type CloudflareWorkerExecutionContext,
} from './adapter.js';

function createExecutionContext(): CloudflareWorkerExecutionContext {
  return {
    waitUntil() {},
  };
}

function createMockWorkerWebSocket(): CloudflareWorkerWebSocket {
  const listeners = {
    close: [] as Array<(event: Event) => void>,
    error: [] as Array<(event: Event) => void>,
    message: [] as Array<(event: MessageEvent<string>) => void>,
  };
  let readyState = 1;

  return {
    accept() {},
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

      listeners.message.push(callback as (event: MessageEvent<string>) => void);
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

function createWebSocketPairStub() {
  return vi.fn<() => CloudflareWorkerWebSocketPair>(() => ({
    0: createMockWorkerWebSocket(),
    1: createMockWorkerWebSocket(),
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('@fluojs/platform-cloudflare-workers', () => {
  it('rejects invalid explicit numeric adapter options during setup', () => {
    expect(() => createCloudflareWorkerAdapter({ maxBodySize: -1 })).toThrow(/maxBodySize/i);
    expect(() => createCloudflareWorkerAdapter({ maxBodySize: 1.5 })).toThrow(/maxBodySize/i);
  });

  it('keeps edge runtime README conformance coverage aligned across English and Korean docs', () => {
    const englishReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const koreanReadme = readFileSync(new URL('../README.ko.md', import.meta.url), 'utf8');

    for (const readme of [englishReadme, koreanReadme]) {
      expect(readme).toContain('Cloudflare Workers');
      expect(readme).toContain('executionContext.waitUntil(...)');
      expect(readme).toContain('10');
      expect(readme).toContain('503');
      expect(readme).toContain('packages/platform-cloudflare-workers/src/adapter.test.ts');
      expect(readme).toContain('packages/testing/src/portability/web-runtime-adapter-portability.test.ts');
    }
  });

  it('keeps the Worker adapter runtime import path free of the HTTP root barrel', () => {
    const source = readFileSync(new URL('./adapter.ts', import.meta.url), 'utf8');

    expect(source).toContain("from '@fluojs/http/internal'");
    expect(source).toMatch(/import type \{[\s\S]*\} from '@fluojs\/http';/);
    expect(source).not.toMatch(/^import \{(?:\n(?!import ).*)*\n\} from '@fluojs\/http';/m);
  });

  it('keeps Worker bootstrap on the transport-neutral default logger', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    class AppModule {}
    defineModule(AppModule, {});

    const worker = await bootstrapCloudflareWorkerApplication(AppModule);

    try {
      expect(log).toHaveBeenCalledWith('[fluo] LOG [FluoFactory] Starting fluo application...');
      expect(log).not.toHaveBeenCalledWith(
        expect.stringContaining(`[fluo] ${String(process.pid)} -`),
      );
    } finally {
      await worker.close();
    }
  });

  it('delegates Worker fetch handling to the shared web adapter core', async () => {
    const adapter = createCloudflareWorkerAdapter({ rawBody: true });
    const dispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(204);
      },
    };
    const sharedResponse = new Response(null, { status: 202 });
    const dispatchSpy = vi
      .spyOn(runtimeWeb, 'dispatchWebRequest')
      .mockResolvedValue(sharedResponse);

    await adapter.listen(dispatcher);

    const request = new Request('https://worker.test/hooks/stripe', {
      body: JSON.stringify({ provider: 'stripe' }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const response = await adapter.fetch(request, {}, createExecutionContext());

    expect(response).toBe(sharedResponse);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcher,
        factory: expect.objectContaining({
          materializeRequest: expect.any(Function),
        }),
        request,
      }),
    );
  });

  it('exposes a supported fetch-style raw websocket expansion contract for Worker runtimes', async () => {
    const adapter = createCloudflareWorkerAdapter();

    expect(adapter.getRealtimeCapability()).toEqual({
      contract: 'raw-websocket-expansion',
      kind: 'fetch-style',
      mode: 'request-upgrade',
      reason:
        'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @fluojs/websockets/cloudflare-workers for the official raw websocket binding.',
      support: 'supported',
      version: 1,
    });
  });

  it('delegates websocket upgrade requests through a configured Worker websocket binding before HTTP dispatch', async () => {
    const createWebSocketPair = createWebSocketPairStub();
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair,
    });
    const dispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(200);
      },
    };
    const bindingFetch = vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async (request, host) => {
      const upgraded = host.upgrade(request);

      expect(upgraded.serverSocket).toBeDefined();
      return upgraded.response;
    });

    adapter.configureWebSocketBinding({
      fetch: bindingFetch,
    });

    await adapter.listen(dispatcher);

    const upgradeResponse = await adapter.fetch(
      new Request('https://worker.test/chat', {
        headers: { upgrade: 'websocket' },
      }),
      {},
      createExecutionContext(),
    );
    const httpResponse = await adapter.fetch(new Request('https://worker.test/http'), {}, createExecutionContext());

    expect(upgradeResponse.status).toBe(101);
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    expect(createWebSocketPair).toHaveBeenCalledTimes(1);
    expect(httpResponse.status).toBe(200);
  });

  it('keeps websocket upgrades behind the dispatcher listen boundary', async () => {
    const createWebSocketPair = createWebSocketPairStub();
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair,
    });
    const bindingFetch = vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async (request, host) => {
      const upgraded = host.upgrade(request);

      expect(upgraded.serverSocket).toBeDefined();
      return upgraded.response;
    });

    adapter.configureWebSocketBinding({
      fetch: bindingFetch,
    });

    const response = await adapter.fetch(
      new Request('https://worker.test/chat', {
        headers: { upgrade: 'websocket' },
      }),
      {},
      createExecutionContext(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: 'Internal server error.',
      },
    });
    expect(bindingFetch).not.toHaveBeenCalled();
    expect(createWebSocketPair).not.toHaveBeenCalled();
  });

  it('keeps pre-listen HTTP requests behind the dispatcher lifecycle boundary', async () => {
    let handlerCalls = 0;

    @Controller('/guarded')
    class GuardedController {
      @Get('/')
      getGuarded() {
        handlerCalls += 1;
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [GuardedController],
    });

    const adapter = createCloudflareWorkerAdapter();
    const app = await fluoFactory.create(AppModule, {
      adapter,
    });

    try {
      const response = await adapter.fetch(
        new Request('https://worker.test/guarded'),
        {},
        createExecutionContext(),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          message: 'Internal server error.',
        },
      });
      expect(handlerCalls).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('rejects live Worker websocket binding mutations after listen starts', async () => {
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair: createWebSocketPairStub(),
    });
    const initialBinding = {
      fetch: vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async () => new Response(null, { status: 426 })),
    };
    const replacementBinding = {
      fetch: vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async () => new Response(null, { status: 426 })),
    };

    adapter.configureWebSocketBinding(initialBinding);
    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(204);
      },
    });

    try {
      expect(() => adapter.configureWebSocketBinding(replacementBinding)).toThrow(
        'Cloudflare Workers websocket binding must be configured before listen() starts accepting Worker requests.',
      );
      expect(() => adapter.configureWebSocketBinding(undefined)).toThrow(
        'Cloudflare Workers websocket binding must be configured before listen() starts accepting Worker requests.',
      );
      expect(() => adapter.configureWebSocketBinding(initialBinding)).not.toThrow();
    } finally {
      await adapter.close();
    }
  });

  it('boots a Worker application that reuses shared runtime middleware and Web request handling', async () => {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/stripe')
      handle(_input: undefined, context: RequestContext) {
        return {
          path: context.request.path,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
          userAgent: context.request.headers['user-agent'],
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const worker = await bootstrapCloudflareWorkerApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      rawBody: true,
    });

    try {
      const response = await worker.fetch(
        new Request('https://worker.test/api/webhooks/stripe', {
          body: JSON.stringify({ provider: 'stripe' }),
          headers: {
            'content-type': 'application/json',
            'user-agent': 'vitest-worker',
          },
          method: 'POST',
        }),
        {},
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        path: '/api/webhooks/stripe',
        raw: '{"provider":"stripe"}',
        userAgent: 'vitest-worker',
      });
    } finally {
      await worker.close();
    }
  });

  it('registers request lifecycle work with executionContext.waitUntil', async () => {
    const adapter = createCloudflareWorkerAdapter();
    const deferred = createDeferred<Response>();
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);

    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        const settled = await deferred.promise;
        response.setStatus(settled.status);
        await response.send({ ok: true });
      },
    });

    const fetchPromise = adapter.fetch(
      new Request('https://worker.test/lifecycle'),
      {},
      { waitUntil },
    );

    expect(waitUntil).toHaveBeenCalledTimes(1);

    deferred.resolve(new Response(null, { status: 200 }));
    await fetchPromise;
  });

  it('passes Worker env and execution context through the framework request boundary', async () => {
    const adapter = createCloudflareWorkerAdapter();
    const env = { API_KEY: 'worker-secret' };
    const executionContext = createExecutionContext();

    await adapter.listen({
      async dispatch(request: FrameworkRequest, response: FrameworkResponse) {
        expect(request.cloudflare?.env).toBe(env);
        expect(request.cloudflare?.executionContext).toBe(executionContext);
        response.setStatus(200);
        await response.send({ ok: true });
      },
    });

    const response = await adapter.fetch(
      new Request('https://worker.test/env'),
      env,
      executionContext,
    );

    expect(response.status).toBe(200);
    await adapter.close();
  });

  it('keeps waitUntil and close drains open until streaming response bodies finish', async () => {
    const adapter = createCloudflareWorkerAdapter();
    const waitUntilPromises: Array<Promise<unknown>> = [];
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closeSettled = false;
    const streamingResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(new Uint8Array([1]));
      },
    }), {
      headers: { 'content-type': 'text/event-stream' },
    });
    const dispatchSpy = vi
      .spyOn(runtimeWeb, 'dispatchWebRequest')
      .mockResolvedValue(streamingResponse);

    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(200);
      },
    });

    const response = await adapter.fetch(
      new Request('https://worker.test/stream'),
      {},
      { waitUntil: (promise) => { waitUntilPromises.push(promise); } },
    );
    const closePromise = adapter.close().then(() => {
      closeSettled = true;
    });
    let waitUntilSettled = false;
    void waitUntilPromises[0]?.then(() => {
      waitUntilSettled = true;
    });

    await Promise.resolve();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(waitUntilPromises).toHaveLength(1);
    expect(waitUntilSettled).toBe(false);
    expect(closeSettled).toBe(false);

    if (!response.body) {
      throw new Error('Expected a streaming response body.');
    }

    const reader = response.body.getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    expect(closeSettled).toBe(false);

    if (!streamController) {
      throw new Error('Expected the streaming response controller to be initialized.');
    }

    streamController.close();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    await waitUntilPromises[0];
    await closePromise;

    expect(waitUntilSettled).toBe(true);
    expect(closeSettled).toBe(true);
  });

  it('keeps the dispatcher until an in-flight Worker request settles during close', async () => {
    const adapter = createCloudflareWorkerAdapter();
    const deferred = createDeferred<void>();
    const dispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        await deferred.promise;
        response.setStatus(200);
        await response.send({ ok: true });
      },
    };
    let closeSettled = false;

    await adapter.listen(dispatcher);

    const responsePromise = adapter.fetch(new Request('https://worker.test/drain'), {}, createExecutionContext());
    const closePromise = adapter.close().then(() => {
      closeSettled = true;
    });

    await Promise.resolve();

    expect(closeSettled).toBe(false);
    expect(Reflect.get(adapter, 'dispatcher')).toBe(dispatcher);

    const shutdownResponse = await adapter.fetch(new Request('https://worker.test/closing'), {}, createExecutionContext());

    expect(shutdownResponse.status).toBe(503);
    await expect(shutdownResponse.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
      },
    });

    deferred.resolve();

    await responsePromise;
    await closePromise;

    expect(closeSettled).toBe(true);
    expect(Reflect.get(adapter, 'dispatcher')).toBeUndefined();

    const closedResponse = await adapter.fetch(new Request('https://worker.test/closed'), {}, createExecutionContext());

    expect(closedResponse.status).toBe(503);
  });

  it('rejects listen while Worker close is still draining and keeps shutdown responses stable', async () => {
    const adapter = createCloudflareWorkerAdapter();
    const deferred = createDeferred<void>();
    const originalDispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        await deferred.promise;
        response.setStatus(200);
        await response.send({ ok: true });
      },
    };
    const replacementDispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(204);
      },
    };

    await adapter.listen(originalDispatcher);

    const inFlightResponse = adapter.fetch(new Request('https://worker.test/drain'), {}, createExecutionContext());

    await Promise.resolve();

    const closePromise = adapter.close();

    await expect(adapter.listen(replacementDispatcher)).rejects.toThrow(
      'Cloudflare Workers adapter cannot listen while shutdown is still draining.',
    );
    expect(Reflect.get(adapter, 'dispatcher')).toBe(originalDispatcher);

    const closingHttpResponse = await adapter.fetch(new Request('https://worker.test/closing'), {}, createExecutionContext());

    expect(closingHttpResponse.status).toBe(503);
    await expect(closingHttpResponse.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
      },
    });

    deferred.resolve();

    await inFlightResponse;
    await closePromise;

    const closedHttpResponse = await adapter.fetch(new Request('https://worker.test/closed'), {}, createExecutionContext());

    expect(closedHttpResponse.status).toBe(503);
    expect(Reflect.get(adapter, 'dispatcher')).toBeUndefined();

    await adapter.listen(replacementDispatcher);

    const reopenedResponse = await adapter.fetch(new Request('https://worker.test/reopened'), {}, createExecutionContext());

    expect(reopenedResponse.status).toBe(204);
  });

  it('returns shutdown JSON instead of upgrading WebSocket requests after close', async () => {
    const createWebSocketPair = createWebSocketPairStub();
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair,
    });
    const bindingFetch = vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async (request, host) => {
      const upgraded = host.upgrade(request);

      expect(upgraded.serverSocket).toBeDefined();
      return upgraded.response;
    });

    adapter.configureWebSocketBinding({
      fetch: bindingFetch,
    });

    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(200);
      },
    });
    await adapter.close();

    const response = await adapter.fetch(
      new Request('https://worker.test/chat', {
        headers: { upgrade: 'websocket' },
      }),
      {},
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
      },
    });
    expect(bindingFetch).not.toHaveBeenCalled();
    expect(createWebSocketPair).not.toHaveBeenCalled();
  });

  it('returns shutdown JSON instead of upgrading WebSocket requests while close is draining', async () => {
    const createWebSocketPair = createWebSocketPairStub();
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair,
    });
    const deferred = createDeferred<void>();
    const bindingFetch = vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async (request, host) => {
      const upgraded = host.upgrade(request);

      expect(upgraded.serverSocket).toBeDefined();
      return upgraded.response;
    });

    adapter.configureWebSocketBinding({
      fetch: bindingFetch,
    });

    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        await deferred.promise;
        response.setStatus(200);
        await response.send({ ok: true });
      },
    });

    const inFlightResponse = adapter.fetch(new Request('https://worker.test/drain'), {}, createExecutionContext());

    await Promise.resolve();

    const closePromise = adapter.close();
    const response = await adapter.fetch(
      new Request('https://worker.test/chat', {
        headers: { upgrade: 'websocket' },
      }),
      {},
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
      },
    });
    expect(bindingFetch).not.toHaveBeenCalled();
    expect(createWebSocketPair).not.toHaveBeenCalled();

    deferred.resolve();

    await inFlightResponse;
    await closePromise;
  });

  it('bounds Worker close() while preserving shutdown responses for new requests', async () => {
    vi.useFakeTimers();

    try {
      const adapter = createCloudflareWorkerAdapter();
      const neverSettles = new Promise<void>(() => {});

      await adapter.listen({
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          await neverSettles;
          response.setStatus(200);
          await response.send({ ok: true });
        },
      });

      void adapter.fetch(new Request('https://worker.test/stuck'), {}, createExecutionContext());
      await Promise.resolve();

      const closePromise = adapter.close();
      const shutdownResponse = await adapter.fetch(new Request('https://worker.test/closing'), {}, createExecutionContext());

      expect(shutdownResponse.status).toBe(503);
      await expect(shutdownResponse.json()).resolves.toMatchObject({
        error: {
          code: 'SERVICE_UNAVAILABLE',
        },
      });

      const closeAssertion = expect(closePromise).rejects.toThrow(
        'Cloudflare Workers adapter shutdown timeout exceeded 10000ms.',
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await closeAssertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a lazy Worker entrypoint that bootstraps once and reuses the bound dispatcher', async () => {
    let bootstrapCount = 0;

    class StartupProbe {
      onApplicationBootstrap() {
        bootstrapCount += 1;
      }
    }

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
      providers: [StartupProbe],
    });

    const entrypoint = createCloudflareWorkerEntrypoint(AppModule, {
      cors: false,
    });

    try {
      const [first, second] = await Promise.all([
        entrypoint.fetch(new Request('https://worker.test/health'), {}, createExecutionContext()),
        entrypoint.fetch(new Request('https://worker.test/health'), {}, createExecutionContext()),
      ]);

      expect(bootstrapCount).toBe(1);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ ok: true });
      await expect(second.json()).resolves.toEqual({ ok: true });
    } finally {
      await entrypoint.close();
    }
  });

  it('does not reopen a lazy Worker entrypoint while close is draining the current application', async () => {
    let bootstrapCount = 0;
    const deferred = createDeferred<void>();

    class StartupProbe {
      onApplicationBootstrap() {
        bootstrapCount += 1;
      }
    }

    @Controller('/slow')
    class SlowController {
      @Get('/')
      async getSlow() {
        await deferred.promise;
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [SlowController],
      providers: [StartupProbe],
    });

    const entrypoint = createCloudflareWorkerEntrypoint(AppModule, {
      cors: false,
    });

    try {
      await entrypoint.ready();

      const firstFetch = entrypoint.fetch(new Request('https://worker.test/slow'), {}, createExecutionContext());

      await Promise.resolve();

      const closePromise = entrypoint.close();
      const secondFetch = await entrypoint.fetch(new Request('https://worker.test/slow'), {}, createExecutionContext());

      expect(secondFetch.status).toBe(503);
      expect(bootstrapCount).toBe(1);

      deferred.resolve();

      const firstResponse = await firstFetch;
      await closePromise;

      expect(firstResponse.status).toBe(200);
      await expect(firstResponse.json()).resolves.toEqual({ ok: true });
      expect(bootstrapCount).toBe(1);
    } finally {
      deferred.resolve();
      await entrypoint.close();
    }
  });

  it('keeps lazy Worker entrypoint shutdown gating until timed-out close eventually settles', async () => {
    vi.useFakeTimers();

    const deferred = createDeferred<void>();
    let entrypoint: ReturnType<typeof createCloudflareWorkerEntrypoint> | undefined;

    try {
      let bootstrapCount = 0;

      class StartupProbe {
        onApplicationBootstrap() {
          bootstrapCount += 1;
        }
      }

      @Controller('/slow')
      class SlowController {
        @Get('/')
        async getSlow() {
          await deferred.promise;
          return { ok: true };
        }
      }

      @Controller('/health')
      class HealthController {
        @Get('/')
        getHealth() {
          return { ok: true };
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        controllers: [HealthController, SlowController],
        providers: [StartupProbe],
      });

      entrypoint = createCloudflareWorkerEntrypoint(AppModule, {
        cors: false,
      });

      await entrypoint.ready();

      const firstFetch = entrypoint.fetch(new Request('https://worker.test/slow'), {}, createExecutionContext());
      await Promise.resolve();

      const closePromise = entrypoint.close();
      const closeAssertion = expect(closePromise).rejects.toThrow(
        'Cloudflare Workers adapter shutdown timeout exceeded 10000ms.',
      );

      await vi.advanceTimersByTimeAsync(10_000);
      await closeAssertion;

      const followUpResponse = await entrypoint.fetch(
        new Request('https://worker.test/health'),
        {},
        createExecutionContext(),
      );

      expect(followUpResponse.status).toBe(503);
      expect(bootstrapCount).toBe(1);

      deferred.resolve();

      const firstResponse = await firstFetch;
      expect(firstResponse.status).toBe(200);
      await expect(firstResponse.json()).resolves.toEqual({ ok: true });

      await entrypoint.ready();
      expect(bootstrapCount).toBe(2);

      const recoveredResponse = await entrypoint.fetch(
        new Request('https://worker.test/health'),
        {},
        createExecutionContext(),
      );

      expect(recoveredResponse.status).toBe(200);
      await expect(recoveredResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      deferred.resolve();
      await entrypoint?.close();
      vi.useRealTimers();
    }
  });
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
