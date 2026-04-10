import { describe, expect, it } from 'vitest';

import { SseResponse, type FrameworkRequest, type FrameworkResponse } from '@fluojs/http';

import { dispatchWebRequest } from './web.js';

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
});
