import { Server as HttpServer } from 'node:http';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

import * as publicNodeApi from '../node.js';
import * as internalNodeApi from './internal-node.js';

describe('runtime internal node seam', () => {
  it('keeps the public runtime/node path focused on supported node helpers', () => {
    expect(publicNodeApi.bootstrapNodeApplication).toBe(internalNodeApi.bootstrapNodeApplication);
    expect(publicNodeApi.createNodeHttpAdapter).toBe(internalNodeApi.createNodeHttpAdapter);
    expect(publicNodeApi.runNodeApplication).toBe(internalNodeApi.runNodeApplication);
    expect(publicNodeApi.createNodeShutdownSignalRegistration).toBe(internalNodeApi.createNodeShutdownSignalRegistration);
    expect(publicNodeApi).not.toHaveProperty('compressNodeResponse');
    expect(publicNodeApi).not.toHaveProperty('createNodeResponseCompression');
  });

  it('cancels an address-in-use retry when close starts before the port becomes available', async () => {
    // Given: a real occupied port and a Node adapter waiting to retry that port.
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', () => {
        blocker.removeListener('error', reject);
        resolve();
      });
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind a retry cancellation test port.');
    }

    const adapter = internalNodeApi.createNodeHttpAdapter({
      host: '127.0.0.1',
      port: address.port,
      retryDelayMs: 100,
      retryLimit: 20,
    });
    const server = adapter.getServer?.();
    if (!(server instanceof HttpServer)) {
      throw new Error('Expected the Node adapter to expose its HTTP server.');
    }

    const retryObserved = new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE') {
          reject(error);
          return;
        }

        resolve();
      });
    });
    const listenResult = Promise.resolve(adapter.listen({ async dispatch() {} })).then(
      () => 'listened' as const,
      (error: unknown) => error,
    );

    try {
      await retryObserved;
      const overlappingListenResult = Promise.resolve(adapter.listen({ async dispatch() {} })).then(
        () => 'listened' as const,
        (error: unknown) => error,
      );

      // When: shutdown completes while the retry delay still owns the pending startup.
      await expect(adapter.close()).resolves.toBeUndefined();
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      // Then: releasing the port cannot resurrect the closed adapter.
      const result = await listenResult;
      expect(result).toBeInstanceOf(Error);
      await expect(overlappingListenResult).resolves.toBeInstanceOf(Error);
      expect(server.listening).toBe(false);
    } finally {
      try {
        await adapter.close();
      } finally {
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
    }
  });
});
