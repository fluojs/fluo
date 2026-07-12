import { createServer } from 'node:net';
import { Controller, type Dispatcher, Get, Post, type RequestContext } from '@fluojs/http';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { createNodejsAdapter, runNodejsApplication } from './index.js';

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}

describe('@fluojs/platform-nodejs lifecycle boundaries', () => {
  it('observes an address-in-use failure before a listen retry succeeds', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind a retry test port.');
    }

    const dispatcher: Dispatcher = {
      async dispatch() {},
    };
    const adapter = createNodejsAdapter({
      host: '127.0.0.1',
      port: address.port,
      retryDelayMs: 50,
      retryLimit: 5,
    });
    const retryObserved = new Promise<void>((resolve, reject) => {
      adapter.getServer().once('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE') {
          reject(error);
          return;
        }

        resolve();
      });
    });

    try {
      const listenPromise = adapter.listen(dispatcher);
      await retryObserved;
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      await expect(listenPromise).resolves.toBeUndefined();
    } finally {
      await adapter.close();
      if (blocker.listening) {
        await new Promise<void>((resolve, reject) => {
          blocker.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      }
    }
  });

  it('ignores process.env.PORT at the platform package boundary', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = createNodejsAdapter();

      expect(adapter.getListenTarget().url).toBe('http://localhost:3000');
      await adapter.close();
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
    }
  });

  it('allows an empty body and rejects the first byte when maxBodySize is zero', async () => {
    @Controller('/zero-body')
    class ZeroBodyController {
      @Post('/')
      readBody(_input: undefined, context: RequestContext) {
        return { body: context.request.body ?? null };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [ZeroBodyController] });

    const adapter = createNodejsAdapter({ maxBodySize: 0, port: 0 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const baseUrl = adapter.getListenTarget().url;
      const emptyResponse = await fetch(`${baseUrl}/zero-body`, { method: 'POST' });
      const oneByteResponse = await fetch(`${baseUrl}/zero-body`, {
        body: 'x',
        headers: { 'content-type': 'text/plain' },
        method: 'POST',
      });

      expect(emptyResponse.status).toBe(201);
      await expect(emptyResponse.json()).resolves.toEqual({ body: null });
      expect(oneByteResponse.status).toBe(413);
      await expect(oneByteResponse.json()).resolves.toMatchObject({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          status: 413,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('force-closes an active request when the bounded drain window expires', async () => {
    const requestStarted = createDeferred();
    const releaseRequest = createDeferred();

    @Controller('/drain')
    class DrainController {
      @Get('/')
      async drain() {
        requestStarted.resolve();
        await releaseRequest.promise;
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [DrainController] });

    const adapter = createNodejsAdapter({ port: 0, shutdownTimeoutMs: 25 });
    const server = adapter.getServer();
    const closeAllConnections = vi.spyOn(server, 'closeAllConnections');
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const responseOutcome = fetch(`${adapter.getListenTarget().url}/drain`).then(
        (response) => ({ kind: 'response' as const, response }),
        (error: unknown) => ({ error, kind: 'error' as const }),
      );
      await requestStarted.promise;

      await expect(app.close()).resolves.toBeUndefined();

      expect(closeAllConnections).toHaveBeenCalledTimes(1);
      const outcome = await responseOutcome;
      expect(outcome.kind).toBe('error');
      if (outcome.kind !== 'error') {
        throw new Error(`Expected the active request to be aborted, received HTTP ${String(outcome.response.status)}.`);
      }
      expect(outcome.error).toBeInstanceOf(Error);
    } finally {
      releaseRequest.resolve();
      closeAllConnections.mockRestore();
      await app.close();
    }
  });

  it('closes normally when the registered shutdown signal handler runs', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const originalExitCode = process.exitCode;
    const signal = 'SIGTERM' as const;
    const listenersBefore = new Set(process.listeners(signal));
    const app = await runNodejsApplication(AppModule, {
      port: 0,
      shutdownSignals: [signal],
    });
    const registeredListener = process.listeners(signal).find((listener) => !listenersBefore.has(listener));
    const closeCompleted = createDeferred();
    const originalClose = app.close.bind(app);
    const close = vi.spyOn(app, 'close').mockImplementation(async (receivedSignal?: string) => {
      await originalClose(receivedSignal);
      closeCompleted.resolve();
    });

    try {
      if (!registeredListener) {
        throw new Error('Expected runNodejsApplication() to register a SIGTERM listener.');
      }

      registeredListener(signal);
      await closeCompleted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(close).toHaveBeenCalledWith(signal);
      expect(app.state).toBe('closed');
      expect(process.exitCode).toBe(0);
      expect(process.listeners(signal)).not.toContain(registeredListener);
    } finally {
      close.mockRestore();
      process.exitCode = originalExitCode;
      await app.close();
    }
  });
});
