import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createNodeResponseCompression } from './internal-node-compression.js';
import { createFrameworkResponse } from './internal-node-response.js';

const binary = Buffer.from([0, 127, 128, 255]);
const cases = [
  { name: 'small JSON', body: { text: 'j'.repeat(501) }, expected: Buffer.from(`{"text":"${'j'.repeat(501)}"}`), type: 'application/json; charset=utf-8' },
  { name: 'large JSON', body: { text: 'j'.repeat(65_525) }, expected: Buffer.from(`{"text":"${'j'.repeat(65_525)}"}`), type: 'application/json; charset=utf-8' },
  { name: 'ASCII', body: 'abc', expected: Buffer.from('abc'), type: 'text/plain; charset=utf-8' },
  { name: 'large multibyte', body: '\u00e9'.repeat(32_768), expected: Buffer.from('\u00e9'.repeat(32_768)), type: 'text/plain; charset=utf-8' },
  { name: 'JSON Content-Type string', body: 'quote"\u00e9', expected: Buffer.from('"quote\\"\u00e9"'), header: 'application/json', type: 'application/json' },
  { name: 'caller text header', body: '\u00e9', expected: Buffer.from('\u00e9'), header: 'text/custom', type: 'text/custom' },
  { name: 'Buffer', body: binary, expected: binary, type: 'application/octet-stream' },
  { name: 'Uint8Array', body: new Uint8Array(binary), expected: binary, type: 'application/octet-stream' },
  { name: 'ArrayBuffer', body: new Uint8Array(binary).buffer, expected: binary, type: 'application/octet-stream' },
  { name: 'empty', body: undefined, expected: Buffer.alloc(0), type: undefined },
] as const;

describe('Node response real wire preservation', () => {
  for (const entry of cases) {
    for (const compression of ['absent', 'enabled', 'explicit-false'] as const) {
      it(`send: ${entry.name}/${compression} -> preserves exact bytes and Content-Type`, async () => {
        const server = createServer((incoming, outgoing) => {
          const helper = compression === 'absent' ? undefined : createNodeResponseCompression(outgoing, incoming.headers['accept-encoding']);
          const response = createFrameworkResponse(outgoing, helper);
          if ('header' in entry) response.setHeader('Content-Type', entry.header);
          void response.send(entry.body, compression === 'explicit-false' ? { compression: false } : undefined);
        });
        const ready = once(server, 'listening');
        server.listen(0, '127.0.0.1');
        await ready;
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP listener');

        try {
          const result = await new Promise<{ bytes: Buffer; contentType: string | undefined; encoding: string | undefined }>((resolve, reject) => {
            const client = request({ host: '127.0.0.1', port: address.port, headers: { 'accept-encoding': 'gzip' },
              signal: AbortSignal.timeout(5_000) }, (response) => {
              const chunks: Buffer[] = [];
              response.on('data', (chunk: Buffer) => chunks.push(chunk));
              response.once('error', reject);
              response.once('end', () => resolve({ bytes: Buffer.concat(chunks),
                contentType: response.headers['content-type'], encoding: response.headers['content-encoding'] }));
            });
            client.once('error', reject);
            client.end();
          });

          expect(result.encoding === 'gzip' ? gunzipSync(result.bytes) : result.bytes).toEqual(entry.expected);
          expect(result.contentType).toBe(entry.type);
          if (compression !== 'enabled') expect(result.encoding).toBeUndefined();
        } finally {
          const closed = once(server, 'close');
          server.close();
          await closed;
        }
      });
    }
  }

  it.each([
    ['GET', 204, ''],
    ['GET', 205, 'wire'],
    ['GET', 304, ''],
    ['HEAD', 200, ''],
    ['GET', 206, 'wire'],
  ] as const)('send: %s/%s -> retains observed status-specific bytes', async (method, status, expected) => {
    const server = createServer((_incoming, outgoing) => {
      const response = createFrameworkResponse(outgoing);
      response.setStatus(status);
      if (status === 206) response.setHeader('Content-Range', 'bytes 0-3/4');
      void response.send('wire');
    });
    const ready = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await ready;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');

    try {
      const result = await new Promise<{ status: number | undefined; bytes: Buffer; range: string | undefined }>((resolve, reject) => {
        const client = request({ host: '127.0.0.1', port: address.port, method, signal: AbortSignal.timeout(5_000) }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.once('error', reject);
          response.once('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks), range: response.headers['content-range'] }));
        });
        client.once('error', reject);
        client.end();
      });

      expect(result.status).toBe(status);
      expect(result.bytes).toEqual(Buffer.from(expected));
      if (status === 206) expect(result.range).toBe('bytes 0-3/4');
    } finally {
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
  });
});
