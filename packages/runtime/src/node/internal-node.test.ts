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

  it('rejects cancelled listen settlement re-entry until close completes', async () => {
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
    let markReentryAttempted: () => void;
    const reentryAttempted = new Promise<void>((resolve) => {
      markReentryAttempted = resolve;
    });
    const listenAttempt = Promise.resolve(adapter.listen({ async dispatch() {} }));
    const listenResult = listenAttempt.then(
      () => 'listened' as const,
      (error: unknown) => error,
    );
    const reenteredListenResult = listenAttempt.then(
      () => 'initial-listened' as const,
      () => {
        markReentryAttempted();
        return Promise.resolve(adapter.listen({ async dispatch() {} })).then(
          () => 'reentered-listened' as const,
          (error: unknown) => error,
        );
      },
    );

    try {
      await retryObserved;
      const overlappingListenResult = Promise.resolve(adapter.listen({ async dispatch() {} })).then(
        () => 'listened' as const,
        (error: unknown) => error,
      );

      // When: shutdown completes while the retry delay still owns the pending startup.
      const closeInFlight = adapter.close();
      await reentryAttempted;
      await expect(closeInFlight).resolves.toBeUndefined();
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
      await expect(reenteredListenResult).resolves.toBeInstanceOf(Error);
      expect(server.listening).toBe(false);

      // Then: an explicit listen after close settlement can bind again.
      await expect(adapter.listen({ async dispatch() {} })).resolves.toBeUndefined();
      expect(server.listening).toBe(true);
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
