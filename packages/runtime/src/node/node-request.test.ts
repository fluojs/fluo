import type { IncomingMessage } from 'node:http';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  createDeferredFrameworkRequest,
  createFrameworkRequest,
  materializeFrameworkRequestBody,
} from './node-request.js';
import { NodeRequestPayloadTooLargeException } from './internal-node-request.js';

function createIncomingMessage(options: {
  body?: string | Uint8Array;
  bodyChunks?: Array<string | Uint8Array>;
  destroy?: () => void;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  pause?: () => void;
  url?: string;
}): IncomingMessage {
  const chunks: Uint8Array[] = [];

  if (options.bodyChunks) {
    for (const chunk of options.bodyChunks) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    }
  } else if (options.body !== undefined) {
    chunks.push(typeof options.body === 'string' ? Buffer.from(options.body, 'utf8') : options.body);
  }

  return {
    destroy: options.destroy,
    headers: options.headers,
    method: options.method ?? 'GET',
    pause: options.pause,
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

  it('captures cookies at creation, then materializes and memoizes the parsed object lazily', async () => {
    const request = createIncomingMessage({
      headers: {
        cookie: 'session=before',
      },
      url: '/cookies',
    });

    const frameworkRequest = await createFrameworkRequest(request, new AbortController().signal);
    const mutableHeaders = frameworkRequest.headers as Record<string, string | string[] | undefined>;

    request.headers.cookie = 'session=after';
    mutableHeaders.cookie = 'session=ignored';
    const firstCookies = frameworkRequest.cookies;
    request.headers.cookie = 'session=after-second-access';
    mutableHeaders.cookie = 'session=ignored-second-access';
    const secondCookies = frameworkRequest.cookies;

    expect(firstCookies).toEqual({ session: 'before' });
    expect(secondCookies).toBe(firstCookies);
    expect(secondCookies).toEqual({ session: 'before' });
  });

  it('captures query parameters at creation, then materializes and memoizes the parsed object lazily', async () => {
    const entries = vi.spyOn(URLSearchParams.prototype, 'entries');
    const request = createIncomingMessage({
      headers: {},
      url: '/search?tag=one&tag=two',
    });

    try {
      const frameworkRequest = await createFrameworkRequest(request, new AbortController().signal);

      request.url = '/search?tag=after';
      expect(entries).not.toHaveBeenCalled();

      const firstQuery = frameworkRequest.query;
      request.url = '/search?tag=ignored';
      const secondQuery = frameworkRequest.query;

      expect(firstQuery).toEqual({ tag: ['one', 'two'] });
      expect(secondQuery).toBe(firstQuery);
      expect(secondQuery).toEqual({ tag: ['one', 'two'] });
      expect(entries).toHaveBeenCalledTimes(1);
    } finally {
      entries.mockRestore();
    }
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

  it('creates the request shell before materializing body and rawBody', async () => {
    let chunksRead = 0;
    const request = {
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        chunksRead += 1;
        yield Buffer.from('{"ok":true}', 'utf8');
      },
      url: '/body?tag=one',
    } as unknown as IncomingMessage;

    const frameworkRequest = createDeferredFrameworkRequest(
      request,
      new AbortController().signal,
      undefined,
      undefined,
      true,
    );

    expect(chunksRead).toBe(0);
    expect(frameworkRequest.path).toBe('/body');
    expect(frameworkRequest.query).toEqual({ tag: 'one' });

    await materializeFrameworkRequestBody(frameworkRequest);
    await materializeFrameworkRequestBody(frameworkRequest);

    expect(chunksRead).toBe(1);
    expect(frameworkRequest.body).toEqual({ ok: true });
    expect(Buffer.from(frameworkRequest.rawBody ?? new Uint8Array()).toString('utf8')).toBe('{"ok":true}');
  });

  it('skips request stream reads when headers indicate no request body', async () => {
    let chunksRead = 0;
    const request = {
      headers: {
        'content-length': '0',
      },
      method: 'GET',
      async *[Symbol.asyncIterator]() {
        chunksRead += 1;
        yield Buffer.from('unexpected', 'utf8');
      },
      url: '/empty',
    } as unknown as IncomingMessage;

    const frameworkRequest = createDeferredFrameworkRequest(request, new AbortController().signal);

    await materializeFrameworkRequestBody(frameworkRequest);
    await materializeFrameworkRequestBody(frameworkRequest);

    expect(chunksRead).toBe(0);
    expect(frameworkRequest.body).toBeUndefined();
  });

  it('destroys the raw Node request stream when maxBodySize is exceeded', async () => {
    let destroyed = false;
    let paused = false;
    const request = createIncomingMessage({
      bodyChunks: ['12345', '67890'],
      destroy: () => {
        destroyed = true;
      },
      headers: {
        'content-type': 'text/plain',
      },
      method: 'POST',
      pause: () => {
        paused = true;
      },
      url: '/body',
    });

    const response = new EventEmitter() as EventEmitter & {
      headers: Record<string, string>;
      setHeader: (name: string, value: string) => void;
    };
    response.headers = {};
    response.setHeader = (name, value) => {
      response.headers[name] = value;
    };

    const thrown = await createFrameworkRequest(request, new AbortController().signal, undefined, 8).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(NodeRequestPayloadTooLargeException);
    (thrown as NodeRequestPayloadTooLargeException).prepareResponse(response as never);

    expect(paused).toBe(true);
    expect(response.headers.Connection).toBe('close');
    response.emit('finish');
    expect(destroyed).toBe(true);
  });
});
