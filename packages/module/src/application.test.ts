import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { ConfigService } from '@konekti/config';
import {
  Controller,
  FromBody,
  Get,
  Post,
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ name: 'Ada' });

    await app.close();
  });

  it('runs node applications with runtime-owned defaults', async () => {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
        loggerEvents.push(`log:${context}:${message}`);
      },
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
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
        loggerEvents.push(`log:${context}:${message}`);
      },
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
      error(message, error, context) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message, context) {
        loggerEvents.push(`log:${context}:${message}`);
      },
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
});
