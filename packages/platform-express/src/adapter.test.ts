import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';

import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

import { describe, expect, it, vi } from 'vitest';

import { Container } from '@fluojs/di';
import {
  All,
  type CallHandler,
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
  type FrameworkRequest,
  type FrameworkResponse,
  type GuardContext,
  type InterceptorContext,
  type MiddlewareContext,
  type RequestObservationContext,
  type RequestContext,
  type RequestObserver,
} from '@fluojs/http';
import {
  createHealthModule,
  defineModule,
  fluoFactory,
  type ApplicationLogger,
} from '@fluojs/runtime';
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/http-adapter-portability';

import {
  bootstrapExpressApplication,
  createExpressAdapter,
  ExpressHttpApplicationAdapter,
  isExpressMultipartTooLargeError,
  runExpressApplication,
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
    const server = createNetServer();

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
  headers?: Record<string, string>;
  method?: string;
  path: string;
  port: number;
}): Promise<{ body: string; headers: Headers; statusCode: number }> {
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
          headers: new Headers(response.headers as Record<string, string>),
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

function isExpressResponse(value: unknown): value is ExpressResponse {
  return typeof value === 'object' && value !== null && 'emit' in value;
}

interface ExpressJsonSettingsHost {
  set(name: 'json replacer', value: (key: string, value: unknown) => unknown): void;
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

const expressPortabilityHarness = createHttpAdapterPortabilityHarness({
  bootstrap: bootstrapExpressApplication,
  name: 'express',
  run: runExpressApplication,
});

describe('@fluojs/platform-express', () => {
  describe('adapter portability', () => {
    it('preserves malformed cookie values', async () => {
      await expressPortabilityHarness.assertPreservesMalformedCookieValues();
    });

    it('preserves raw body for JSON and text requests when enabled', async () => {
      await expressPortabilityHarness.assertPreservesRawBodyForJsonAndText();
    });

    it('preserves exact raw body bytes for byte-sensitive payloads', async () => {
      await expressPortabilityHarness.assertPreservesExactRawBodyBytesForByteSensitivePayloads();
    });

    it('does not preserve rawBody for multipart requests', async () => {
      await expressPortabilityHarness.assertExcludesRawBodyForMultipart();
    });

    it('defaults multipart.maxTotalSize to maxBodySize', async () => {
      await expressPortabilityHarness.assertDefaultsMultipartTotalLimitToMaxBodySize();
    });

    it('supports SSE streaming', async () => {
      await expressPortabilityHarness.assertSupportsSseStreaming();
    });

    it('settles stream drain waits when the stream closes first', async () => {
      await expressPortabilityHarness.assertSettlesStreamDrainWaitOnClose();
    });

    it('reports the configured host in startup logs', async () => {
      await expressPortabilityHarness.assertReportsConfiguredHostInStartupLogs();
    });

    it('supports https startup and reports the https listen URL', async () => {
      await expressPortabilityHarness.assertReportsHttpsStartupUrl({
        cert: TEST_TLS_CERTIFICATE,
        key: TEST_TLS_PRIVATE_KEY,
      });
    });

    it('removes registered shutdown signal listeners after close', async () => {
      await expressPortabilityHarness.assertRemovesShutdownSignalListenersAfterClose();
    });
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
        throw new Error('express response parity error');
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [ResponsesController] });

    const port = await findAvailablePort();
    const app = await fluoFactory.create(AppModule, {
      adapter: createExpressAdapter({ port }),
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
      expect(objectResponse.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(objectResponse.body)).toEqual({ ok: true });
      expect(arrayResponse.statusCode).toBe(200);
      expect(arrayResponse.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(arrayResponse.body)).toEqual([{ ok: true }]);
      expect(stringResponse.headers.get('content-type')).toContain('text/plain');
      expect(stringResponse.body).toBe('plain');
      expect(bytesResponse.headers.get('content-type')).toContain('application/octet-stream');
      expect(bytesResponse.body).toBe('AB');
      expect(bufferResponse.headers.get('content-type')).toContain('application/octet-stream');
      expect(bufferResponse.body).toBe('CD');
      expect(headerResponse.statusCode).toBe(202);
      expect(headerResponse.headers.get('x-contract')).toBe('preserved');
      expect(JSON.parse(headerResponse.body)).toEqual({ ok: true });
      expect(redirectResponse.statusCode).toBe(302);
      expect(redirectResponse.headers.get('location')).toBe('/responses/object');
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
      adapter: createExpressAdapter({ port }),
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
        body: JSON.stringify({ ok: true, source: 'express' }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        path: '/body-one',
        port,
      });

      expect(bodyResponse.statusCode).toBe(201);
      expect(JSON.parse(bodyResponse.body)).toEqual({
        body: { ok: true, source: 'express' },
      });
    } finally {
      await app.close();
    }
  });

  it('falls back to raw URL parsing when Express host query values are unsafe or non-simple', async () => {
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
    const adapter = createExpressAdapter({ port }) as ExpressHttpApplicationAdapter;
    const router = (adapter as unknown as {
      router: {
        use: (handler: (request: ExpressRequest, response: ExpressResponse, next: () => void) => void) => void;
      };
    }).router;

    router.use((request, _response, next) => {
      const mutableQuery = request.query as Record<string, unknown>;

      if (request.originalUrl.startsWith('/query-fallback/undefined')) {
        mutableQuery.flag = undefined;
      } else if (request.originalUrl.startsWith('/query-fallback/object')) {
        mutableQuery.nested = { unsafe: 'true' };
      }

      next();
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

  it('keeps the simple JSON fast path off Express json replacer serialization', async () => {
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
    const adapter = createExpressAdapter({ port });
    const expressApp = Reflect.get(adapter, 'app') as ExpressJsonSettingsHost;
    let replacerCalls = 0;

    expressApp.set('json replacer', () => {
      replacerCalls += 1;
      return 'express-native-serializer';
    });

    const app = await fluoFactory.create(AppModule, { adapter });

    await app.listen();

    try {
      const response = await requestHttp({ path: '/serializer/object', port });

      expect(response.statusCode).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.body).toBe(JSON.stringify({ keep: 'generic-json-stringify' }));
      expect(replacerCalls).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('uses the runtime default port instead of process.env.PORT', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '4321';

    try {
      const adapter = createExpressAdapter() as ExpressHttpApplicationAdapter;

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
      const adapter = createExpressAdapter() as ExpressHttpApplicationAdapter;

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

  it('settles stream drain waits when the response stream errors before drain', async () => {
    const drainSettled = createDeferred<void>();

    @Controller('/events')
    class EventsController {
      @Get('/')
      async stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);
        const responseStream = context.response.stream;

        if (!responseStream?.waitForDrain) {
          throw new Error('Express response stream did not expose waitForDrain().');
        }

        const rawResponse = context.response.raw;

        if (!isExpressResponse(rawResponse)) {
          throw new Error('Express response stream did not expose the raw response object.');
        }

        const drainWait = responseStream.waitForDrain();

        queueMicrotask(() => {
          rawResponse.emit('error', new Error('synthetic stream failure'));
        });

        await drainWait;
        drainSettled.resolve();
        stream.close();

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapExpressApplication(AppModule, {
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
            reject(new Error('Express response stream waitForDrain() did not settle after error.'));
          }, 2_000);
        }),
      ])).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('exposes a server-backed realtime capability on the Express adapter', async () => {
    const adapter = createExpressAdapter() as ExpressHttpApplicationAdapter;

    try {
      expect(adapter.getRealtimeCapability()).toEqual({
        kind: 'server-backed',
        server: adapter.getServer(),
      });
    } finally {
      await adapter.close();
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    const app = await runExpressApplication(AppModule, {
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
    const app = await runExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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

  it('registers native Express router routes while preserving fluo matching, versioning, lifecycle, and fallback semantics', async () => {
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
    const adapter = createExpressAdapter({ port }) as ExpressHttpApplicationAdapter;
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
      const router = Reflect.get(adapter, 'router');
      const nativeRoutes = (Reflect.get(router, '__fluoNativeRoutes') as Array<{ methods: string[]; path: string }>)
        .flatMap((route) => route.methods.map((method) => `${method}:${route.path}`));

      expect(nativeRoutes).toContain('GET:/users/:id');
      expect(nativeRoutes).not.toContain('GET:/versions');
      expect(nativeRoutes).toContain('GET:/errors');
      expect(nativeRoutes).not.toContain('PATCH:/fallback');

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

      const optionsFallbackResponse = await requestHttp({
        method: 'OPTIONS',
        path: '/fallback',
        port,
      });
      expect(optionsFallbackResponse.statusCode).toBe(200);
      expect(optionsFallbackResponse.headers.get('allow')).toBeNull();
      expect(JSON.parse(optionsFallbackResponse.body)).toEqual({ method: 'OPTIONS', route: 'all' });

      const unsupportedOptionsResponse = await requestHttp({
        method: 'OPTIONS',
        path: '/users/123',
        port,
      });
      expect(unsupportedOptionsResponse.statusCode).toBe(404);
      expect(unsupportedOptionsResponse.headers.get('allow')).toBeNull();
      expect(JSON.parse(unsupportedOptionsResponse.body)).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'No handler registered for OPTIONS /users/123.',
          status: 404,
        },
      });

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

  it('falls back to dispatcher-only routing for overlapping same-shape param routes and ALL handlers', async () => {
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

    @Controller('/catch-all')
    class CatchAllController {
      @All('/:slug')
      catchAll(_input: undefined, context: RequestContext) {
        return {
          method: context.request.method,
          route: 'all',
          slug: context.request.params.slug,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [MatchesController, CatchAllController],
    });

    const port = await findAvailablePort();
    const adapter = createExpressAdapter({ port }) as ExpressHttpApplicationAdapter;
    const app = await fluoFactory.create(AppModule, { adapter });

    await app.listen();

    try {
      const router = Reflect.get(adapter, 'router');
      const nativeRoutes = (Reflect.get(router, '__fluoNativeRoutes') as Array<{ methods: string[]; path: string }>)
        .flatMap((route) => route.methods.map((method) => `${method}:${route.path}`));

      expect(nativeRoutes).not.toContain('GET:/matches/:id');
      expect(nativeRoutes).not.toContain('GET:/matches/:slug');
      expect(nativeRoutes).not.toContain('PATCH:/catch-all/:slug');

      const [shapeConflictResponse, fallbackResponse, optionsFallbackResponse] = await Promise.all([
        requestHttp({
          method: 'GET',
          path: '/matches/42',
          port,
        }),
        requestHttp({
          method: 'PATCH',
          path: '/catch-all/fallback-check',
          port,
        }),
        requestHttp({
          method: 'OPTIONS',
          path: '/catch-all/fallback-check',
          port,
        }),
      ]);

      expect(shapeConflictResponse.statusCode).toBe(200);
      expect(JSON.parse(shapeConflictResponse.body)).toEqual({
        paramName: 'id',
        route: 'first',
        value: '42',
      });

      expect(fallbackResponse.statusCode).toBe(200);
      expect(JSON.parse(fallbackResponse.body)).toEqual({
        method: 'PATCH',
        route: 'all',
        slug: 'fallback-check',
      });

      expect(optionsFallbackResponse.statusCode).toBe(200);
      expect(optionsFallbackResponse.headers.get('allow')).toBeNull();
      expect(JSON.parse(optionsFallbackResponse.body)).toEqual({
        method: 'OPTIONS',
        route: 'all',
        slug: 'fallback-check',
      });
    } finally {
      await app.close();
    }
  });

  it('hands safe native Express routes to the dispatcher without rematching', async () => {
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
          throw new Error('Express native handoff should bypass handlerMapping.match');
        }),
      },
      rootContainer: root,
    });
    const nativeDispatch = vi.spyOn(dispatcher, 'dispatchNativeRoute');
    const port = await findAvailablePort();
    const adapter = createExpressAdapter({ port }) as ExpressHttpApplicationAdapter;

    await adapter.listen(dispatcher);

    try {
      const response = await requestHttp({
        method: 'GET',
        path: '/native/123',
        port,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ id: '123' });
      expect(nativeDispatch).toHaveBeenCalledTimes(1);
      expect(nativeDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ params: { id: '123' } }),
        expect.objectContaining({ path: '/native/123' }),
        expect.any(Object),
      );
    } finally {
      await adapter.close();
    }
  });

  it('falls back to full dispatch when native Express routes are not fast-path executable', async () => {
    @Controller('/native-fallback')
    class NativeFallbackController {
      @Get('/:id')
      getById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id, route: 'fallback' };
      }
    }

    const root = new Container().register(NativeFallbackController);
    const baseMapping = createHandlerMapping([{ controllerToken: NativeFallbackController }]);
    const dispatcher = createDispatcher({
      handlerMapping: {
        descriptors: baseMapping.descriptors,
        match: vi.fn(() => {
          throw new Error('Express native fallback should reuse framework handoff before rematching.');
        }),
      },
      rootContainer: root,
    });
    const nativeDispatch = vi.fn(async () => false);
    dispatcher.dispatchNativeRoute = nativeDispatch;
    const fullDispatch = vi.spyOn(dispatcher, 'dispatch');
    const port = await findAvailablePort();
    const adapter = createExpressAdapter({ port }) as ExpressHttpApplicationAdapter;

    await adapter.listen(dispatcher);

    try {
      const response = await requestHttp({
        method: 'GET',
        path: '/native-fallback/abc',
        port,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ id: 'abc', route: 'fallback' });
      expect(nativeDispatch).toHaveBeenCalledTimes(1);
      expect(fullDispatch).toHaveBeenCalledTimes(1);
    } finally {
      await adapter.close();
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
    const app = await runExpressApplication(AppModule, {
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

  it('keeps dispatcher until express close settles even when close() times out', async () => {
    const adapter = new ExpressHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
    const dispatcher = {
      async dispatch() {},
    };
    const deferred = createDeferred<void>();
    let closeCallCount = 0;
    const server = {
      close(callback: (error?: Error | null) => void) {
        closeCallCount += 1;
        void deferred.promise.then(() => {
          callback(undefined);
        });
        return this;
      },
      listening: true,
    } as unknown as ReturnType<typeof createHttpServer>;

    Reflect.set(adapter, 'server', server);
    Reflect.set(adapter, 'dispatcher', dispatcher);

    await expect(adapter.close()).rejects.toThrow(/shutdown timeout/i);

    expect(closeCallCount).toBe(1);
    expect(Reflect.get(adapter, 'dispatcher')).toBe(dispatcher);

    deferred.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(Reflect.get(adapter, 'dispatcher')).toBeUndefined();
  });

  it('fails close() when the express server does not stop within the shutdown timeout', async () => {
    const adapter = new ExpressHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
    const server = {
      close(_callback: (error?: Error | null) => void) {
        return this;
      },
      listening: true,
    } as unknown as ReturnType<typeof createHttpServer>;

    Reflect.set(adapter, 'server', server);
    Reflect.set(adapter, 'dispatcher', { async dispatch() {} });

    await expect(adapter.close()).rejects.toThrow(/shutdown timeout/i);
  });

  it('clears the express shutdown timer once close settles', async () => {
    vi.useFakeTimers();

    try {
      const adapter = new ExpressHttpApplicationAdapter(3000, undefined, 150, 20, undefined, undefined, 1024, false, 20);
      const deferred = createDeferred<void>();
      const server = {
        close(callback: (error?: Error | null) => void) {
          void deferred.promise.then(() => {
            callback(undefined);
          });
          return this;
        },
        listening: true,
      } as unknown as ReturnType<typeof createHttpServer>;

      Reflect.set(adapter, 'server', server);
      Reflect.set(adapter, 'dispatcher', { async dispatch() {} });

      const closePromise = adapter.close();

      expect(vi.getTimerCount()).toBeGreaterThan(0);

      deferred.resolve();
      await Promise.resolve();
      await closePromise;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries startup after EADDRINUSE until the port becomes available', async () => {
    const blocker = createHttpServer((_request, response) => {
      response.statusCode = 200;
      response.end('blocked');
    });
    const port = await findAvailablePort();

    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen({ host: '127.0.0.1', port }, () => {
        resolve();
      });
    });

    const closeBlocker = async (): Promise<void> => {
      if (!blocker.listening) {
        return;
      }

      await new Promise<void>((resolve) => {
        blocker.close(() => {
          resolve();
        });
      });
    };

    const adapter = new ExpressHttpApplicationAdapter(port, '127.0.0.1', 20, 20, undefined, undefined, 1024, false, 1_000);
    const dispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(200);
        await response.send({ ok: true });
      },
    };

    try {
      const listenPromise = adapter.listen(dispatcher);

      setTimeout(() => {
        void closeBlocker();
      }, 80);

      await listenPromise;

      const response = await fetch(`http://127.0.0.1:${String(port)}/retry-check`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await adapter.close();
      await closeBlocker();
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
    const app = await runExpressApplication(AppModule, {
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
    const app = await bootstrapExpressApplication(AppModule, {
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
    expect(isExpressMultipartTooLargeError(Object.assign(new Error('File too large'), { statusCode: 413 }))).toBe(true);
    expect(isExpressMultipartTooLargeError(Object.assign(new Error('Multipart boundary is invalid'), {
      code: 'MULTIPART_PARSE_FAILED',
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
    const app = await bootstrapExpressApplication(AppModule, {
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
