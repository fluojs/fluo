import { describe, it, vi } from 'vitest';

// @ts-ignore Vitest workspace alias resolution handles package test imports.
import { bootstrapBunApplication, type BunServeOptions, type BunServerLike } from '@fluojs/platform-bun';
// @ts-ignore Vitest workspace alias resolution handles package test imports.
import { bootstrapCloudflareWorkerApplication, type CloudflareWorkerExecutionContext } from '@fluojs/platform-cloudflare-workers';
// @ts-ignore Vitest workspace alias resolution handles package test imports.
import { bootstrapDenoApplication, type DenoServeController, type DenoServeHandler, type DenoServeOptions } from '@fluojs/platform-deno';

import { createWebRuntimeHttpAdapterPortabilityHarness } from './web-runtime-adapter-portability.js';

type MockBunServer = BunServerLike & {
  fetch(request: Request): Promise<Response>;
};

type MockBun = {
  lastServer?: MockBunServer;
  serve: ReturnType<typeof vi.fn<(options: BunServeOptions) => MockBunServer>>;
};

function createExecutionContext(): CloudflareWorkerExecutionContext {
  return {
    waitUntil() {},
  };
}

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

  return {
    get handler() {
      return capturedHandler;
    },
    serve: vi.fn((options: DenoServeOptions, handler: DenoServeHandler): DenoServeController => {
      capturedHandler = handler;

      if (options.onListen) {
        options.onListen({
          hostname: options.hostname ?? '0.0.0.0',
          port: options.port ?? 3000,
        });
      }

      return {
        finished: finished.promise,
        shutdown,
      };
    }),
  };
}

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
      stop() {},
      url: new URL(`${protocol}://${hostname}:${String(port)}`),
    };

    mockBun.lastServer = server;
    return server;
  });

  (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = mockBun;
  return mockBun;
}

function registerWebRuntimePortabilitySuite(
  name: string,
  harness: {
    assertExcludesRawBodyForMultipart(): Promise<void>;
    assertPreservesQueryArraysAndDecoding(): Promise<void>;
    assertPreservesMalformedCookieValues(): Promise<void>;
    assertPreservesRawBodyForJsonAndText(): Promise<void>;
    assertSupportsSseStreaming(): Promise<void>;
  },
): void {
  describe(`${name} web runtime adapter portability`, () => {
    it('preserves query arrays and decoding semantics', async () => {
      await harness.assertPreservesQueryArraysAndDecoding();
    });

    it('preserves malformed cookie values', async () => {
      await harness.assertPreservesMalformedCookieValues();
    });

    it('preserves raw body for JSON and text requests when enabled', async () => {
      await harness.assertPreservesRawBodyForJsonAndText();
    });

    it('does not preserve rawBody for multipart requests', async () => {
      await harness.assertExcludesRawBodyForMultipart();
    });

    it('supports SSE streaming', async () => {
      await harness.assertSupportsSseStreaming();
    });
  });
}

registerWebRuntimePortabilitySuite(
  'bun',
  createWebRuntimeHttpAdapterPortabilityHarness({
    async bootstrap(rootModule, options) {
      const originalBun = (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
      const mockBun = installMockBun();
      const app = await bootstrapBunApplication(rootModule, options);

      await app.listen();

      return {
        async close() {
          await app.close();

          if (originalBun === undefined) {
            delete (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
            return;
          }

          (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = originalBun;
        },
        async dispatch(request: Request) {
          return await mockBun.lastServer!.fetch(request);
        },
      };
    },
    name: 'bun',
  }),
);

registerWebRuntimePortabilitySuite(
  'deno',
  createWebRuntimeHttpAdapterPortabilityHarness({
    async bootstrap(rootModule, options) {
      const server = createServeStub();
      const app = await bootstrapDenoApplication(rootModule, {
        ...options,
        serve: server.serve,
      });

      await app.listen();

      return {
        close() {
          return app.close();
        },
        async dispatch(request: Request) {
          return await server.handler!(request);
        },
      };
    },
    name: 'deno',
  }),
);

registerWebRuntimePortabilitySuite(
  'cloudflare-workers',
  createWebRuntimeHttpAdapterPortabilityHarness({
    async bootstrap(rootModule, options) {
      const worker = await bootstrapCloudflareWorkerApplication(rootModule, options);

      return {
        close() {
          return worker.close();
        },
        async dispatch(request: Request) {
          return await worker.fetch(request, {}, createExecutionContext());
        },
      };
    },
    name: 'cloudflare-workers',
  }),
);
