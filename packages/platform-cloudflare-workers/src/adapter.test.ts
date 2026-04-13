import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Controller,
  Get,
  Post,
  type FrameworkRequest,
  type FrameworkResponse,
  type RequestContext,
} from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
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
  vi.restoreAllMocks();
});

describe('@fluojs/platform-cloudflare-workers', () => {
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
        rawBody: true,
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
