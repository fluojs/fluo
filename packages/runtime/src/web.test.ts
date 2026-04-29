import { describe, expect, it } from 'vitest';

import { SseResponse, type FrameworkRequest, type FrameworkResponse } from '@fluojs/http';

import {
  createWebFrameworkRequest,
  createWebRequestResponseFactory,
  dispatchWebRequest,
} from './web.js';

describe('dispatchWebRequest', () => {
  it('translates Web Request semantics into the framework request contract', async () => {
    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          expect(request.method).toBe('POST');
          expect(request.path).toBe('/hooks/stripe');
          expect(request.url).toBe('/hooks/stripe?tag=one&tag=two');
          expect(request.query).toEqual({ tag: ['one', 'two'] });
          expect(request.cookies).toEqual({ bad: '%E0%A4%A', session: 'abc 123' });
          expect(request.body).toEqual({ provider: 'stripe' });
          expect(Buffer.from(request.rawBody ?? new Uint8Array()).toString('utf8')).toBe('{"provider":"stripe"}');

          frameworkResponse.setStatus(202);
          frameworkResponse.setHeader('x-runtime', 'web');
        },
      },
      rawBody: true,
      request: new Request('https://runtime.test/hooks/stripe?tag=one&tag=two', {
        body: JSON.stringify({ provider: 'stripe' }),
        headers: {
          cookie: 'session=abc%20123; bad=%E0%A4%A',
          'content-type': 'application/json',
          'x-request-id': 'req-web-1',
        },
        method: 'POST',
      }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('x-runtime')).toBe('web');
    expect(await response.text()).toBe('');
  });

  it('serializes framework errors into a Web Response', async () => {
    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch() {
          throw new Error('boom');
        },
      },
      request: new Request('https://runtime.test/errors', {
        headers: {
          'x-request-id': 'req-web-2',
        },
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
        requestId: 'req-web-2',
        status: 500,
      },
    });
  });

  it('supports SSE streaming over a native Web Response', async () => {
    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          const stream = new SseResponse({
            container: {} as never,
            metadata: {},
            request,
            requestId: 'req-web-3',
            response: frameworkResponse,
          });

          stream.comment('connected');
          stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });
          stream.close();
        },
      },
      request: new Request('https://runtime.test/events', {
        headers: {
          accept: 'text/event-stream',
        },
      }),
    });

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: ready');
    expect(body).toContain('data: {"ready":true}');
  });

  it('rejects oversized streaming request bodies before reading unlimited bytes', async () => {
    let producedChunks = 0;

    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch() {
          throw new Error('should not dispatch oversized request');
        },
      },
      maxBodySize: 1_000_000,
      request: new Request(
        'https://runtime.test/upload',
        {
          body: new ReadableStream<Uint8Array>({
            pull(controller) {
              producedChunks += 1;

              if (producedChunks === 1) {
                controller.enqueue(new Uint8Array(600_000));
                return;
              }

              if (producedChunks === 2) {
                controller.enqueue(new Uint8Array(600_000));
                return;
              }

              controller.close();
            },
          }),
          duplex: 'half',
          headers: {
            'content-type': 'text/plain',
          },
          method: 'POST',
        } as RequestInit & { duplex: 'half' },
      ),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: 'Request body exceeds the size limit.',
        status: 413,
      },
    });
    expect(producedChunks).toBeLessThanOrEqual(3);
  });
});

describe('createWebFrameworkRequest', () => {
  it('captures headers at creation, then materializes and memoizes the cloned object lazily', async () => {
    const request = new Request('https://runtime.test/headers', {
      headers: {
        'x-runtime': 'before',
      },
    });

    const frameworkRequest = await createWebFrameworkRequest(request, new AbortController().signal);

    request.headers.set('x-runtime', 'after');
    const firstHeaders = frameworkRequest.headers;
    request.headers.set('x-runtime', 'ignored');
    const secondHeaders = frameworkRequest.headers;

    expect(firstHeaders['x-runtime']).toBe('before');
    expect(secondHeaders).toBe(firstHeaders);
    expect(secondHeaders['x-runtime']).toBe('before');
  });

  it('creates the request shell before materializing body and rawBody', async () => {
    let pulls = 0;
    const request = new Request('https://runtime.test/body?tag=one', {
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('{"ok":true}'));
          controller.close();
        },
      }),
      duplex: 'half',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    } as RequestInit & { duplex: 'half' });
    const originalClone = request.clone.bind(request);
    let cloneCalls = 0;

    Object.defineProperty(request, 'clone', {
      value: () => {
        cloneCalls += 1;
        return originalClone();
      },
    });

    const factory = createWebRequestResponseFactory({ rawBody: true });
    const frameworkRequest = await factory.createRequest(request, new AbortController().signal);

    expect(cloneCalls).toBe(0);
    expect(frameworkRequest.path).toBe('/body');
    expect(frameworkRequest.query).toEqual({ tag: 'one' });

    await factory.materializeRequest?.(frameworkRequest);
    await factory.materializeRequest?.(frameworkRequest);

    expect(cloneCalls).toBe(1);
    expect(pulls).toBe(1);
    expect(frameworkRequest.body).toEqual({ ok: true });
    expect(Buffer.from(frameworkRequest.rawBody ?? new Uint8Array()).toString('utf8')).toBe('{"ok":true}');
  });

  it('skips clone-based body materialization for bodyless requests', async () => {
    const request = new Request('https://runtime.test/empty?tag=one');
    const originalClone = request.clone.bind(request);
    let cloneCalls = 0;

    Object.defineProperty(request, 'clone', {
      value: () => {
        cloneCalls += 1;
        return originalClone();
      },
    });

    const factory = createWebRequestResponseFactory();
    const frameworkRequest = await factory.createRequest(request, new AbortController().signal);

    await factory.materializeRequest?.(frameworkRequest);
    await factory.materializeRequest?.(frameworkRequest);

    expect(cloneCalls).toBe(0);
    expect(frameworkRequest.body).toBeUndefined();
  });

  it('uses creation-time metadata when materializing deferred multipart bodies', async () => {
    const formData = new FormData();
    formData.set('title', 'before');
    const request = new Request('https://runtime.test/upload?tag=one', {
      body: formData,
      method: 'POST',
    });
    const factory = createWebRequestResponseFactory();
    const frameworkRequest = await factory.createRequest(request, new AbortController().signal);

    request.headers.set('content-type', 'text/plain');
    request.headers.set('x-runtime', 'after');

    await factory.materializeRequest?.(frameworkRequest);

    expect(frameworkRequest.body).toEqual({ title: 'before' });
    expect(frameworkRequest.headers['content-type']).toContain('multipart/form-data');
    expect(frameworkRequest.headers['x-runtime']).toBeUndefined();
  });
});
