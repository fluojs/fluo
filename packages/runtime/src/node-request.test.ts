import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createFrameworkRequest } from './node-request.js';

function createIncomingMessage(options: {
  body?: string | Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
}): IncomingMessage {
  const chunks: Uint8Array[] = [];

  if (options.body !== undefined) {
    chunks.push(typeof options.body === 'string' ? Buffer.from(options.body, 'utf8') : options.body);
  }

  return {
    headers: options.headers,
    method: options.method ?? 'GET',
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    url: options.url ?? '/',
  } as unknown as IncomingMessage;
}

describe('node request adapter', () => {
  it('preserves multi-value header arrays without flattening them', async () => {
    const upstreamValues = ['v1', 'v2'];
    const request = createIncomingMessage({
      headers: {
        'x-multi': upstreamValues,
      },
      url: '/headers',
    });

    const frameworkRequest = await createFrameworkRequest(request, new AbortController().signal);

    upstreamValues.push('v3');

    expect(frameworkRequest.headers['x-multi']).toEqual(['v1', 'v2']);
  });

  it('parses cookie header arrays without losing cookie boundaries', async () => {
    const request = createIncomingMessage({
      headers: {
        cookie: ['session=abc', 'theme=dark'],
      },
      url: '/cookies',
    });

    const frameworkRequest = await createFrameworkRequest(request, new AbortController().signal);

    expect(frameworkRequest.cookies).toEqual({
      session: 'abc',
      theme: 'dark',
    });
  });

  it('uses the primary content-type value when duplicate content-type headers are present', async () => {
    const request = createIncomingMessage({
      body: '{"ok":true}',
      headers: {
        'content-type': ['application/json', 'text/plain'],
      },
      method: 'POST',
      url: '/body',
    });

    const frameworkRequest = await createFrameworkRequest(request, new AbortController().signal);

    expect(frameworkRequest.body).toEqual({ ok: true });
  });
});
