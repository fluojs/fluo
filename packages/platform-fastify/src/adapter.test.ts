import type { IncomingHttpHeaders } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { describe, expect, it, vi } from 'vitest';

import { Container } from '@fluojs/di';
import {
  All,
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  Header,
  HttpCode,
  Post,
  Redirect,
  SseResponse,
  UseGuards,
  UseInterceptors,
  Version,
  VersioningType,
  type CallHandler,
  type Dispatcher,
    type FrameworkRequest,
    type FrameworkResponse,
    type GuardContext,
  type InterceptorContext,
  type MiddlewareContext,
  type RequestObservationContext,
  type RequestContext,
  type RequestObserver,
} from '@fluojs/http';
import { createHealthModule, defineModule, fluoFactory, type ApplicationLogger } from '@fluojs/runtime';

import {
  bootstrapFastifyApplication,
  createFastifyAdapter,
  FastifyHttpApplicationAdapter,
  isFastifyMultipartTooLargeError,
  runFastifyApplication,
} from './adapter.js';

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve an available port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function requestHttps(url: string): Promise<{ body: string; statusCode: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpsRequest(url, { rejectUnauthorized: false }, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          statusCode: response.statusCode ?? 0,
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.end();
  });
}

async function requestHttp(options: {
  body?: string;
  headers?: IncomingHttpHeaders;
  method?: string;
  path: string;
  port: number;
}): Promise<{ body: string; headers: IncomingHttpHeaders; statusCode: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: options.headers,
      host: '127.0.0.1',
      method: options.method,
      path: options.path,
      port: options.port,
    }, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
          statusCode: response.statusCode ?? 0,
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

const TEST_TLS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBbj6DdMPNvDMr
yNUM0dreceSBINfH+VDV750R3X57mdoqebUgjKOXjbjR7JRkloJ4PEgAic+840rq
tyTN/MvmaAQg5OtNwsY7wp3Owaomr0sqw+wHM7NkPYMB0apxcWEBC7IWph1sKGcC
iRxNDBBMEUmhxscatvhfkB/aqlQxLYjDylFcIX0A3NzIW0Rfaydk7/3R0hqkiF5x
k/98U2cEPZn1E890q4IsfQ6mGMNi/fh1jMWiR5RFL9MlIhLEJPCyuW/sQMYSglan
T2sKcABWjIShAc4gn87ncbmSv/6IDgfXtVRD6mehvFz9iHVSbV5sGM/bE4y3pgj2
kQXpbdUnAgMBAAECggEAT8yIc7kPMmgrACw5YLGOxuhbqb3/51r+s1PIC9/B14IQ
VCejxsrejp6EGe6tBZZmOu47kiVIk5d9h7mIsIZTJDnTQjLOtGTfXTYb3nldFdqJ
exoa3JnCr18FFhIGbAinSUQm81sSllVQseYYy9xnOMqFAv27lFTZwKr3yUEtvJ9h
oYqq5/yRNwwR1AT6lfWgSJa5S9cvs9YHK4k2XCnhKTqWkQ3Bh9awKy83142r1FWy
rXk3IUwNaNAgRHSEw/9MGbcM6it+l55XjwzEBP/lI+DdDzhRhKgp3QsM/v26eHRl
CwP0NA4d4i1m2kcT8dvtSTxrnwbylSxhVRDYXrsOMQKBgQDn+f9I9LlQJdGPWRda
0YiyZtQZTGYfG/ZJvHPvhLA37rAfV7MGDqKgn22FJPJHT9vE+wVkUT531VErKKlO
dOv6GIz/C3AolVTOTDKxTZnFkicxy4J7pZYHPRo8mIVGFlsKsPQVPz63UZMUkbR6
0HkgcihnxKKlYFb+az7hNvPZbwKBgQDVdlglrw9jGreXtGplZLapsTmAc+GuL17R
fqY4/aXNul0k6MNlSrm2/cUm/KI8AsHvRn2tvdFJnM1drmzEpTvcFx5a9N2F5HOU
N1smlv31RT5B0XqoHTB7df2+zVeAGGcpDY8n27KI9/zigVdVQR/aR+fR7CFfNhCv
sI8PQUkzyQKBgQDWKHckjEF0m6VuuGoWPvD6+nF+9Ygl2jOyeRdzHUVuLZ5NITK2
OdargOOkEqrVaQVUQgYFSffou3eW54/+TXT5S6cHYjDmVo6XccMu6pw2yKoEj4Pj
0MfD4QYSwR/wx3y/TwPXha7JoLavO6Cp7UKV0K46tk8Na/aEJNBFLO1MYwKBgElV
jfTsTnn6rMYmikLpNcPYieuyY/8GcSnBu/NqWLLz6poKiU5cPK88QaYiNs4tGFlO
u1CcHLGQeBFOIjnwlj8HhjszUoN0N6zc06jPSNIhhsDv6Zal6IkRwSnyu7PbLl2x
NdQ4qv5ZS/y4+LrmU74W4/J/j/t4xITHQG66PB7ZAoGANNL4daB3T46IElDHnCbl
j4hWQezWEMRCf4Ruqy24peC4Y8CXMaGA0oN6auePuTdLmGYa9nDn0J77rMqLIG7+
v8OLobYRGfklwPOBs5puVFTEgihMq7Ejh2r9HhoRiCAZS5hIirS08BgrAskgVw9P
dM+3fSZauOH3r+7JXAvrtMo=
-----END PRIVATE KEY-----`;

const TEST_TLS_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQCAEWnETUdMHDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAkx
MjcuMC4wLjEwHhcNMjYwMzE4MDEzNTQ2WhcNMjYwMzE5MDEzNTQ2WjAUMRIwEAYD
VQQDDAkxMjcuMC4wLjEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDB
bj6DdMPNvDMryNUM0dreceSBINfH+VDV750R3X57mdoqebUgjKOXjbjR7JRkloJ4
PEgAic+840rqtyTN/MvmaAQg5OtNwsY7wp3Owaomr0sqw+wHM7NkPYMB0apxcWEB
C7IWph1sKGcCiRxNDBBMEUmhxscatvhfkB/aqlQxLYjDylFcIX0A3NzIW0Rfaydk
7/3R0hqkiF5xk/98U2cEPZn1E890q4IsfQ6mGMNi/fh1jMWiR5RFL9MlIhLEJPCy
uW/sQMYSglanT2sKcABWjIShAc4gn87ncbmSv/6IDgfXtVRD6mehvFz9iHVSbV5s
GM/bE4y3pgj2kQXpbdUnAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAJhOoDgzUsiV
XE0p5DznahRbv85K05BS6iXfMRnjgHziJyED0h6dD3vpFTnQLW9I7SQeMA21sZPx
MNm+gL8/Jq2G2CGwx0naD9bsTFYboWhBk+SuQVj8f7g8xM7ya2nB8AJg07/n3VD5
NJFlJnyXlpchaxikKeaLWWGJCzPosbqUDdS5Y9S3VkqxM3na4Z+04qLaLQSEEpSi
WZWkDdOMceoMbJC0CpyVtWCW7mKKFOwL/yEtmJ0Uw0aaHwFOEj9+FQUPYjThCcbz
fHFvqyh6pXZV7XKcPxCTNuIw2rpw2WqY5/H+lTmUFmSXieFZAAMRueGH8Y5trCHU
JNCDpGwh8us=
-----END CERTIFICATE-----`;

