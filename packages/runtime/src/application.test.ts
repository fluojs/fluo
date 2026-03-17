import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { ConfigService } from '@konekti/config';
import {
  Controller,
  FromBody,
  FromCookie,
  Get,
  Post,
  createSecurityHeadersMiddleware,
  type RequestContext,
  RequestDto,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
} from '@konekti/http';
import { bootstrapApplication, defineModule, KonektiFactory } from './bootstrap.js';
import { ModuleInjectionMetadataError } from './errors.js';
import { bootstrapNodeApplication, runNodeApplication } from './node.js';
import type { ApplicationLogger } from './types.js';

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

describe('bootstrapApplication', () => {
  it('registers ConfigService as a bootstrap-level provider', async () => {
    @Inject([ConfigService])
    class AppService {
      constructor(readonly config: ConfigService) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      providers: [AppService],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
      runtimeOverrides: { PORT: '3000' },
    });

    const service = await app.container.resolve(AppService);

    expect(service.config.get<string>('PORT')).toBe('3000');
    expect(app.mode).toBe('test');
    expect(app.envFile.endsWith('.env.test')).toBe(true);

    await expect(app.ready()).resolves.toBeUndefined();
  });

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
      mode: 'test',
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
      'adapter:close:SIGTERM',
      'module:destroy',
      'app:shutdown:SIGTERM',
    ]);
    expect(app.state).toBe('closed');
  });

  it('creates applications through KonektiFactory', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    const app = await KonektiFactory.create(AppModule, {
      mode: 'test',
    });

    expect(app.rootModule).toBe(AppModule);
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
      port,
    });

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
    const corsPreflight = await fetch(`http://127.0.0.1:${String(port)}/health`, {
      headers: { origin: 'https://example.com' },
      method: 'OPTIONS',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(corsPreflight.status).toBe(204);
    expect(corsPreflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(loggerEvents).toContain(`log:KonektiFactory:Listening on http://localhost:${String(port)}`);

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
      mode: 'test',
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
      mode: 'test',
      port,
      shutdownTimeoutMs: 50,
    });

    await app.listen();

    const responsePromise = fetch(`http://127.0.0.1:${String(port)}/hang`);
    await requestStarted.promise;

    await expect(app.close()).resolves.toBeUndefined();
    await expect(responsePromise).rejects.toThrow();
  });

  it('fails before listen when config validation rejects bootstrap config', async () => {
    class AppModule {}
    defineModule(AppModule, {});

    await expect(
      bootstrapApplication({
        mode: 'test',
        rootModule: AppModule,
        validate: () => {
          throw new Error('PORT is required');
        },
      }),
    ).rejects.toThrow('Invalid configuration.');
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
        mode: 'test',
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
      mode: 'test',
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
        mode: 'test',
        rootModule: AppModule,
      }),
    ).rejects.toThrow('boom');

    expect(events).toEqual([
      'module:init',
      'app:bootstrap',
      'module:destroy',
      'app:shutdown:bootstrap-failed',
    ]);
    expect(loggerEvents).toContain('error:KonektiFactory:Failed to bootstrap application.:boom');
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
});
