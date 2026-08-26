import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EarlyHintsWriteError } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { createFrameworkResponse } from './node-response.js';

describe('createFrameworkResponse with a real Node listener', () => {
  it('rejects forbidden 103 framing headers without corrupting the final response', async () => {
    let earlyHintsError: unknown;
    const server = createServer(async (_request, response) => {
      const frameworkResponse = createFrameworkResponse(response);

      try {
        await frameworkResponse.earlyHints?.write({
          link: '</styles.css>; rel=preload; as=style',
          'content-length': '1',
          'transfer-encoding': 'chunked',
        });
      } catch (error: unknown) {
        earlyHintsError = error;
      }

      frameworkResponse.statusCode = 200;
      await frameworkResponse.send('ok');
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
        readonly informationalStatuses: readonly number[];
        readonly statusCode: number | undefined;
      }>((resolve, reject) => {
        const informationalStatuses: number[] = [];
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
              informationalStatuses,
              statusCode: response.statusCode,
            });
          });
        });
        clientRequest.on('information', ({ statusCode }) => {
          informationalStatuses.push(statusCode);
        });
        clientRequest.once('error', reject);
        clientRequest.end();
      });

      expect(earlyHintsError).toBeInstanceOf(EarlyHintsWriteError);
      expect(result).toEqual({
        body: 'ok',
        informationalStatuses: [],
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
});
