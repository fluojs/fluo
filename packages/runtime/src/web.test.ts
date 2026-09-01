import { describe, expect, it } from 'vitest';

import { Container } from '@fluojs/di';
import {
  assertRequestContext,
  Controller,
  createAccessLogObserver,
  createDispatcher,
  createHandlerMapping,
  Get,
  SseResponse,
  type AccessLogEvent,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@fluojs/http';

import type { RequestResponseFactory } from './adapters/request-response-factory.js';

import {
  createWebFrameworkRequest,
  createWebRequestResponseFactory,
  dispatchWebRequest,
  startWebRequestDispatch,
} from './web.js';

function waitForSettlement<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Timed out waiting for test settlement after ${String(timeoutMs)}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  });
}

describe('dispatchWebRequest', () => {
  it('logs the final default status for a manual Web response', async () => {
    // Given
    const records: AccessLogEvent[] = [];

    @Controller('/web-access-log')
    class WebAccessLogController {
      @Get('/')
      async sendManually() {
        await assertRequestContext().response.send({ committed: true });
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: WebAccessLogController }]),
      observers: [createAccessLogObserver({
        sink: {
          emit(record) {
            records.push(record);
          },
        },
      })],
      rootContainer: new Container().register(WebAccessLogController),
    });

    // When
    const response = await dispatchWebRequest({
      dispatcher,
      request: new Request('https://runtime.test/web-access-log'),
    });

    // Then
    expect(response.status).toBe(200);
    expect(records).toContainEqual(expect.objectContaining({
      event: 'http.access.finish',
      outcome: 'success',
      status: 200,
    }));
  });

  it('supports custom response factories without responseReady', async () => {
    type LegacyWebFrameworkResponse = FrameworkResponse & {
      toResponse(): Response;
    };

    const baseFactory = createWebRequestResponseFactory();
    const factory: RequestResponseFactory<Request, AbortSignal | undefined, LegacyWebFrameworkResponse> = {
      createRequest: baseFactory.createRequest,
      createRequestSignal: baseFactory.createRequestSignal,
      createResponse(rawResponse, rawRequest) {
        const response = baseFactory.createResponse(rawResponse, rawRequest);

        return {
          get committed() {
            return response.committed;
          },
          set committed(value) {
            response.committed = value;
          },
          get headers() {
            return response.headers;
          },
          redirect: response.redirect.bind(response),
          send: response.send.bind(response),
          setHeader: response.setHeader.bind(response),
          setStatus: response.setStatus.bind(response),
          toResponse: response.toResponse.bind(response),
        };
      },
      resolveRequestId: baseFactory.resolveRequestId,
      writeErrorResponse(_error, response) {
        return Promise.resolve(response.send(undefined));
      },
    };

    const dispatch = startWebRequestDispatch({
      dispatcher: {
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          await response.send({ compatible: true });
        },
      },
      factory,
      request: new Request('https://runtime.test/legacy-factory'),
    });

    const response = await dispatch.response;

    await expect(response.json()).resolves.toEqual({ compatible: true });
    await expect(dispatch.completion).resolves.toBeUndefined();
  });

  it('exposes Early Hints as unsupported on Web response facades', async () => {
    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch(_request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          expect(frameworkResponse.earlyHints).toBeUndefined();
          await frameworkResponse.send({ ok: true });
        },
      },
      request: new Request('https://runtime.test/early-hints'),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('serializes simple JSON responses while preserving non-JSON response semantics', async () => {
    const responseFor = (path: string) => dispatchWebRequest({
      dispatcher: {
        async dispatch(_request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          switch (path) {
            case '/object':
              await frameworkResponse.send({ ok: true });
              return;
            case '/array':
              await frameworkResponse.send([{ ok: true }]);
              return;
            case '/string':
              await frameworkResponse.send('plain');
              return;
            case '/bytes':
              await frameworkResponse.send(Uint8Array.from([65, 66]));
              return;
            case '/buffer':
              await frameworkResponse.send(Uint8Array.from([67, 68]).buffer);
              return;
            case '/headers':
              frameworkResponse.setStatus(202);
              frameworkResponse.setHeader('x-contract', 'preserved');
              await frameworkResponse.send({ ok: true });
              return;
            case '/redirect':
              frameworkResponse.redirect(302, '/next');
              return;
            default:
              throw new Error(`Unhandled path ${path}`);
          }
        },
      },
      request: new Request(`https://runtime.test${path}`),
    });

    const objectResponse = await responseFor('/object');
    const arrayResponse = await responseFor('/array');
    const stringResponse = await responseFor('/string');
    const bytesResponse = await responseFor('/bytes');
    const bufferResponse = await responseFor('/buffer');
    const headerResponse = await responseFor('/headers');
    const redirectResponse = await responseFor('/redirect');

    expect(objectResponse.headers.get('content-type')).toContain('application/json');
    await expect(objectResponse.json()).resolves.toEqual({ ok: true });
    expect(arrayResponse.headers.get('content-type')).toContain('application/json');
    await expect(arrayResponse.json()).resolves.toEqual([{ ok: true }]);
    expect(stringResponse.headers.get('content-type')).toContain('text/plain');
    await expect(stringResponse.text()).resolves.toBe('plain');
    expect(bytesResponse.headers.get('content-type')).toContain('application/octet-stream');
    await expect(bytesResponse.text()).resolves.toBe('AB');
    expect(bufferResponse.headers.get('content-type')).toContain('application/octet-stream');
    await expect(bufferResponse.text()).resolves.toBe('CD');
    expect(headerResponse.status).toBe(202);
    expect(headerResponse.headers.get('x-contract')).toBe('preserved');
    await expect(headerResponse.json()).resolves.toEqual({ ok: true });
    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get('location')).toBe('/next');
  });

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

  it('preserves query decoding semantics for repeated, empty, and plus-separated values', async () => {
    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          expect(request.query).toEqual({
            empty: '',
            encoded: 'hello world',
            flag: '',
            plain: 'ok',
            tag: ['one', 'two'],
          });
          await frameworkResponse.send({ ok: true });
        },
      },
      request: new Request('https://runtime.test/query?tag=one&tag=two&empty=&flag&encoded=hello+world&plain=ok'),
    });

    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('matches URLSearchParams semantics for malformed percent-encoded query values', async () => {
    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          expect(request.query).toEqual({
            bad: '�%A',
            ok: 'hello world',
          });
          await frameworkResponse.send({ ok: true });
        },
      },
      request: new Request('https://runtime.test/query?bad=%E0%A4%A&ok=hello+world'),
    });

    await expect(response.json()).resolves.toEqual({ ok: true });
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

  it('returns an open native SSE Response before dispatch lifecycle completion and closes on cancellation', async () => {
    let resolveSse: (sse: SseResponse) => void = () => undefined;
    const sseCreated = new Promise<SseResponse>((resolve) => {
      resolveSse = resolve;
    });
    let resolveDispatchFinished: () => void = () => undefined;
    const dispatchFinished = new Promise<void>((resolve) => {
      resolveDispatchFinished = resolve;
    });

    const response = await waitForSettlement(dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          const sse = new SseResponse({
            container: {} as never,
            metadata: {},
            request,
            requestId: 'req-web-open-sse',
            response: frameworkResponse,
          });

          sse.send('connected', { event: 'ready' });
          resolveSse(sse);
          await sse.completion;
          resolveDispatchFinished();
        },
      },
      request: new Request('https://runtime.test/open-events', {
        headers: {
          accept: 'text/event-stream',
        },
      }),
    }));
    const sse = await sseCreated;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    if (!response.body) {
      throw new Error('Expected a native SSE response body.');
    }

    const reader = response.body.getReader();
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: new TextEncoder().encode('event: ready\ndata: connected\n\n'),
    });
    await reader.cancel('client-disconnected');
    await waitForSettlement(dispatchFinished);

    expect(sse.send('ignored-after-cancel')).toBe(false);
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

  it('uses maxBodySize as the Web multipart total-size fallback', async () => {
    const boundary = 'fluo-boundary';
    const body = `--${boundary}\r\ncontent-disposition: form-data; name="name"\r\n\r\nAda Lovelace\r\n--${boundary}--\r\n`;

    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch() {
          throw new Error('should not dispatch oversized multipart request');
        },
      },
      maxBodySize: 10,
      request: new Request('https://runtime.test/upload', {
        body,
        headers: {
          'content-length': String(Buffer.byteLength(body)),
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'x-request-id': 'req-web-multipart-fallback',
        },
        method: 'POST',
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: 'Multipart body exceeds the maximum size of 10 bytes.',
        requestId: 'req-web-multipart-fallback',
        status: 413,
      },
    });
  });

  it('reuses an injected web factory without sharing request-specific state', async () => {
    const factory = createWebRequestResponseFactory({ rawBody: true });
    const seenBodies: unknown[] = [];
    const seenRawBodies: string[] = [];

    const dispatch = (name: string) => dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          seenBodies.push(request.body);
          seenRawBodies.push(Buffer.from(request.rawBody ?? new Uint8Array()).toString('utf8'));
          await frameworkResponse.send({ name });
        },
      },
      factory,
      request: new Request('https://runtime.test/reused-factory', {
        body: JSON.stringify({ name }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    });

    const firstResponse = await dispatch('first');
    const secondResponse = await dispatch('second');

    await expect(firstResponse.json()).resolves.toEqual({ name: 'first' });
    await expect(secondResponse.json()).resolves.toEqual({ name: 'second' });
    expect(seenBodies).toEqual([{ name: 'first' }, { name: 'second' }]);
    expect(seenRawBodies).toEqual(['{"name":"first"}', '{"name":"second"}']);
  });

  it('lets an injected web factory own parsing options over dispatch options', async () => {
    const factory = createWebRequestResponseFactory({ rawBody: true });
    let rawBody: Uint8Array | undefined;

    await dispatchWebRequest({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          rawBody = request.rawBody;
          await frameworkResponse.send({ ok: true });
        },
      },
      factory,
      rawBody: false,
      request: new Request('https://runtime.test/factory-options', {
        body: JSON.stringify({ ok: true }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    });

    expect(Buffer.from(rawBody ?? new Uint8Array()).toString('utf8')).toBe('{"ok":true}');
  });

  it('keeps the original Web request body readable after dispatch materializes JSON bodies', async () => {
    const request = new Request('https://runtime.test/raw-observability', {
      body: JSON.stringify({ ok: true }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    let rawBodyUsedDuringDispatch: boolean | undefined;

    const response = await dispatchWebRequest({
      dispatcher: {
        async dispatch(frameworkRequest, frameworkResponse) {
          rawBodyUsedDuringDispatch = (frameworkRequest.raw as Request).bodyUsed;
          await frameworkResponse.send({ ok: frameworkRequest.body });
        },
      },
      request,
    });

    expect(rawBodyUsedDuringDispatch).toBe(false);
    expect(request.bodyUsed).toBe(false);
    await expect(request.json()).resolves.toEqual({ ok: true });
    expect(request.bodyUsed).toBe(true);
    await expect(response.json()).resolves.toEqual({ ok: { ok: true } });
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

  it('creates the request shell before materializing body and rawBody while keeping the raw request readable', async () => {
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
    expect(request.bodyUsed).toBe(false);

    await factory.materializeRequest?.(frameworkRequest);
    await factory.materializeRequest?.(frameworkRequest);

    expect(cloneCalls).toBe(1);
    expect(pulls).toBe(1);
    expect(frameworkRequest.body).toEqual({ ok: true });
    expect(Buffer.from(frameworkRequest.rawBody ?? new Uint8Array()).toString('utf8')).toBe('{"ok":true}');
    expect(request.bodyUsed).toBe(false);
    await expect(request.json()).resolves.toEqual({ ok: true });
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

  it('materializes deferred multipart bodies via a clone so the raw request stays readable', async () => {
    const formData = new FormData();
    formData.set('title', 'before');
    const request = new Request('https://runtime.test/upload', {
      body: formData,
      method: 'POST',
    });
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

    expect(cloneCalls).toBe(1);
    expect(frameworkRequest.body).toEqual({ title: 'before' });
    expect(request.bodyUsed).toBe(false);

    const rawFormData = await request.formData();

    expect(rawFormData.get('title')).toBe('before');
  });
});
