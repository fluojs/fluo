import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  compressNodeResponse,
  createNodeResponseCompression,
} from './internal-node-compression.js';
import { createFrameworkResponse } from './internal-node-response.js';

describe('Node response compression failures', () => {
  it('returns a rejected promise and restores the response state when compression throws synchronously', async () => {
    const compressionFailure = new Error('compression write failed');
    let committed: boolean | undefined;
    let contentEncoding: number | string | string[] | undefined;
    let responseWritableEnded: boolean | undefined;
    let synchronouslyThrown = false;
    let writeFailure: unknown;
    let resolveResponseSettlement: () => void;
    const responseSettled = new Promise<void>((resolve) => {
      resolveResponseSettlement = resolve;
    });
    const server = createServer(async (_request, response) => {
      const compression = {
        write() {
          throw compressionFailure;
        },
      };
      const frameworkResponse = createFrameworkResponse(response, compression);

      try {
        const result = frameworkResponse.send('x'.repeat(1024));

        if (!(result instanceof Promise)) {
          throw new Error('Expected compression writes to return a promise.');
        }

        await result.catch((error: unknown) => {
          writeFailure = error;
        });
      } catch (error: unknown) {
        synchronouslyThrown = true;
        writeFailure = error;
      } finally {
        committed = frameworkResponse.committed;
        contentEncoding = response.getHeader('Content-Encoding');
        responseWritableEnded = response.writableEnded;
        response.end();
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
      const address = server.address() as AddressInfo;
      const result = await new Promise<{
        readonly body: string;
        readonly statusCode: number | undefined;
      }>((resolve, reject) => {
        const clientRequest = request({
          host: address.address,
          port: address.port,
        }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.once('end', () => {
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              statusCode: response.statusCode,
            });
          });
        });
        clientRequest.once('error', reject);
        clientRequest.end();
      });

      await responseSettled;

      expect(synchronouslyThrown).toBe(false);
      expect(writeFailure).toBe(compressionFailure);
      expect(committed).toBe(false);
      expect(responseWritableEnded).toBe(false);
      expect(contentEncoding).toBeUndefined();
      expect(result).toEqual({
        body: '',
        statusCode: 200,
      });
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

  it('rejects a compression request after the native response has already closed', async () => {
    let compressionResult:
      | { readonly kind: 'rejected'; readonly error: unknown }
      | { readonly kind: 'resolved' }
      | undefined;
    let contentEncoding: number | string | string[] | undefined;
    let resolveResponseSettlement: () => void;
    const responseSettled = new Promise<void>((resolve) => {
      resolveResponseSettlement = resolve;
    });
    const server = createServer(async (_request, response) => {
      try {
        const responseClosed = new Promise<void>((resolve) => {
          response.once('close', resolve);
        });
        response.destroy();
        await responseClosed;

        compressionResult = await compressNodeResponse(response, Buffer.from('payload'), 'gzip').then(
          () => ({ kind: 'resolved' } as const),
          (error: unknown) => ({ error, kind: 'rejected' } as const),
        );
        contentEncoding = response.getHeader('Content-Encoding');
      } finally {
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
      const address = server.address() as AddressInfo;
      const clientRequest = request({
        host: address.address,
        port: address.port,
      });
      const clientClosed = new Promise<void>((resolve) => {
        clientRequest.once('close', resolve);
      });
      clientRequest.once('error', () => {});
      clientRequest.end();

      await clientClosed;
      await responseSettled;

      expect(compressionResult).toMatchObject({
        error: {
          message: 'Node response closed before compression completed.',
        },
        kind: 'rejected',
      });
      expect(contentEncoding).toBeUndefined();
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

  it('propagates a native compression write failure and terminates the response', async () => {
    const compressionFailure = new Error('socket write failed');
    let compressionStream: { readonly destroyed: boolean } | undefined;
    let sendFailure: unknown;
    let responseTerminated = false;
    let resolveResponseSettlement: () => void;
    const responseSettled = new Promise<void>((resolve) => {
      resolveResponseSettlement = resolve;
    });
    const server = createServer(async (_request, response) => {
      response.once('pipe', (source) => {
        compressionStream = source as { readonly destroyed: boolean };
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
      expect(compressionStream?.destroyed).toBe(true);
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
