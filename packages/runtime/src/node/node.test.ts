import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Dispatcher } from '@fluojs/http';

import * as rootRuntimeApi from '../index.js';
import * as publicNodeApi from '../node.js';
import type { NodeHttpApplicationAdapter } from '../node.js';

describe('createNodeHttpAdapter', () => {
  it('keeps Node lifecycle helpers out of the runtime root barrel', () => {
    expect(rootRuntimeApi).not.toHaveProperty('bootstrapNodeApplication');
    expect(rootRuntimeApi).not.toHaveProperty('createNodeHttpAdapter');
    expect(rootRuntimeApi).not.toHaveProperty('runNodeApplication');
  });

  it('uses the runtime default port instead of process.env.PORT', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = publicNodeApi.createNodeHttpAdapter() as NodeHttpApplicationAdapter;

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

  it('does not fail when process.env.PORT is invalid', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = 'not-a-number';

    try {
      const adapter = publicNodeApi.createNodeHttpAdapter() as NodeHttpApplicationAdapter;

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

  it('does not expose node compression internals on the public node subpath', () => {
    expect(publicNodeApi.createNodeHttpAdapter).toBeTypeOf('function');
    expect(publicNodeApi).not.toHaveProperty('compressNodeResponse');
    expect(publicNodeApi).not.toHaveProperty('createNodeResponseCompression');
  });

  it('fails fast when maxBodySize is not provided as numeric bytes', () => {
    expect(() => Function.prototype.call.call(publicNodeApi.createNodeHttpAdapter, undefined, { maxBodySize: '1mb' })).toThrow(
      'Invalid maxBodySize value: 1mb. Expected a non-negative integer number of bytes.',
    );
  });

  it('cancels pending listen retries when the adapter closes during shutdown', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', resolve);
    });

    const { port } = blocker.address() as AddressInfo;
    const adapter = publicNodeApi.createNodeHttpAdapter({
      host: '127.0.0.1',
      port,
      retryDelayMs: 10_000,
      retryLimit: 2,
    }) as NodeHttpApplicationAdapter;
    const dispatcher: Dispatcher = {
      async dispatch() {},
    };

    try {
      const listenPromise = adapter.listen(dispatcher);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await adapter.close();

      await expect(listenPromise).rejects.toThrow('Node HTTP adapter listen retry was cancelled during shutdown.');
    } finally {
      await adapter.close();
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
  });

  it('does not register a retry timer when shutdown wins the server close callback race', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(0, '127.0.0.1', resolve);
    });

    const { port } = blocker.address() as AddressInfo;
    const adapter = publicNodeApi.createNodeHttpAdapter({
      host: '127.0.0.1',
      port,
      retryDelayMs: 10_000,
      retryLimit: 1,
    }) as NodeHttpApplicationAdapter;
    const dispatcher: Dispatcher = {
      async dispatch() {},
    };
    const server = adapter.getServer();
    const originalClose = server.close.bind(server);
    let releaseRetryClose: (() => void) | undefined;
    const retryCloseRequested = new Promise<void>((resolve) => {
      vi.spyOn(server, 'close').mockImplementation(((callback?: (error?: Error) => void) => {
        releaseRetryClose = () => {
          callback?.();
        };
        resolve();
        return server;
      }) as typeof server.close);
    });

    try {
      const listenPromise = adapter.listen(dispatcher);
      await retryCloseRequested;

      await adapter.close();
      vi.useFakeTimers();

      releaseRetryClose?.();

      expect(vi.getTimerCount()).toBe(0);
      await expect(listenPromise).rejects.toThrow('Node HTTP adapter listen retry was cancelled during shutdown.');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      await adapter.close();
      server.close = originalClose;
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
  });
});
