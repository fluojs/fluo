import { describe, expect, it, vi } from 'vitest';

import { bootstrapBunApplication, type BunServeOptions, type BunServerLike } from '@fluojs/platform-bun';
import {
  bootstrapCloudflareWorkerApplication,
  type CloudflareWorkerExecutionContext,
} from '@fluojs/platform-cloudflare-workers';
import {
  bootstrapDenoApplication,
  type DenoServeController,
  type DenoServeHandler,
  type DenoServeOptions,
} from '@fluojs/platform-deno';

import { createWebRuntimeHttpAdapterPortabilityHarness } from './web-runtime-adapter-portability.js';

describe('web runtime portability cleanup reporting', () => {
  it('reports close failures when the assertion path succeeds', async () => {
    const closeError = new Error('close exploded');
    const harness = createWebRuntimeHttpAdapterPortabilityHarness({
      async bootstrap() {
        return {
          async close() {
            throw closeError;
          },
          async dispatch() {
            return Response.json({
              bad: '�%A',
              encoded: 'hello world',
              tag: ['one', 'two'],
            });
          },
        };
      },
      name: 'cleanup-only',
    });

    try {
      await harness.assertPreservesQueryArraysAndDecoding();
      throw new Error('Expected cleanup failure to be reported.');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) {
        throw error;
      }
      expect(error.message).toContain('app.close() failed during portability harness cleanup');
      expect(error.errors).toEqual([closeError]);
    }
  });

  it('preserves assertion failures when close also fails', async () => {
    const closeError = new Error('close exploded');
    const harness = createWebRuntimeHttpAdapterPortabilityHarness({
      async bootstrap() {
        return {
          async close() {
            throw closeError;
          },
          async dispatch() {
            return Response.json({}, { status: 500 });
          },
        };
      },
      name: 'assertion-and-cleanup',
    });

    try {
      await harness.assertPreservesQueryArraysAndDecoding();
      throw new Error('Expected aggregate failure to be reported.');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) {
        throw error;
      }
      expect(error.message).toContain('assertion failed and app.close() also failed');
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toBeInstanceOf(Error);
      expect(error.errors[1]).toBe(closeError);
    }
  });
});

type MockBunServer = BunServerLike & {
  fetch(request: Request): Promise<Response>;
};

type MockBun = {
  lastServer?: MockBunServer;
  serve: ReturnType<typeof vi.fn<(options: BunServeOptions) => MockBunServer>>;
};

type BunBootstrapApp = {
  close(): Promise<void>;
  listen(): Promise<void>;
};

type BunBootstrap = (
  rootModule: Parameters<typeof bootstrapBunApplication>[0],
  options: Parameters<typeof bootstrapBunApplication>[1],
) => Promise<BunBootstrapApp>;

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
      async fetch(request: Request): Promise<Response> {
        const response = await options.fetch(request, server);

        if (response === undefined) {
          throw new Error('Mock Bun server fetch handler did not return a response.');
        }

        return response;
      },
      hostname,
      port,
      stop() {},
      upgrade() {
        return false;
      },
      url: new URL(`${protocol}://${hostname}:${String(port)}`),
    };

    mockBun.lastServer = server;
    return server;
  });

  (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = mockBun;
  return mockBun;
}

function restoreMockBun(originalBun: MockBun | undefined): void {
  if (originalBun === undefined) {
    delete (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
    return;
  }

  (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = originalBun;
}

async function createBunPortabilityApp(
  rootModule: Parameters<typeof bootstrapBunApplication>[0],
  options: Parameters<typeof bootstrapBunApplication>[1],
  bootstrap: BunBootstrap = bootstrapBunApplication,
) {
  const originalBun = (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
  const mockBun = installMockBun();
  let app: BunBootstrapApp | undefined;

  try {
    app = await bootstrap(rootModule, options);
    await app.listen();
  } catch (error) {
    if (app) {
      await app.close().catch(() => {});
    }

    restoreMockBun(originalBun);
    throw error;
  }

  return {
    async close() {
      try {
        await app.close();
      } finally {
        restoreMockBun(originalBun);
      }
    },
    async dispatch(request: Request) {
      const response = await mockBun.lastServer?.fetch(request);

      if (response === undefined) {
        throw new Error('Mock Bun server did not dispatch a response.');
      }

      return response;
    },
  };
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
      return await createBunPortabilityApp(rootModule, options);
    },
    name: 'bun',
  }),
);

describe('bun web runtime adapter cleanup', () => {
  it('restores mocked Bun when bootstrap throws before listen', async () => {
    class BrokenModule {}
    const previousBun = (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
    const originalBun = { serve: vi.fn() } as MockBun;
    (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = originalBun;

    try {
      await expect(
        createBunPortabilityApp(BrokenModule, {} as Parameters<typeof bootstrapBunApplication>[1], async () => {
          throw new Error('bootstrap failed');
        }),
      ).rejects.toThrow('bootstrap failed');

      expect((globalThis as typeof globalThis & { Bun?: MockBun }).Bun).toBe(originalBun);
    } finally {
      restoreMockBun(previousBun);
    }
  });

  it('restores mocked Bun and closes partial apps when listen throws', async () => {
    class BrokenModule {}
    const previousBun = (globalThis as typeof globalThis & { Bun?: MockBun }).Bun;
    const originalBun = { serve: vi.fn() } as MockBun;
    const close = vi.fn(async () => {});
    (globalThis as typeof globalThis & { Bun?: MockBun }).Bun = originalBun;

    try {
      await expect(
        createBunPortabilityApp(BrokenModule, {} as Parameters<typeof bootstrapBunApplication>[1], async () => ({
          close,
          async listen() {
            throw new Error('listen failed');
          },
        })),
      ).rejects.toThrow('listen failed');

      expect(close).toHaveBeenCalledTimes(1);
      expect((globalThis as typeof globalThis & { Bun?: MockBun }).Bun).toBe(originalBun);
    } finally {
      restoreMockBun(previousBun);
    }
  });
});

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
