import {
  createServer,
  type IncomingMessage,
  request,
  type ServerResponse,
} from 'node:http';

import type { FrameworkRequest } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import {
  dispatchWithRequestResponseFactory,
  type RequestResponseFactory,
} from '../adapters/request-response-factory.js';
import {
  createFrameworkResponse,
  type MutableFrameworkResponse,
  writeNodeAdapterErrorResponse,
} from './internal-node-response.js';

interface CompressionFailureResponse {
  readonly body: string;
  readonly compressionWrites: number;
  readonly contentType: string | string[] | undefined;
  readonly statusCode: number | undefined;
}

async function dispatchCompressionFailure(
  initialContentType: string | undefined,
): Promise<CompressionFailureResponse> {
  let compressionWrites = 0;
  const compressionFailure = new Error('compression write failed');
  const compression = {
    write() {
      compressionWrites += 1;

      if (compressionWrites === 1) {
        throw compressionFailure;
      }

      return Promise.resolve(false);
    },
  };
  const factory: RequestResponseFactory<
    IncomingMessage,
    ServerResponse,
    MutableFrameworkResponse
  > = {
    async createRequest(rawRequest, signal): Promise<FrameworkRequest> {
      return {
        cookies: {},
        headers: {},
        method: 'GET',
        params: {},
        path: rawRequest.url ?? '/',
        query: {},
        raw: rawRequest,
        signal,
        url: rawRequest.url ?? '/',
      };
    },
    createRequestSignal() {
      return new AbortController().signal;
    },
    createResponse(rawResponse) {
      return createFrameworkResponse(rawResponse, compression);
    },
    resolveRequestId() {
      return undefined;
    },
    async writeErrorResponse(error, response, requestId) {
      await writeNodeAdapterErrorResponse(error, response, requestId);
    },
  };
  const server = createServer(async (rawRequest, rawResponse) => {
    await dispatchWithRequestResponseFactory({
      dispatcher: {
        async dispatch(_request, response) {
          if (initialContentType) {
            response.setHeader('Content-Type', initialContentType);
          }

          await response.send('x'.repeat(1024));
        },
      },
      dispatcherNotReadyMessage: 'dispatcher missing',
      factory,
      rawRequest,
      rawResponse,
    });
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

    return await new Promise<CompressionFailureResponse>((resolve, reject) => {
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
            compressionWrites,
            contentType: response.headers['content-type'],
            statusCode: response.statusCode,
          });
        });
      });
      clientRequest.once('error', reject);
      clientRequest.end();
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
}

describe('Node response compression failure recovery', () => {
  it('writes a JSON 500 response after a pre-commit compression failure', async () => {
    // Given
    const initialContentType = undefined;

    // When
    const result = await dispatchCompressionFailure(initialContentType);

    // Then
    expect(result.compressionWrites).toBe(2);
    expect(result.statusCode).toBe(500);
    expect(result.contentType).toMatch(/^application\/json/);
    expect(JSON.parse(result.body)).toEqual(expect.any(Object));
  });

  it('preserves a caller-owned Content-Type after a pre-commit compression failure', async () => {
    // Given
    const initialContentType = 'application/vnd.fluo+json';

    // When
    const result = await dispatchCompressionFailure(initialContentType);

    // Then
    expect(result.statusCode).toBe(500);
    expect(result.contentType).toBe(initialContentType);
  });
});