interface FastifyReplySerializerHost {
  setReplySerializer(serializer: (payload: unknown, statusCode: number) => string): void;
}

describe('@fluojs/platform-fastify', () => {
  it('uses the runtime default port instead of process.env.PORT', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = createFastifyAdapter() as FastifyHttpApplicationAdapter;

      expect(adapter.getListenTarget().url).toBe('http://localhost:3000');
      await adapter.close();
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
    }
  });

  it('does not fail when process.env.PORT is invalid', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = 'not-a-number';

    try {
      const adapter = createFastifyAdapter() as FastifyHttpApplicationAdapter;

      expect(adapter.getListenTarget().url).toBe('http://localhost:3000');
      await adapter.close();
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
    }
  });

  it('exposes a server-backed realtime capability on the Fastify adapter', async () => {
    const adapter = createFastifyAdapter() as FastifyHttpApplicationAdapter;

    try {
      expect(adapter.getRealtimeCapability()).toEqual({
        kind: 'server-backed',
        server: adapter.getServer(),
      });
    } finally {
      await adapter.close();
    }
  });

  it('preserves response parity for simple JSON and non-fast-path responses', async () => {
    @Controller('/responses')
    class ResponsesController {
      @Get('/object')
      getObject() {
        return { ok: true };
      }

      @Get('/array')
      getArray() {
        return [{ ok: true }];
      }

      @Get('/string')
      getString() {
        return 'plain';
      }

      @Get('/bytes')
      getBytes() {
        return Uint8Array.from([65, 66]);
      }

      @Get('/buffer')
      getBuffer() {
        return Uint8Array.from([67, 68]).buffer;
      }

      @Header('X-Contract', 'preserved')
      @HttpCode(202)
      @Get('/headers')
      getHeaders() {
        return { ok: true };
      }

      @Redirect('/responses/object', 302)
      @Get('/redirect')
      getRedirect() {
        return { ignored: true };
      }

      @Get('/error')
      getError() {
        throw new Error('fastify response parity error');
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [ResponsesController] });

    const port = await findAvailablePort();
    const app = await fluoFactory.create(AppModule, {
      adapter: createFastifyAdapter({ port }),
    });

    await app.listen();

    try {
      const objectResponse = await requestHttp({ path: '/responses/object', port });
      const arrayResponse = await requestHttp({ path: '/responses/array', port });
      const stringResponse = await requestHttp({ path: '/responses/string', port });
      const bytesResponse = await requestHttp({ path: '/responses/bytes', port });
      const bufferResponse = await requestHttp({ path: '/responses/buffer', port });
      const headerResponse = await requestHttp({ path: '/responses/headers', port });
      const redirectResponse = await requestHttp({ path: '/responses/redirect', port });
      const errorResponse = await requestHttp({ path: '/responses/error', port });

      expect(objectResponse.statusCode).toBe(200);
      expect(objectResponse.headers['content-type']).toContain('application/json');
      expect(JSON.parse(objectResponse.body)).toEqual({ ok: true });
      expect(arrayResponse.statusCode).toBe(200);
      expect(arrayResponse.headers['content-type']).toContain('application/json');
      expect(JSON.parse(arrayResponse.body)).toEqual([{ ok: true }]);
      expect(stringResponse.headers['content-type']).toContain('text/plain');
      expect(stringResponse.body).toBe('plain');
      expect(bytesResponse.headers['content-type']).toContain('application/octet-stream');
      expect(bytesResponse.body).toBe('AB');
      expect(bufferResponse.headers['content-type']).toContain('application/octet-stream');
      expect(bufferResponse.body).toBe('CD');
      expect(headerResponse.statusCode).toBe(202);
      expect(headerResponse.headers['x-contract']).toBe('preserved');
      expect(JSON.parse(headerResponse.body)).toEqual({ ok: true });
      expect(redirectResponse.statusCode).toBe(302);
      expect(redirectResponse.headers.location).toBe('/responses/object');
      expect(errorResponse.statusCode).toBe(500);
      expect(JSON.parse(errorResponse.body)).toMatchObject({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          status: 500,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('preserves benchmark-style simple query and JSON body routes on the native request path', async () => {
    @Controller('/')
    class BenchmarkController {
      @Get('/query-one')
      readQuery(_input: undefined, context: RequestContext) {
        return {
          encoded: context.request.query.encoded,
          tag: context.request.query.tag,
        };
      }

      @Post('/body-one')
      readBody(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [BenchmarkController] });

    const port = await findAvailablePort();
    const app = await fluoFactory.create(AppModule, {
      adapter: createFastifyAdapter({ port }),
    });

    await app.listen();

    try {
      const queryResponse = await requestHttp({
        method: 'GET',
        path: '/query-one?tag=one&tag=two&encoded=hello+world',
        port,
      });

      expect(queryResponse.statusCode).toBe(200);
      expect(JSON.parse(queryResponse.body)).toEqual({
        encoded: 'hello world',
        tag: ['one', 'two'],
      });

      const bodyResponse = await requestHttp({
        body: JSON.stringify({ ok: true, source: 'fastify' }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        path: '/body-one',
        port,
      });

      expect(bodyResponse.statusCode).toBe(201);
      expect(JSON.parse(bodyResponse.body)).toEqual({
        body: { ok: true, source: 'fastify' },
      });
    } finally {
      await app.close();
    }
  });

  it('falls back to raw URL parsing when Fastify host query values are unsafe or non-simple', async () => {
    @Controller('/query-fallback')
    class QueryFallbackController {
      @Get('/undefined')
      readUndefined(_input: undefined, context: RequestContext) {
        return context.request.query;
      }

      @Get('/object')
      readObject(_input: undefined, context: RequestContext) {
        return context.request.query;
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [QueryFallbackController] });

    const port = await findAvailablePort();
    const adapter = createFastifyAdapter({ port }) as FastifyHttpApplicationAdapter;
    const fastifyApp = (adapter as unknown as {
      app: {
        addHook: (
          name: 'preHandler',
          hook: (
            request: FastifyRequest & { query: Record<string, unknown> },
            reply: FastifyReply,
          ) => Promise<void>,
        ) => void;
      };
    }).app;

    fastifyApp.addHook('preHandler', async (request, _reply) => {
      if (request.raw.url?.startsWith('/query-fallback/undefined')) {
        request.query = { flag: undefined };
        return;
      }

      if (request.raw.url?.startsWith('/query-fallback/object')) {
        request.query = { nested: { unsafe: true } };
      }
    });

    const app = await fluoFactory.create(AppModule, { adapter });

    await app.listen();

    try {
      const undefinedResponse = await requestHttp({
        method: 'GET',
        path: '/query-fallback/undefined?flag',
        port,
      });

      expect(undefinedResponse.statusCode).toBe(200);
      expect(JSON.parse(undefinedResponse.body)).toEqual({ flag: '' });

      const objectResponse = await requestHttp({
        method: 'GET',
        path: '/query-fallback/object?nested=1',
        port,
      });

      expect(objectResponse.statusCode).toBe(200);
      expect(JSON.parse(objectResponse.body)).toEqual({ nested: '1' });
    } finally {
      await app.close();
    }
  });

  it('keeps the simple JSON fast path off Fastify reply serialization overrides', async () => {
    @Controller('/serializer')
    class SerializerController {
      @Get('/object')
      getObject() {
        return { keep: 'generic-json-stringify' };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [SerializerController] });

    const port = await findAvailablePort();
    const adapter = createFastifyAdapter({ port });
    const fastifyApp = Reflect.get(adapter, 'app') as FastifyReplySerializerHost;
    let serializerCalls = 0;

    fastifyApp.setReplySerializer(() => {
      serializerCalls += 1;
      return JSON.stringify({ keep: 'fastify-native-serializer' });
    });

    const app = await fluoFactory.create(AppModule, { adapter });

    await app.listen();

    try {
      const response = await requestHttp({ path: '/serializer/object', port });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).toBe(JSON.stringify({ keep: 'generic-json-stringify' }));
      expect(serializerCalls).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('preserves raw body for JSON and text requests when enabled', async () => {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/json')
      handleJson(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
        };
      }

      @Post('/text')
      handleText(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
      rawBody: true,
    });

    await app.listen();

    const [jsonResponse, textResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/webhooks/json`, {
        body: JSON.stringify({ provider: 'stripe' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      fetch(`http://127.0.0.1:${String(port)}/webhooks/text`, {
        body: 'ping=1',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        method: 'POST',
      }),
    ]);

    expect(jsonResponse.status).toBe(201);
    await expect(jsonResponse.json()).resolves.toEqual({
      parsed: { provider: 'stripe' },
      raw: '{"provider":"stripe"}',
    });

    expect(textResponse.status).toBe(201);
    await expect(textResponse.json()).resolves.toEqual({
      parsed: 'ping=1',
      raw: 'ping=1',
    });

    await app.close();
  });

  it('preserves raw body as exact bytes for byte-sensitive payloads when enabled', async () => {
    const port = await findAvailablePort();
    const adapter = createFastifyAdapter({ port, rawBody: true }) as FastifyHttpApplicationAdapter;
    const app = Reflect.get(adapter, 'app') as {
      addContentTypeParser: (
        contentType: string,
        options: { parseAs: 'buffer' },
        parser: (
          request: unknown,
          body: Buffer,
          done: (error: Error | null, body: Buffer) => void,
        ) => void,
      ) => void;
    };

    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    const dispatcher: Dispatcher = {
      async dispatch(request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(201);
        await response.send({
          rawBytes: Array.from(request.rawBody ?? new Uint8Array()),
        });
      },
    };

    await adapter.listen(dispatcher);

    const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0x41, 0x42]);
    const response = await fetch(`http://127.0.0.1:${String(port)}/webhooks/bytes`, {
      body: bytes,
      headers: { 'content-type': 'application/octet-stream' },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      rawBytes: Array.from(bytes),
    });

    await adapter.close();
  });

  it('bypasses raw-body capture for multipart requests at the Fastify hook layer', async () => {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
      rawBody: true,
    });
    const adapter = Reflect.get(app, 'adapter') as FastifyHttpApplicationAdapter;
    const fastifyApp = Reflect.get(adapter, 'app') as {
      addHook: (name: 'preHandler', hook: (request: { rawBody?: Buffer; headers: Record<string, string | string[] | undefined> }) => void) => void;
    };
    const observedMultipartRawBodyStates: boolean[] = [];
    const observedMultipartRequest = createDeferred<void>();

    fastifyApp.addHook('preHandler', (request) => {
      const contentType = request.headers['content-type'];
      const primaryValue = Array.isArray(contentType) ? contentType[0] : contentType;

      if (typeof primaryValue === 'string' && primaryValue.includes('multipart/form-data')) {
        observedMultipartRawBodyStates.push(request.rawBody !== undefined);
        observedMultipartRequest.resolve();
      }
    });

    await app.listen();

    const form = new FormData();
    form.set('name', 'Ada');
    form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

    const abortController = new AbortController();
    const multipartRequest = fetch(`http://127.0.0.1:${String(port)}/uploads`, {
      body: form,
      method: 'POST',
      signal: abortController.signal,
    });

    await expect(Promise.race([
      observedMultipartRequest.promise,
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Multipart request never reached Fastify preHandler hook.'));
        }, 2_000);
      }),
    ])).resolves.toBeUndefined();

    abortController.abort();
    await multipartRequest.catch(() => undefined);
    expect(observedMultipartRawBodyStates).toEqual([false]);

    await app.close();
  });

  it('supports SSE streaming', async () => {
    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);

        stream.comment('connected');
        stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });
        setTimeout(() => {
          stream.close();
        }, 10);

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/events`, {
      headers: { accept: 'text/event-stream' },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: ready');
    expect(body).toContain('data: {"ready":true}');

    await app.close();
  });

  it('registers native Fastify routes while preserving fluo matching, versioning, lifecycle, and fallback semantics', async () => {
    const lifecycle: string[] = [];

    const appMiddleware = {
      async handle(context: MiddlewareContext, next: () => Promise<void>) {
        lifecycle.push(`middleware:before:${context.request.method}`);
        await next();
        lifecycle.push(`middleware:after:${context.request.method}`);
      },
    };

    const guard = {
      canActivate(context: GuardContext) {
        lifecycle.push(`guard:${context.handler.route.path}:${context.requestContext.request.params.id ?? '-'}`);
        return true;
      },
    };

    const interceptor = {
      async intercept(context: InterceptorContext, next: CallHandler) {
        lifecycle.push(`interceptor:before:${context.handler.route.path}`);
        const result = await next.handle();
        lifecycle.push(`interceptor:after:${context.handler.route.path}`);
        return result;
      },
    };

    const observer: RequestObserver = {
      onHandlerMatched(context: RequestObservationContext) {
        lifecycle.push(`observer:matched:${context.handler?.route.method}:${context.handler?.route.path}`);
      },
      onRequestError(_context: RequestObservationContext, error: unknown) {
        lifecycle.push(`observer:error:${error instanceof Error ? error.message : String(error)}`);
      },
      onRequestFinish(context: RequestObservationContext) {
        lifecycle.push(`observer:finish:${context.requestContext.request.method}`);
      },
      onRequestStart(context: RequestObservationContext) {
        lifecycle.push(`observer:start:${context.requestContext.request.method}`);
      },
      onRequestSuccess(_context: RequestObservationContext, value: unknown) {
        lifecycle.push(`observer:success:${typeof value === 'object' && value && 'route' in value ? String((value as { route: string }).route) : typeof value}`);
      },
    };

    @Controller('/users')
    class UsersController {
      @Get('/:id')
      @UseGuards(guard)
      @UseInterceptors(interceptor)
      getUser(_input: undefined, context: RequestContext) {
        const queryTag = context.request.query.tag;

        return {
          id: context.request.params.id,
          queryTag,
          route: 'user',
        };
      }
    }

    @Controller('/versions')
    class VersionedController {
      @Get('/')
      @Version('1')
      v1() {
        return { route: 'version', version: '1' };
      }

      @Get('/')
      latest() {
        return { route: 'version', version: 'latest' };
      }
    }

    @Controller('/errors')
    class ErrorsController {
      @Get('/')
      explode() {
        throw new Error('native route boom');
      }
    }

    @Controller('/fallback')
    class FallbackController {
      @All('/')
      handle(_input: undefined, context: RequestContext) {
        return { method: context.request.method, route: 'all' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController, VersionedController, ErrorsController, FallbackController],
    });

    const port = await findAvailablePort();
    const adapter = createFastifyAdapter({ port }) as FastifyHttpApplicationAdapter;
    const app = await fluoFactory.create(AppModule, {
      adapter,
      middleware: [appMiddleware],
      observers: [observer],
      versioning: {
        header: 'x-api-version',
        type: VersioningType.HEADER,
      },
    });

    await app.listen();

    try {
      const fastifyApp = (adapter as unknown as Record<'app', {
        hasRoute: (options: { method: string; url: string }) => boolean;
        printRoutes: () => string;
      }>).app;

      expect(fastifyApp.hasRoute({ method: 'GET', url: '/users/:id' })).toBe(true);
      expect(fastifyApp.hasRoute({ method: 'PATCH', url: '/fallback' })).toBe(false);
      expect(fastifyApp.hasRoute({ method: 'GET', url: '/versions' })).toBe(false);
      expect(fastifyApp.printRoutes()).toContain('*');

      lifecycle.length = 0;
      const userResponse = await requestHttp({
        method: 'GET',
        path: '/users///123/?tag=a&tag=b',
        port,
      });

      expect(userResponse.statusCode).toBe(200);
      expect(JSON.parse(userResponse.body)).toEqual({
        id: '123',
        queryTag: ['a', 'b'],
        route: 'user',
      });
      expect(lifecycle).toContain('observer:matched:GET:/users/:id');
      expect(lifecycle).toContain('guard:/users/:id:123');
      expect(lifecycle).toContain('interceptor:before:/users/:id');
      expect(lifecycle).toContain('interceptor:after:/users/:id');
      expect(lifecycle).toContain('observer:success:user');
      expect(lifecycle.indexOf('observer:start:GET')).toBeLessThan(lifecycle.indexOf('middleware:before:GET'));
      expect(lifecycle.indexOf('middleware:before:GET')).toBeLessThan(lifecycle.indexOf('observer:matched:GET:/users/:id'));
      expect(lifecycle.indexOf('observer:matched:GET:/users/:id')).toBeLessThan(lifecycle.indexOf('guard:/users/:id:123'));
      expect(lifecycle.indexOf('guard:/users/:id:123')).toBeLessThan(lifecycle.indexOf('interceptor:before:/users/:id'));
      expect(lifecycle.indexOf('interceptor:before:/users/:id')).toBeLessThan(lifecycle.indexOf('interceptor:after:/users/:id'));
      expect(lifecycle.indexOf('interceptor:after:/users/:id')).toBeLessThan(lifecycle.indexOf('observer:success:user'));
      expect(lifecycle.indexOf('observer:success:user')).toBeLessThan(lifecycle.indexOf('middleware:after:GET'));
      expect(lifecycle.indexOf('middleware:after:GET')).toBeLessThan(lifecycle.indexOf('observer:finish:GET'));

      const versionedResponse = await requestHttp({
        headers: { 'x-api-version': '1' },
        method: 'GET',
        path: '/versions/',
        port,
      });
      expect(versionedResponse.statusCode).toBe(200);
      expect(JSON.parse(versionedResponse.body)).toEqual({ route: 'version', version: '1' });

      const unversionedResponse = await requestHttp({
        method: 'GET',
        path: '/versions',
        port,
      });
      expect(unversionedResponse.statusCode).toBe(200);
      expect(JSON.parse(unversionedResponse.body)).toEqual({ route: 'version', version: 'latest' });

      const allResponse = await requestHttp({
        method: 'PATCH',
        path: '/fallback',
        port,
      });
      expect(allResponse.statusCode).toBe(200);
      expect(JSON.parse(allResponse.body)).toEqual({ method: 'PATCH', route: 'all' });

      lifecycle.length = 0;
      const errorResponse = await requestHttp({
        method: 'GET',
        path: '/errors',
        port,
      });
      expect(errorResponse.statusCode).toBe(500);
      expect(JSON.parse(errorResponse.body)).toEqual({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error.',
          status: 500,
        },
      });
      expect(lifecycle).toContain('observer:error:native route boom');

      const missingResponse = await requestHttp({
        method: 'GET',
        path: '/missing',
        port,
      });
      expect(missingResponse.statusCode).toBe(404);
      expect(JSON.parse(missingResponse.body)).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'No handler registered for GET /missing.',
          status: 404,
        },
      });
    } finally {
      await app.close();
    }
  });

  it('falls back to wildcard dispatch for overlapping same-shape param routes without changing fluo route order semantics', async () => {
    @Controller('/matches')
    class MatchesController {
      @Get('/:id')
      firstMatch(_input: undefined, context: RequestContext) {
        return {
          paramName: 'id',
          route: 'first',
          value: context.request.params.id,
        };
      }

      @Get('/:slug')
      secondMatch(_input: undefined, context: RequestContext) {
        return {
          paramName: 'slug',
          route: 'second',
          value: context.request.params.slug,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [MatchesController],
    });

    const port = await findAvailablePort();
    const adapter = createFastifyAdapter({ port }) as FastifyHttpApplicationAdapter;
    const app = await fluoFactory.create(AppModule, { adapter });

    await app.listen();

    try {
      const fastifyApp = (adapter as unknown as Record<'app', {
        hasRoute: (options: { method: string; url: string }) => boolean;
      }>).app;

      expect(fastifyApp.hasRoute({ method: 'GET', url: '/matches/:id' })).toBe(false);
      expect(fastifyApp.hasRoute({ method: 'GET', url: '/matches/:slug' })).toBe(false);

      const response = await requestHttp({
        method: 'GET',
        path: '/matches/42',
        port,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        paramName: 'id',
        route: 'first',
        value: '42',
      });
    } finally {
      await app.close();
    }
  });

  it('settles stream drain waits when the response stream closes before drain', async () => {
    const drainSettled = createDeferred<void>();

    @Controller('/events')
    class EventsController {
      @Get('/')
      async stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);
        const responseStream = context.response.stream;

        if (!responseStream?.waitForDrain) {
          throw new Error('Fastify response stream did not expose waitForDrain().');
        }

        const drainWait = responseStream.waitForDrain();
        stream.close();
        await drainWait;
        drainSettled.resolve();

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/events`, {
        headers: { accept: 'text/event-stream' },
      });

      expect(response.status).toBe(200);
      await response.text();
      await expect(Promise.race([
        drainSettled.promise,
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('Fastify response stream waitForDrain() did not settle after close.'));
          }, 2_000);
        }),
      ])).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('does not preserve rawBody for multipart requests', async () => {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
          fileCount: context.request.files?.length ?? 0,
          hasRawBody: context.request.rawBody !== undefined,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
      rawBody: true,
    });

    await app.listen();

    const form = new FormData();
    form.set('name', 'Ada');
    form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

    const response = await fetch(`http://127.0.0.1:${String(port)}/uploads`, {
      body: form,
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      body: { name: 'Ada' },
      fileCount: 1,
      hasRawBody: false,
    });

    await app.close();
  });

  it('rejects multipart payloads once the cumulative body size exceeds multipart.maxTotalSize', async () => {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
          fileCount: context.request.files?.length ?? 0,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      multipart: {
        maxFileSize: 1024,
        maxTotalSize: 10,
      },
      port,
    });

    await app.listen();

    const form = new FormData();
    form.set('name', 'Ada');
    form.set('payload', new Blob(['1234567890'], { type: 'text/plain' }), 'payload.txt');

    const response = await fetch(`http://127.0.0.1:${String(port)}/uploads`, {
      body: form,
      method: 'POST',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
      },
    });

    await app.close();
  });

  it('defaults multipart.maxTotalSize to maxBodySize when no explicit multipart total is provided', async () => {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
          fileCount: context.request.files?.length ?? 0,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      maxBodySize: 8,
      multipart: {
        maxFileSize: 1024,
      },
      port,
    });

    await app.listen();

    const form = new FormData();
    form.set('name', 'Ada');
    form.set('payload', new Blob(['12345678'], { type: 'text/plain' }), 'payload.txt');

    const response = await fetch(`http://127.0.0.1:${String(port)}/uploads`, {
      body: form,
      method: 'POST',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
      },
    });

    await app.close();
  });

  it('accepts a cors string and merges framework defaults', async () => {
    @Controller('/ping')
    class PingController {
      @Get('/')
      ping() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [PingController] });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: 'https://my-frontend.com',
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/ping`, {
      headers: { origin: 'https://my-frontend.com' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('https://my-frontend.com');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Request-Id');

    await app.close();
  });

  it('does not add CORS headers or preflight handling when cors is false', async () => {
    @Controller('/ping')
    class PingController {
      @Get('/')
      ping() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [PingController] });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const [response, corsPreflight] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/ping`, {
        headers: { origin: 'https://example.com' },
      }),
      fetch(`http://127.0.0.1:${String(port)}/ping`, {
        headers: {
          'access-control-request-method': 'GET',
          origin: 'https://example.com',
        },
        method: 'OPTIONS',
      }),
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(corsPreflight.status).toBe(404);
    expect(corsPreflight.headers.get('access-control-allow-origin')).toBeNull();

    await app.close();
  });

  it('reports the configured host in startup logs', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message: string, context?: string) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const port = await findAvailablePort();
    const app = await runFastifyApplication(AppModule, {
      cors: false,
      host: '127.0.0.1',
      logger,
      port,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(loggerEvents).toContain(`log:FluoFactory:Listening on http://127.0.0.1:${String(port)}`);

    await app.close();
  });

  it('removes registered shutdown signal listeners after close', async () => {
    const logger: ApplicationLogger = {
      debug() {},
      error() {},
      log() {},
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const signal = 'SIGTERM' as const;
    const listenersBefore = new Set(process.listeners(signal));
    const port = await findAvailablePort();
    const app = await runFastifyApplication(AppModule, {
      cors: false,
      logger,
      port,
      shutdownSignals: [signal],
    });

    const registeredListeners = process.listeners(signal).filter((listener) => !listenersBefore.has(listener));
    expect(registeredListeners.length).toBeGreaterThan(0);

    await app.close();

    for (const listener of registeredListeners) {
      expect(process.listeners(signal)).not.toContain(listener);
    }
  });

  it('does not leak global-prefix path rewrites to request observers', async () => {
    const observedPaths: string[] = [];

    class PathObserver {
      onRequestFinish(context: { requestContext: { request: FrameworkRequest } }) {
        observedPaths.push(context.requestContext.request.path);
      }
    }

    @Controller('/app')
    class AppController {
      @Get('/info')
      getInfo() {
        return { ok: true, route: 'app-info' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [AppController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      observers: [new PathObserver()],
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/app/info`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, route: 'app-info' });
    expect(observedPaths).toEqual(['/api/app/info']);

    await app.close();
  });

  it('applies a global prefix to runtime-owned paths by default', async () => {
    const HealthModule = createHealthModule();

    @Controller('/app')
    class AppController {
      @Get('/info')
      getInfo() {
        return { ok: true, route: 'app-info' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [AppController],
      imports: [HealthModule],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      port,
    });

    await app.listen();

    const [prefixedApp, prefixedHealth, health] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/api/app/info`),
      fetch(`http://127.0.0.1:${String(port)}/api/health`),
      fetch(`http://127.0.0.1:${String(port)}/health`),
    ]);

    expect(prefixedApp.status).toBe(200);
    await expect(prefixedApp.json()).resolves.toEqual({ ok: true, route: 'app-info' });
    expect(prefixedHealth.status).toBe(200);
    await expect(prefixedHealth.json()).resolves.toEqual({ status: 'ok' });
    expect(health.status).toBe(404);

    await app.close();
  });

  it('hands safe native Fastify routes to the dispatcher without rematching', async () => {
    @Controller('/native')
    class NativeController {
      @Get('/:id')
      getById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id };
      }
    }

    const root = new Container().register(NativeController);
    const baseMapping = createHandlerMapping([{ controllerToken: NativeController }]);
    const dispatcher = createDispatcher({
      handlerMapping: {
        descriptors: baseMapping.descriptors,
        match: vi.fn(() => {
          throw new Error('Fastify native handoff should bypass handlerMapping.match');
        }),
      },
      rootContainer: root,
    });
    const port = await findAvailablePort();
    const adapter = createFastifyAdapter({ port }) as FastifyHttpApplicationAdapter;

    await adapter.listen(dispatcher);

    try {
      const response = await requestHttp({
        method: 'GET',
        path: '/native/123',
        port,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ id: '123' });
    } finally {
      await adapter.close();
    }
  });

  it('preserves request header passthrough on native and fallback dispatch paths', async () => {
    @Controller('/headers')
    class HeaderController {
      @Get('/native')
      getNative(_input: undefined, context: RequestContext) {
        return {
          requestId: context.request.headers['x-request-id'],
        };
      }

      @All('/fallback')
      getFallback(_input: undefined, context: RequestContext) {
        return {
          requestId: context.request.headers['x-request-id'],
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [HeaderController] });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    try {
      const [nativeResponse, fallbackResponse] = await Promise.all([
        requestHttp({
          headers: { 'x-request-id': 'native-req' },
          method: 'GET',
          path: '/headers/native',
          port,
        }),
        requestHttp({
          headers: { 'x-request-id': 'fallback-req' },
          method: 'PATCH',
          path: '/headers/fallback',
          port,
        }),
      ]);

      expect(nativeResponse.statusCode).toBe(200);
      expect(JSON.parse(nativeResponse.body)).toEqual({ requestId: 'native-req' });
      expect(fallbackResponse.statusCode).toBe(200);
      expect(JSON.parse(fallbackResponse.body)).toEqual({ requestId: 'fallback-req' });
    } finally {
      await app.close();
    }
  });

  it('snapshots request headers before middleware can mutate raw headers', async () => {
    const mutatingMiddleware = {
      async handle(context: MiddlewareContext, next: () => Promise<void>) {
        const rawRequest = context.request.raw as { headers?: Record<string, string | string[] | undefined> };

        if (rawRequest.headers) {
          rawRequest.headers['x-request-id'] = 'mutated-after-wrapper-create';
        }

        await next();
      },
    };

    @Controller('/snapshot')
    class SnapshotController {
      @Get('/headers')
      getHeaders(_input: undefined, context: RequestContext) {
        return {
          requestId: context.request.headers['x-request-id'],
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [SnapshotController] });

    const port = await findAvailablePort();
    const app = await fluoFactory.create(AppModule, {
      adapter: createFastifyAdapter({ port }),
      middleware: [mutatingMiddleware],
    });

    await app.listen();

    try {
      const response = await requestHttp({
        headers: { 'x-request-id': 'original-at-wrapper-create' },
        method: 'GET',
        path: '/snapshot/headers',
        port,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ requestId: 'original-at-wrapper-create' });
    } finally {
      await app.close();
    }
  });

  it('supports https startup and reports the https listen URL', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message: string, context?: string) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const port = await findAvailablePort();
    const app = await runFastifyApplication(AppModule, {
      cors: false,
      host: '127.0.0.1',
      https: {
        cert: TEST_TLS_CERTIFICATE,
        key: TEST_TLS_PRIVATE_KEY,
      },
      logger,
      port,
    });

    const response = await requestHttps(`https://127.0.0.1:${String(port)}/health`);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(loggerEvents).toContain(`log:FluoFactory:Listening on https://127.0.0.1:${String(port)}`);

    await app.close();
  });

  it('keeps dispatcher until fastify close settles even when close() times out', async () => {
    const adapter = new FastifyHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
    const app = {
      close: () => Promise.resolve(),
      server: {
        listening: true,
      },
    };
    const dispatcher = {
      async dispatch() {},
    };
    const deferred = createDeferred<void>();
    let closeCallCount = 0;

    Reflect.set(adapter, 'app', app);
    Reflect.set(adapter, 'dispatcher', dispatcher);
    app.close = () => {
      closeCallCount += 1;
      return deferred.promise;
    };

    await expect(adapter.close()).rejects.toThrow(/shutdown timeout/i);

    expect(closeCallCount).toBe(1);
    expect(Reflect.get(adapter, 'dispatcher')).toBe(dispatcher);

    deferred.resolve();
    await Promise.resolve();

    expect(Reflect.get(adapter, 'dispatcher')).toBeUndefined();
  });

  it('reuses the same in-flight close promise and stays idempotent after shutdown settles', async () => {
    const adapter = new FastifyHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
    const deferred = createDeferred<void>();
    let closeCallCount = 0;
    const app = {
      close: () => {
        closeCallCount += 1;
        return deferred.promise;
      },
      server: {
        listening: true,
      },
    };

    Reflect.set(adapter, 'app', app);
    Reflect.set(adapter, 'dispatcher', { async dispatch() {} });

    const firstClose = adapter.close();
    const secondClose = adapter.close();

    expect(closeCallCount).toBe(1);

    deferred.resolve();
    await Promise.all([firstClose, secondClose]);

    expect(Reflect.get(adapter, 'dispatcher')).toBeUndefined();

    app.server.listening = false;
    await expect(adapter.close()).resolves.toBeUndefined();
    expect(closeCallCount).toBe(1);
  });

  it('fails close() when the fastify server does not stop within the shutdown timeout', async () => {
    const adapter = new FastifyHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
    const deferred = createDeferred<void>();
    const app = {
      close: () => deferred.promise,
      server: {
        listening: true,
      },
    };

    Reflect.set(adapter, 'app', app);
    Reflect.set(adapter, 'dispatcher', { async dispatch() {} });

    await expect(adapter.close()).rejects.toThrow(/shutdown timeout/i);

    deferred.resolve();
    await Promise.resolve();
  });

  it('clears the fastify shutdown timer once close settles', async () => {
    vi.useFakeTimers();

    try {
      const adapter = new FastifyHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
      const deferred = createDeferred<void>();
      const app = {
        close: () => deferred.promise,
        server: {
          listening: true,
        },
      };

      Reflect.set(adapter, 'app', app);
      Reflect.set(adapter, 'dispatcher', { async dispatch() {} });

      const closePromise = adapter.close();

      expect(vi.getTimerCount()).toBe(1);

      deferred.resolve();
      await Promise.resolve();
      await closePromise;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks shutdown timeout via exitCode without forcing process termination', async () => {
    vi.useFakeTimers();

    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message: string, context?: string) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const originalExitCode = process.exitCode;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number | string | null) => undefined as never) as typeof process.exit);
    const port = await findAvailablePort();
    const app = await runFastifyApplication(AppModule, {
      cors: false,
      forceExitTimeoutMs: 25,
      logger,
      port,
      shutdownSignals: ['SIGTERM'],
    });

    const originalClose = app.close.bind(app);
    app.close = () => new Promise<void>(() => {});

    try {
      process.emit('SIGTERM', 'SIGTERM');
      await vi.advanceTimersByTimeAsync(26);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(loggerEvents).toContain(
        'error:FluoFactory:Shutdown timeout exceeded after 25ms; leaving process termination to the host.:none',
      );
    } finally {
      app.close = originalClose;
      await app.close();
      exitSpy.mockRestore();
      process.exitCode = originalExitCode;
      vi.useRealTimers();
    }
  });

  it('keeps malformed cookie values instead of failing the request', async () => {
    @Controller('/cookies')
    class CookieController {
      @Get('/')
      readCookies(_input: undefined, context: RequestContext) {
        return context.request.cookies;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CookieController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/cookies`, {
      headers: {
        cookie: 'good=hello%20world; bad=%E0%A4%A',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bad: '%E0%A4%A',
      good: 'hello world',
    });

    await app.close();
  });

  it('classifies only explicit multipart limit errors as payload-too-large', () => {
    expect(isFastifyMultipartTooLargeError(Object.assign(new Error('File too large'), { statusCode: 413 }))).toBe(true);
    expect(isFastifyMultipartTooLargeError(Object.assign(new Error('Multipart boundary is invalid'), {
      code: 'FST_INVALID_MULTIPART_CONTENT_TYPE',
      name: 'FastifyError',
      statusCode: 400,
    }))).toBe(false);
  });

  it('propagates abort signal when the client disconnects', async () => {
    const aborted = createDeferred<void>();

    @Controller('/abort')
    class AbortController {
      @Get('/')
      async wait(_input: undefined, context: RequestContext) {
        await new Promise<void>((resolve) => {
          context.request.signal?.addEventListener('abort', () => {
            aborted.resolve();
            resolve();
          }, { once: true });
        });

        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [AbortController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapFastifyApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const request = httpRequest({
      host: '127.0.0.1',
      method: 'GET',
      path: '/abort',
      port,
    });
    request.on('error', () => {});
    request.end();

    setTimeout(() => {
      request.destroy();
    }, 20);

    await expect(Promise.race([
      aborted.promise,
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Abort signal was not propagated.'));
        }, 2_000);
      }),
    ])).resolves.toBeUndefined();

    await app.close();
  });
});
