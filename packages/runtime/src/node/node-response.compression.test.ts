import { createServer, request } from 'node:http';
import { describe, expect, it } from 'vitest';

import { createNodeResponseCompression } from './internal-node-compression.js';
import { createFrameworkResponse } from './internal-node-response.js';

describe('Node response compression failures', () => {
  it('propagates a native compression write failure and terminates the response', async () => {
    const compressionFailure = new Error('socket write failed');
    let sendFailure: unknown;
    let responseTerminated = false;
    let resolveResponseSettlement: () => void;
    const responseSettled = new Promise<void>((resolve) => {
      resolveResponseSettlement = resolve;
    });
    const server = createServer(async (_request, response) => {
      response.once('pipe', () => {
        response.destroy(compressionFailure);
      });
      response.once('error', () => {});

      const compression = createNodeResponseCompression(response, 'gzip');
      if (compression === undefined) {
        throw new Error('Expected gzip compression to be enabled.');
      }

      const frameworkResponse = createFrameworkResponse(response, compression);
      try {
        await frameworkResponse.send('x'.repeat(1024));
      } catch (error: unknown) {
        sendFailure = error;
      } finally {
        responseTerminated = response.destroyed;
        resolveResponseSettlement();
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected the Node listener to expose a TCP address.');
      }

      const clientRequest = request({
        host: address.address,
        port: address.port,
      });
      const clientClosed = new Promise<void>((resolve) => {
        clientRequest.once('close', resolve);
      });
      clientRequest.once('error', () => {});
      clientRequest.end();

      await responseSettled;
      clientRequest.destroy();
      await clientClosed;

      expect(sendFailure).toMatchObject({
        message: 'Node response closed before compression completed.',
      });
      expect(responseTerminated).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
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
