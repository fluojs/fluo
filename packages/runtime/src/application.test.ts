import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';

import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import type { Container } from '@konekti/di';
import {
  Controller,
  FromBody,
  FromQuery,
  FromCookie,
  Get,
  Post,
  Version,
  VersioningType,
  SseResponse,
  createSecurityHeadersMiddleware,
  type RequestContext,
  RequestDto,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type Converter,
} from '@konekti/http';
import { Exclude, Expose, SerializerInterceptor } from '@konekti/serialization';
import { bootstrapApplication, defineModule, KonektiFactory } from './bootstrap.js';
import { ModuleInjectionMetadataError } from './errors.js';
import { createHealthModule } from './health.js';
import { bootstrapNodeApplication, createNodeHttpAdapter, runNodeApplication } from './node.js';
import { COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from './tokens.js';
import type { ApplicationLogger, CompiledModule, ExceptionFilterContext, ExceptionFilterHandler, OnApplicationBootstrap, OnModuleInit } from './types.js';

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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
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

describe('bootstrapApplication', () => {
  it('runs lifecycle hooks in deterministic order and supports explicit close', async () => {
    const events: string[] = [];
    const adapter: HttpApplicationAdapter = {
      async close(signal) {
        events.push(`adapter:close:${signal ?? 'none'}`);
      },
      async listen() {
        events.push('adapter:listen');
      },
    };

    class AppService {
      onApplicationBootstrap() {
        events.push('app:bootstrap');
      }

      onApplicationShutdown(signal?: string) {
        events.push(`app:shutdown:${signal ?? 'none'}`);
      }

      onModuleDestroy() {
        events.push('module:destroy');
      }

      onModuleInit() {
        events.push('module:init');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [AppService],
    });

    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });

    expect(events).toEqual(['module:init', 'app:bootstrap']);
    expect(app.state).toBe('bootstrapped');

    await app.listen();

    expect(events).toEqual(['module:init', 'app:bootstrap', 'adapter:listen']);
    expect(app.state).toBe('ready');

    await app.close('SIGTERM');
    await app.close('SIGTERM');

    expect(events).toEqual([
      'module:init',
      'app:bootstrap',
      'adapter:listen',
      'module:destroy',
      'app:shutdown:SIGTERM',
      'adapter:close:SIGTERM',
    ]);
    expect(app.state).toBe('closed');
  });

  it('allows close to be retried after an adapter shutdown failure', async () => {
    const events: string[] = [];
    let failClose = true;

    const adapter: HttpApplicationAdapter = {
      async close(signal) {
        events.push(`adapter:close:${signal ?? 'none'}`);

        if (failClose) {
          failClose = false;
          throw new Error('close failed');
        }
      },
      async listen() {
        events.push('adapter:listen');
      },
    };

    class AppModule {}
    defineModule(AppModule, {});

    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });

    await app.listen();
    await expect(app.close('SIGTERM')).rejects.toThrow('close failed');
    expect(app.state).toBe('ready');

    await expect(app.close('SIGTERM')).resolves.toBeUndefined();
    expect(app.state).toBe('closed');
    expect(events).toEqual(['adapter:listen', 'adapter:close:SIGTERM', 'adapter:close:SIGTERM']);
  });

  it('surfaces shutdown hook failures from close() instead of masking them as success', async () => {
    class AppService {
      onApplicationShutdown() {
        throw new Error('shutdown hook failed');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [AppService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    await expect(app.close('SIGTERM')).rejects.toThrow('shutdown hook failed');
    expect(app.state).toBe('bootstrapped');
  });

  it('preserves the original startup failure when adapter close also fails during bootstrap cleanup', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : String(error)}`);
      },
      log() {},
      warn() {},
    };

    const adapter: HttpApplicationAdapter = {
      async close() {
        throw new Error('adapter close failed');
      },
      async listen() {
        throw new Error('listen failed');
      },
    };

    class AppModule {}
    defineModule(AppModule, {});

    const app = await bootstrapApplication({
      adapter,
      logger,
      rootModule: AppModule,
    });

    await expect(app.listen()).rejects.toThrow('listen failed');
    expect(loggerEvents).toContain('error:KonektiApplication:Failed to start the HTTP adapter.:listen failed');
  });

  it('disposes container-managed instances when the application closes', async () => {
    class DisposableResource {
      destroyed = false;

      onDestroy() {
        this.destroyed = true;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [DisposableResource],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const resource = await app.container.resolve(DisposableResource);

    await app.close('SIGTERM');

    expect(resource.destroyed).toBe(true);
  });

  it('injects real runtime tokens before OnModuleInit runs', async () => {
    const adapter: HttpApplicationAdapter = {
      async close() {},
      async listen() {},
    };

    @Inject([RUNTIME_CONTAINER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER])
    class RuntimeTokenProbe implements OnModuleInit, OnApplicationBootstrap {
      seenCompiledModules: readonly CompiledModule[] = [];
      seenContainer: Container | undefined;
      seenAdapter: HttpApplicationAdapter | undefined;
      sawRootModule = false;

      constructor(
        private readonly runtimeContainer: Container,
        private readonly compiledModules: readonly CompiledModule[],
        private readonly httpAdapter: HttpApplicationAdapter,
      ) {}

      async onModuleInit(): Promise<void> {
        this.seenContainer = this.runtimeContainer;
        this.seenCompiledModules = this.compiledModules;
        this.seenAdapter = this.httpAdapter;
      }

      async onApplicationBootstrap(): Promise<void> {
        this.sawRootModule = this.compiledModules.some((compiledModule: CompiledModule) => compiledModule.type === AppModule);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [RuntimeTokenProbe],
    });

    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const probe = await app.container.resolve(RuntimeTokenProbe);

    expect(probe.seenContainer).toBe(app.container);
    expect(probe.seenCompiledModules.length).toBeGreaterThan(0);
    expect(probe.seenCompiledModules.some((compiledModule: CompiledModule) => compiledModule.type === AppModule)).toBe(true);
    expect(probe.seenAdapter).toBe(adapter);
    expect(probe.sawRootModule).toBe(true);
  });

  it('creates applications through KonektiFactory', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const app = await KonektiFactory.create(AppModule, {
    });

    expect(app.rootModule).toBe(AppModule);
  });

  it('treats adapterless bootstrap as an application shell and rejects listen()', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const app = await KonektiFactory.create(AppModule, {});

    await expect(app.ready()).resolves.toBeUndefined();
    await expect(app.listen()).rejects.toThrow(
      'Application cannot listen without an HTTP adapter. Provide options.adapter for HTTP startup, or use createApplicationContext() for adapterless DI-only bootstrap.',
    );
    expect(app.state).toBe('bootstrapped');

    await expect(app.close()).resolves.toBeUndefined();
    expect(app.state).toBe('closed');
  });

  it('applies global converters through KonektiFactory.create()', async () => {
    class QueryNumberConverter implements Converter {
      convert(value: unknown, target: { source: string }) {
        if (target.source === 'query' && typeof value === 'string') {
          return Number(value);
        }

        return value;
      }
    }

    class SearchRequest {
      @FromQuery('id')
      id = 0;
    }

    @Controller('/search')
    class SearchController {
      @RequestDto(SearchRequest)
      @Get('/')
      list(input: SearchRequest) {
        return { id: input.id, type: typeof input.id };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [SearchController],
    });

    const app = await KonektiFactory.create(AppModule, {
      converters: [QueryNumberConverter],
    });

    const response = {
      committed: false,
      headers: {},
      redirect(status: number, location: string) {
        this.setStatus(status);
        this.setHeader('Location', location);
        this.committed = true;
      },
      send(body: unknown) {
        this.body = body;
        this.committed = true;
      },
      setHeader(name: string, value: string | string[]) {
        this.headers[name] = value;
      },
      setStatus(code: number) {
        this.statusCode = code;
        this.statusSet = true;
      },
      statusCode: undefined,
      statusSet: false,
    } as FrameworkResponse & { body?: unknown };

    await app.dispatch(
      {
        body: undefined,
        cookies: {},
        headers: {},
        method: 'GET',
        params: {},
        path: '/search',
        query: { id: '42' },
        raw: {},
        url: '/search?id=42',
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ id: 42, type: 'number' });

    await app.close();
  });

  it('creates node applications that parse JSON request bodies over HTTP', async () => {
    class CreateUserRequest {
      @FromBody('name')
      name = '';
    }

    @Controller('/users')
    class UsersController {
      @RequestDto(CreateUserRequest)
      @Post('/')
      createUser(input: CreateUserRequest) {
        return { name: input.name };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/users`, {
      body: JSON.stringify({ name: 'Ada' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ name: 'Ada' });

    await app.close();
  });

  it('parses repeated query parameters as arrays in Node requests', async () => {
    @Controller('/search')
    class SearchController {
      @Get('/')
      list(_input: undefined, context: RequestContext) {
        return context.request.query;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [SearchController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/search?page=1&tag=a&tag=b&tag=c`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      page: '1',
      tag: ['a', 'b', 'c'],
    });

    await app.close();
  });

  it('applies global converters through runNodeApplication()', async () => {
    class QueryNumberConverter implements Converter {
      convert(value: unknown, target: { source: string }) {
        if (target.source === 'query' && typeof value === 'string') {
          return Number(value);
        }

        return value;
      }
    }

    class SearchRequest {
      @FromQuery('id')
      id = 0;
    }

    @Controller('/search')
    class SearchController {
      @RequestDto(SearchRequest)
      @Get('/')
      list(input: SearchRequest) {
        return { id: input.id, type: typeof input.id };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [SearchController],
    });

    const port = await findAvailablePort();
    const app = await runNodeApplication(AppModule, {
      converters: [QueryNumberConverter],
      cors: false,
      port,
      shutdownSignals: false,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/search?id=42`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 42, type: 'number' });

    await app.close();
  });

  it('provides getServer() on the Node HTTP adapter before listen()', async () => {
    const adapter = createNodeHttpAdapter({ port: 0 }) as { getServer?: () => unknown };

    expect(typeof adapter.getServer).toBe('function');
    expect(adapter.getServer?.()).toBeDefined();
  });

  it('preserves the raw request body for JSON and text requests when enabled', async () => {
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
    const app = await bootstrapNodeApplication(AppModule, {
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

  it('does not expose rawBody unless the Node adapter option is enabled', async () => {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/json')
      handleJson(_input: undefined, context: RequestContext) {
        return {
          hasRawBody: context.request.rawBody !== undefined,
          parsed: context.request.body,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/webhooks/json`, {
      body: JSON.stringify({ provider: 'stripe' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      hasRawBody: false,
      parsed: { provider: 'stripe' },
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
    const app = await bootstrapNodeApplication(AppModule, {
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

  it('serves text and HTML bodies over the Node adapter without JSON quoting', async () => {
    const docsHtml = '<!doctype html><html><body>Docs</body></html>';
    const metricsBody = 'process_cpu_seconds_total 1';

    @Controller('')
    class RuntimeController {
      @Get('/docs')
      getDocs(_input: undefined, context: RequestContext) {
        context.response.setHeader('content-type', 'text/html; charset=utf-8');
        return docsHtml;
      }

      @Get('/metrics')
      getMetrics(_input: undefined, context: RequestContext) {
        context.response.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
        return metricsBody;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RuntimeController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const [docsResponse, metricsResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/docs`),
      fetch(`http://127.0.0.1:${String(port)}/metrics`),
    ]);

    expect(docsResponse.status).toBe(200);
    expect(docsResponse.headers.get('content-type')).toContain('text/html');
    await expect(docsResponse.text()).resolves.toBe(docsHtml);

    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.headers.get('content-type')).toContain('text/plain');
    await expect(metricsResponse.text()).resolves.toBe(metricsBody);

    await app.close();
  });

  it('applies security headers before the response is committed', async () => {
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
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      middleware: [createSecurityHeadersMiddleware()],
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('strict-transport-security')).toBe('max-age=15552000; includeSubDomains');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(response.headers.get('x-xss-protection')).toBe('0');

    await app.close();
  });

  it('keeps the framework response statusCode in sync with Node adapter writes', async () => {
    const observedStatusCodes: number[] = [];

    @Controller('')
    class RuntimeController {
      @Get('/created')
      create(_input: undefined, context: RequestContext) {
        context.response.setStatus(201);

        return { created: true };
      }
    }

    class StatusObserver {
      onRequestFinish(context: { requestContext: RequestContext }) {
        observedStatusCodes.push(context.requestContext.response.statusCode ?? -1);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RuntimeController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      observers: [new StatusObserver()],
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/created`);

    expect(response.status).toBe(201);
    expect(observedStatusCodes).toEqual([201]);
    await expect(response.json()).resolves.toEqual({ created: true });

    await app.close();
  });

  it('returns HTTP 413 when a JSON request body exceeds maxBodySize', async () => {
    class CreateUserRequest {
      @FromBody('name')
      name = '';
    }

    @Controller('/users')
    class UsersController {
      @RequestDto(CreateUserRequest)
      @Post('/')
      createUser(input: CreateUserRequest) {
        return { name: input.name };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      maxBodySize: 8,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/users`, {
      body: JSON.stringify({ name: 'Ada Lovelace' }),
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-oversized-body' },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        details: undefined,
        message: 'Request body exceeds the size limit.',
        meta: undefined,
        requestId: 'req-oversized-body',
        status: 413,
      },
    });

    await app.close();
  });

  it('defaults to URI versioning when no versioning option is provided', async () => {
    @Version('1')
    @Controller('/users')
    class UsersController {
      @Get('/')
      listUsers() {
        return { version: 'v1' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const [versioned, unversioned] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/v1/users`),
      fetch(`http://127.0.0.1:${String(port)}/users`),
    ]);

    expect(versioned.status).toBe(200);
    await expect(versioned.json()).resolves.toEqual({ version: 'v1' });
    expect(unversioned.status).toBe(404);

    await app.close();
  });

  it('supports header-based versioning in bootstrap options', async () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return { version: 'v1' };
      }

      @Version('2')
      @Get('/')
      listV2() {
        return { version: 'v2' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      versioning: {
        header: 'X-API-Version',
        type: VersioningType.HEADER,
      },
    });

    await app.listen();

    const [v1, v2, missing] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/users`, {
        headers: { 'x-api-version': '1' },
      }),
      fetch(`http://127.0.0.1:${String(port)}/users`, {
        headers: { 'X-API-Version': '2' },
      }),
      fetch(`http://127.0.0.1:${String(port)}/users`),
    ]);

    expect(v1.status).toBe(200);
    await expect(v1.json()).resolves.toEqual({ version: 'v1' });
    expect(v2.status).toBe(200);
    await expect(v2.json()).resolves.toEqual({ version: 'v2' });
    expect(missing.status).toBe(404);

    await app.close();
  });

  it('supports media-type versioning in bootstrap options', async () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return { version: 'v1' };
      }

      @Version('2')
      @Get('/')
      listV2() {
        return { version: 'v2' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      versioning: {
        key: 'v=',
        type: VersioningType.MEDIA_TYPE,
      },
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/users`, {
      headers: {
        accept: 'application/json;v=2',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ version: 'v2' });

    await app.close();
  });

  it('supports custom version extractors in bootstrap options', async () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return { version: 'v1' };
      }

      @Version('2')
      @Get('/')
      listV2() {
        return { version: 'v2' };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      versioning: {
        extractor: (request) => {
          const raw = request.headers['x-custom-version'];
          return Array.isArray(raw) ? raw[0] : raw;
        },
        type: VersioningType.CUSTOM,
      },
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/users`, {
      headers: {
        'x-custom-version': '2',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ version: 'v2' });

    await app.close();
  });

  it('runs node applications with runtime-owned defaults', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
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
    const app = await runNodeApplication(AppModule, {
      logger,
      port,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
    const corsPreflight = await fetch(`http://127.0.0.1:${String(port)}/health`, {
      headers: { origin: 'https://example.com' },
      method: 'OPTIONS',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    // CORS is opt-in — without explicit cors option, no CORS middleware is applied
    expect(corsPreflight.status).toBe(404);
    expect(corsPreflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(loggerEvents.some((event) => event.includes(`Listening on http://localhost:${String(port)}`))).toBe(true);

    await app.close();
  });

  it('reports the configured host in the startup log', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
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
    const app = await runNodeApplication(AppModule, {
      cors: false,
      host: '127.0.0.1',
      logger,
      port,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(loggerEvents).toContain(`log:KonektiFactory:Listening on http://127.0.0.1:${String(port)}`);

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
    const listenersBefore = process.listeners(signal).length;
    const port = await findAvailablePort();
    const app = await runNodeApplication(AppModule, {
      cors: false,
      logger,
      port,
      shutdownSignals: [signal],
    });

    expect(process.listeners(signal).length).toBe(listenersBefore + 1);

    await app.close();

    expect(process.listeners(signal).length).toBe(listenersBefore);
  });

  it('supports https startup and reports the https listen URL', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
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
    const app = await runNodeApplication(AppModule, {
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
    expect(loggerEvents).toContain(`log:KonektiFactory:Listening on https://127.0.0.1:${String(port)}`);

    await app.close();
  });

  it('reports both a friendly localhost URL and the bind target for wildcard hosts', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
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
    const app = await runNodeApplication(AppModule, {
      cors: false,
      host: '0.0.0.0',
      logger,
      port,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const listenEvent = loggerEvents.find((event) => event.includes(`Listening on http://localhost:${String(port)}`));
    expect(listenEvent).toBeDefined();
    expect(listenEvent).toContain('bound to');

    await app.close();
  });

  it('applies a global prefix to application routes and runtime-owned paths by default', async () => {
    const HealthModule = createHealthModule();

    @Controller('')
    class RuntimeOwnedController {
      @Get('/docs')
      getDocs() {
        return { ok: true, route: 'docs' };
      }

      @Get('/metrics')
      getMetrics() {
        return 'process_cpu_seconds_total 1';
      }

      @Get('/openapi.json')
      getOpenApi() {
        return { openapi: '3.1.0' };
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
      controllers: [AppController, RuntimeOwnedController],
      imports: [HealthModule],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      port,
    });

    await app.listen();

    const [prefixedApp, unprefixedApp, prefixedHealth, prefixedReady, prefixedDocs, prefixedMetrics, prefixedOpenapi, health, docs] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/api/app/info`),
      fetch(`http://127.0.0.1:${String(port)}/app/info`),
      fetch(`http://127.0.0.1:${String(port)}/api/health`),
      fetch(`http://127.0.0.1:${String(port)}/api/ready`),
      fetch(`http://127.0.0.1:${String(port)}/api/docs`),
      fetch(`http://127.0.0.1:${String(port)}/api/metrics`),
      fetch(`http://127.0.0.1:${String(port)}/api/openapi.json`),
      fetch(`http://127.0.0.1:${String(port)}/health`),
      fetch(`http://127.0.0.1:${String(port)}/docs`),
    ]);

    expect(prefixedApp.status).toBe(200);
    await expect(prefixedApp.json()).resolves.toEqual({ ok: true, route: 'app-info' });

    expect(unprefixedApp.status).toBe(404);
    expect(prefixedHealth.status).toBe(200);
    await expect(prefixedHealth.json()).resolves.toEqual({ status: 'ok' });
    expect(prefixedReady.status).toBe(200);
    await expect(prefixedReady.json()).resolves.toEqual({ status: 'ready' });
    expect(prefixedDocs.status).toBe(200);
    await expect(prefixedDocs.json()).resolves.toEqual({ ok: true, route: 'docs' });
    expect(prefixedMetrics.status).toBe(200);
    await expect(prefixedMetrics.text()).resolves.toBe('process_cpu_seconds_total 1');
    expect(prefixedOpenapi.status).toBe(200);
    await expect(prefixedOpenapi.json()).resolves.toEqual({ openapi: '3.1.0' });
    expect(health.status).toBe(404);
    expect(docs.status).toBe(404);

    await app.close();
  });

  it('supports explicit global prefix exclusions for runtime-owned paths', async () => {
    const HealthModule = createHealthModule();

    @Controller('')
    class RuntimeOwnedController {
      @Get('/docs')
      getDocs() {
        return { ok: true, route: 'docs' };
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
      controllers: [AppController, RuntimeOwnedController],
      imports: [HealthModule],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      globalPrefixExclude: ['/health', '/ready'],
      port,
    });

    await app.listen();

    const [health, ready, prefixedHealth, prefixedReady, prefixedDocs] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/health`),
      fetch(`http://127.0.0.1:${String(port)}/ready`),
      fetch(`http://127.0.0.1:${String(port)}/api/health`),
      fetch(`http://127.0.0.1:${String(port)}/api/ready`),
      fetch(`http://127.0.0.1:${String(port)}/api/docs`),
    ]);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ status: 'ready' });
    expect(prefixedHealth.status).toBe(404);
    expect(prefixedReady.status).toBe(404);
    expect(prefixedDocs.status).toBe(200);
    await expect(prefixedDocs.json()).resolves.toEqual({ ok: true, route: 'docs' });

    await app.close();
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
    const app = await bootstrapNodeApplication(AppModule, {
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

  it('supports additional global prefix exclusion patterns', async () => {
    @Controller('/internal')
    class InternalController {
      @Get('/ping')
      getPing() {
        return { ok: true, route: 'internal' };
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
      controllers: [AppController, InternalController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      globalPrefixExclude: ['/internal/*'],
      port,
    });

    await app.listen();

    const [internal, prefixedInternal, prefixedApp, unprefixedApp] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/internal/ping`),
      fetch(`http://127.0.0.1:${String(port)}/api/internal/ping`),
      fetch(`http://127.0.0.1:${String(port)}/api/app/info`),
      fetch(`http://127.0.0.1:${String(port)}/app/info`),
    ]);

    expect(internal.status).toBe(200);
    await expect(internal.json()).resolves.toEqual({ ok: true, route: 'internal' });
    expect(prefixedInternal.status).toBe(404);
    expect(prefixedApp.status).toBe(200);
    await expect(prefixedApp.json()).resolves.toEqual({ ok: true, route: 'app-info' });
    expect(unprefixedApp.status).toBe(404);

    await app.close();
  });

  it('normalizes global prefix and exclusion inputs before matching routes', async () => {
    @Controller('/internal')
    class InternalController {
      @Get('/ping')
      getPing() {
        return { ok: true, route: 'internal' };
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
      controllers: [AppController, InternalController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      globalPrefix: '///api//',
      globalPrefixExclude: ['//internal//*'],
      port,
    });

    await app.listen();

    const [prefixedApp, internal, prefixedInternal] = await Promise.all([
      fetch(`http://127.0.0.1:${String(port)}/api/app/info`),
      fetch(`http://127.0.0.1:${String(port)}/internal/ping`),
      fetch(`http://127.0.0.1:${String(port)}/api/internal/ping`),
    ]);

    expect(prefixedApp.status).toBe(200);
    await expect(prefixedApp.json()).resolves.toEqual({ ok: true, route: 'app-info' });
    expect(internal.status).toBe(200);
    await expect(internal.json()).resolves.toEqual({ ok: true, route: 'internal' });
    expect(prefixedInternal.status).toBe(404);

    await app.close();
  });

  it('treats a root global prefix as a no-op', async () => {
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
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      globalPrefix: '/',
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/app/info`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, route: 'app-info' });

    await app.close();
  });

  it('waits for an in-flight request to finish before closing', async () => {
    const requestStarted = createDeferred<void>();
    const allowResponse = createDeferred<void>();

    @Controller('/slow')
    class SlowController {
      @Get('/')
      async getSlowResponse() {
        requestStarted.resolve();
        await allowResponse.promise;
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [SlowController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      shutdownTimeoutMs: 1_000,
    });

    await app.listen();

    const responsePromise = fetch(`http://127.0.0.1:${String(port)}/slow`);
    await requestStarted.promise;

    let closeResolved = false;
    const closePromise = app.close().then(() => {
      closeResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closeResolved).toBe(false);

    allowResponse.resolve();

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    await closePromise;
    expect(closeResolved).toBe(true);
  });

  it('forces shutdown when the drain timeout expires', async () => {
    const requestStarted = createDeferred<void>();

    @Controller('/hang')
    class HangingController {
      @Get('/')
      async getHangingResponse() {
        requestStarted.resolve();
        await new Promise(() => {});
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HangingController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
      shutdownTimeoutMs: 50,
    });

    await app.listen();

    const responsePromise = fetch(`http://127.0.0.1:${String(port)}/hang`);
    await requestStarted.promise;

    await expect(app.close()).resolves.toBeUndefined();
    await expect(responsePromise).rejects.toThrow();
  });

  it('fails during bootstrap when a provider omits required injection metadata', async () => {
    class Logger {}

    class AppService {
      constructor(readonly logger: Logger) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [Logger, AppService],
    });

    await expect(
      bootstrapApplication({
        rootModule: AppModule,
      }),
    ).rejects.toThrow(ModuleInjectionMetadataError);
  });

  it('exposes the dispatcher through the application shell', async () => {
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

    const adapterEvents: string[] = [];
    const adapter: HttpApplicationAdapter = {
      async close() {},
      async listen(dispatcher) {
        adapterEvents.push(typeof dispatcher.dispatch);
      },
    };

    const app = await bootstrapApplication({
      adapter,
      rootModule: AppModule,
    });
    const request: FrameworkRequest = {
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/health',
      query: {},
      raw: {},
      url: '/health',
    };
    const response: FrameworkResponse & { body?: unknown } = {
      committed: false,
      headers: {},
      redirect(status, location) {
        this.setStatus(status);
        this.setHeader('Location', location);
        this.committed = true;
      },
      send(body) {
        this.body = body;
        this.committed = true;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      setStatus(code) {
        this.statusCode = code;
      },
      statusCode: 200,
    };

    await app.dispatch(request, response);
    await app.listen();

    expect(response.body).toEqual({ ok: true });
    expect(adapterEvents).toEqual(['function']);
  });

  it('applies a global serializer interceptor to all handler responses', async () => {
    @Expose({ excludeExtraneous: true })
    class UserView {
      @Expose()
      id: string;

      @Exclude()
      password: string;

      constructor(id: string, password: string) {
        this.id = id;
        this.password = password;
      }
    }

    @Controller('/users')
    class UsersController {
      @Get('/one')
      getOne() {
        return new UserView('u-1', 'secret-1');
      }

      @Get('/two')
      getTwo() {
        return [new UserView('u-2', 'secret-2')];
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UsersController],
      providers: [SerializerInterceptor],
    });

    const app = await bootstrapApplication({
      interceptors: [SerializerInterceptor],
      rootModule: AppModule,
    });

    const requestOne: FrameworkRequest = {
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/one',
      query: {},
      raw: {},
      url: '/users/one',
    };
    const requestTwo: FrameworkRequest = {
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/two',
      query: {},
      raw: {},
      url: '/users/two',
    };

    const responseOne: FrameworkResponse & { body?: unknown } = {
      committed: false,
      headers: {},
      redirect(status, location) {
        this.setStatus(status);
        this.setHeader('Location', location);
        this.committed = true;
      },
      send(body) {
        this.body = body;
        this.committed = true;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      setStatus(code) {
        this.statusCode = code;
      },
      statusCode: 200,
    };
    const responseTwo: FrameworkResponse & { body?: unknown } = {
      committed: false,
      headers: {},
      redirect(status, location) {
        this.setStatus(status);
        this.setHeader('Location', location);
        this.committed = true;
      },
      send(body) {
        this.body = body;
        this.committed = true;
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      setStatus(code) {
        this.statusCode = code;
      },
      statusCode: 200,
    };

    await app.dispatch(requestOne, responseOne);
    await app.dispatch(requestTwo, responseTwo);

    expect(responseOne.body).toEqual({ id: 'u-1' });
    expect(responseTwo.body).toEqual([{ id: 'u-2' }]);
  });

  it('unwinds initialized providers when bootstrap hooks fail', async () => {
    const events: string[] = [];
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };

    class AppService {
      onApplicationBootstrap() {
        events.push('app:bootstrap');
        throw new Error('boom');
      }

      onApplicationShutdown(signal?: string) {
        events.push(`app:shutdown:${signal ?? 'none'}`);
      }

      onModuleDestroy() {
        events.push('module:destroy');
      }

      onModuleInit() {
        events.push('module:init');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [AppService],
    });

    await expect(
      bootstrapApplication({
        logger,
        rootModule: AppModule,
      }),
    ).rejects.toThrow('boom');

    expect(events).toEqual([
      'module:init',
      'app:bootstrap',
      'module:destroy',
      'app:shutdown:bootstrap-failed',
    ]);
    expect(loggerEvents).toContain(
      'error:KonektiFactory:Failed to bootstrap application. Check the error below for what failed and how to fix it.:boom',
    );
  });

  it('logs startup milestones, route mappings, and adapter start failures', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
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

    const adapter: HttpApplicationAdapter = {
      async close() {},
      async listen() {
        throw new Error('port already in use');
      },
    };

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const app = await bootstrapApplication({
      adapter,
      logger,
      rootModule: AppModule,
    });

    expect(loggerEvents).toEqual([
      'log:KonektiFactory:Starting Konekti application...',
      'log:InstanceLoader:AppModule dependencies initialized',
      'log:RoutesResolver:HealthController {/health}',
      'log:RouterExplorer:Mapped {/health, GET} route',
    ]);

    await expect(app.listen()).rejects.toThrow('port already in use');
    expect(loggerEvents).toContain('error:KonektiApplication:Failed to start the HTTP adapter.:port already in use');
  });

  it('parses Cookie header and exposes individual cookies via FromCookie', async () => {
    class TokenInput {
      @FromCookie()
      session!: string;
    }

    @Controller('/cookie-test')
    class CookieController {
      @RequestDto(TokenInput)
      @Get('/')
      readCookie(input: TokenInput) {
        return { session: input.session };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CookieController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/cookie-test`, {
      headers: { cookie: 'session=abc123; other=value' },
    });

    await expect(response.json()).resolves.toEqual({ session: 'abc123' });

    await app.close();
  });

  it('accepts a cors string and merges with framework defaults', async () => {
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
    const app = await bootstrapNodeApplication(AppModule, {
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

  it('accepts a cors string array and merges with framework defaults', async () => {
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
    const app = await bootstrapNodeApplication(AppModule, {
      cors: ['https://a.com', 'https://b.com'],
      port,
    });

    await app.listen();

    const responseA = await fetch(`http://127.0.0.1:${String(port)}/ping`, {
      headers: { origin: 'https://a.com' },
    });
    const responseB = await fetch(`http://127.0.0.1:${String(port)}/ping`, {
      headers: { origin: 'https://c.com' },
    });

    expect(responseA.headers.get('access-control-allow-origin')).toBe('https://a.com');
    expect(responseB.headers.get('access-control-allow-origin')).toBeNull();
    expect(responseA.headers.get('access-control-allow-headers')).toContain('Authorization');

    await app.close();
  });

  it('accepts a partial CorsOptions object and merges with framework defaults', async () => {
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
    const app = await bootstrapNodeApplication(AppModule, {
      cors: { allowOrigin: 'https://my-frontend.com', maxAge: 600 },
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/ping`, {
      headers: { origin: 'https://my-frontend.com' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('https://my-frontend.com');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-max-age')).toBe('600');

    await app.close();
  });

  it('aborts the request signal when the response is closed before the handler commits', async () => {
    const handlerReached = createDeferred();
    const signalCapture = createDeferred<AbortSignal>();

    @Controller('/slow')
    class SlowController {
      @Get('/')
      async get(_input: unknown, ctx: RequestContext) {
        signalCapture.resolve(ctx.request.signal!);
        handlerReached.resolve();
        await new Promise<void>(() => {});
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [SlowController] });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const net = await import('node:net');
    const socket = net.createConnection(port, '127.0.0.1');

    await new Promise<void>((resolve) => socket.once('connect', resolve));

    socket.write('GET /slow HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');

    await handlerReached.promise;
    socket.destroy();

    const signal = await signalCapture.promise;

    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      signal.addEventListener('abort', () => resolve(), { once: true });
    });

    expect(signal.aborted).toBe(true);

    await app.close();
  });

  it('streams SSE frames over the Node adapter and closes on client disconnect', async () => {
    const streamStarted = createDeferred<void>();
    const streamClosed = createDeferred<void>();

    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, context: RequestContext) {
        const sse = new SseResponse(context);
        sse.comment('ready');
        streamStarted.resolve();

        const interval = setInterval(() => {
          sse.send({ ok: true }, { event: 'tick' });
        }, 10);

        const closeStream = () => {
          clearInterval(interval);
          sse.close();
          streamClosed.resolve();
        };

        if (context.request.signal?.aborted) {
          closeStream();
        } else {
          context.request.signal?.addEventListener('abort', closeStream, { once: true });
        }

        return sse;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      port,
    });

    await app.listen();

    const http = await import('node:http');
    const clientRequest = http.request({
      headers: { accept: 'text/event-stream' },
      host: '127.0.0.1',
      method: 'GET',
      path: '/events',
      port,
    });

    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      clientRequest.once('error', reject);
      clientRequest.once('response', resolve);
      clientRequest.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');

    const firstChunk = await new Promise<string>((resolve, reject) => {
      response.once('error', reject);
      response.once('data', (chunk: Buffer | string) => {
        resolve(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
      });
    });

    expect(firstChunk).toContain(': ready\n\n');
    await streamStarted.promise;

    response.destroy();
    await streamClosed.promise;

    await app.close();
  });
});

describe('KonektiFactory facade', () => {
  it('creates an application shell without requiring options', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const app = await KonektiFactory.create(AppModule);

    expect(app.rootModule).toBe(AppModule);
    await expect(app.get(RUNTIME_CONTAINER)).resolves.toBeDefined();

    await app.close();
  });
});

describe('exception filter pipeline', () => {
  it('calls the filter and stops the chain when the filter returns true', async () => {
    const caughtErrors: unknown[] = [];

    class ThrowingController {
      @Get('/boom')
      boom() {
        throw new Error('test error');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ThrowingController],
    });

    const filter: ExceptionFilterHandler = {
      catch(error: unknown, context: ExceptionFilterContext): boolean {
        caughtErrors.push(error);
        context.response.setStatus(418);
        void context.response.send({ handled: true });

        return true;
      },
    };

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      filters: [filter],
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/boom`);

    expect(response.status).toBe(418);
    await expect(response.json()).resolves.toEqual({ handled: true });
    expect(caughtErrors).toHaveLength(1);
    expect(caughtErrors[0]).toBeInstanceOf(Error);

    await app.close();
  });

  it('falls through to the default 500 handler when the filter returns undefined', async () => {
    class ThrowingController {
      @Get('/boom')
      boom() {
        throw new Error('unhandled error');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ThrowingController],
    });

    const filter: ExceptionFilterHandler = {
      catch(): undefined {
        return undefined;
      },
    };

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      filters: [filter],
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/boom`);

    expect(response.status).toBe(500);

    await app.close();
  });

  it('stops the chain at the first filter that returns true and skips subsequent filters', async () => {
    const callOrder: string[] = [];

    class ThrowingController {
      @Get('/boom')
      boom() {
        throw new Error('test error');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ThrowingController],
    });

    const firstFilter: ExceptionFilterHandler = {
      catch(_error: unknown, context: ExceptionFilterContext): boolean {
        callOrder.push('first');
        context.response.setStatus(400);
        void context.response.send({ filter: 'first' });

        return true;
      },
    };

    const secondFilter: ExceptionFilterHandler = {
      catch(): undefined {
        callOrder.push('second');

        return undefined;
      },
    };

    const port = await findAvailablePort();
    const app = await bootstrapNodeApplication(AppModule, {
      cors: false,
      filters: [firstFilter, secondFilter],
      port,
    });

    await app.listen();

    const response = await fetch(`http://127.0.0.1:${String(port)}/boom`);

    expect(response.status).toBe(400);
    expect(callOrder).toEqual(['first']);

    await app.close();
  });
});
