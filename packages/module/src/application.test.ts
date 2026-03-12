import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { ConfigService } from '@konekti/config';
import { Controller, Get, type FrameworkRequest, type FrameworkResponse, type HttpApplicationAdapter } from '@konekti/http';

import { bootstrapApplication, defineModule } from './bootstrap';

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
  });
});
