import { publicToken } from '@fluojs/core';
import { Controller, Get, type HttpApplicationAdapter } from '@fluojs/http';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { APPLICATION_LOGGER, defineModule, FluoFactory, type ApplicationLogger } from './index.js';

function logger(): ApplicationLogger {
  return { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('canonical HTTP factory lifecycle', () => {
  it('owns logger injection and ordered middleware at the public HTTP boundary', async () => {
    // Given
    const events: string[] = [];
    @Controller('/hello')
    class HelloController {
      @Get()
      hello() {
        events.push('handler');
        return { hello: 'world' };
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      controllers: [HelloController],
      middleware: [{
        async handle(_context, next) {
          events.push('module');
          await next();
        },
      }],
    });
    const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const applicationLogger = logger();
    const app = await FluoFactory.create(AppModule, {
      adapter,
      cors: ['https://client.test'],
      globalPrefix: '/api',
      logger: applicationLogger,
      middleware: [{
        async handle(context, next) {
          events.push(`app:${context.request.path}`);
          await next();
        },
      }],
    });

    try {
      // When
      await app.listen();
      const response = await fetch(`${adapter.getListenTarget().url}/api/hello`, {
        headers: { origin: 'https://client.test' },
      });
      // Then
      expect(await app.get(APPLICATION_LOGGER)).toBe(applicationLogger);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ hello: 'world' });
      expect(response.headers.get('access-control-allow-origin')).toBe('https://client.test');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(events).toEqual(['app:/hello', 'module', 'handler']);
    } finally {
      await app.close();
    }
  });

  it('preserves the listen failure after closing acquired resources even if cleanup logging fails', async () => {
    // Given
    const failure = new Error('listen failed');
    const cleanupFailure = new Error('close failed');
    class AppModule {}
    const dispose = vi.fn();
    defineModule(AppModule, { providers: [{ provide: 'resource', useValue: { onDestroy: dispose } }] });
    const adapter: HttpApplicationAdapter = {
      close: vi.fn(() => { throw cleanupFailure; }),
      listen: vi.fn(() => { throw failure; }),
    };
    const app = await FluoFactory.create(AppModule, {
      adapter,
      logger: { ...logger(), error() { throw new Error('logger failed'); } },
    });
    await app.get('resource');
    // When / Then
    await expect(app.listen()).rejects.toBe(failure);
    expect(adapter.close).toHaveBeenCalledWith('bootstrap-failed');
    expect(dispose).toHaveBeenCalledOnce();
    await expect(app.get('resource')).rejects.toThrow();
    await expect(app.listen()).rejects.toThrow();
  });

  it('closes an acquired adapter when creation fails without replacing the original error', async () => {
    // Given
    const failure = new Error('binder failed');
    const adapter: HttpApplicationAdapter = { close: vi.fn(), listen: vi.fn() };
    class AppModule {}
    defineModule(AppModule, {});
    // When / Then
    await expect(FluoFactory.create(AppModule, {
      adapter,
      binder() { throw failure; },
      logger: logger(),
    })).rejects.toBe(failure);
    expect(adapter.close).toHaveBeenCalledExactlyOnceWith('bootstrap-failed');
    expect(adapter.listen).not.toHaveBeenCalled();
  });

  it('closes after successful listen when startup logging throws', async () => {
    // Given
    const failure = new Error('startup log failed');
    let listening = false;
    const adapter: HttpApplicationAdapter = {
      close: vi.fn(),
      listen() { listening = true; },
    };
    const registration = vi.fn();
    class AppModule {}
    defineModule(AppModule, {});
    const app = await FluoFactory.create(AppModule, {
      adapter,
      logger: {
        ...logger(),
        log() { if (listening) throw failure; },
      },
      shutdownRegistration: registration,
    });
    // When / Then
    await expect(app.listen()).rejects.toBe(failure);
    expect(adapter.close).toHaveBeenCalledExactlyOnceWith('bootstrap-failed');
    expect(registration).not.toHaveBeenCalled();
    expect(app.state).toBe('closed');
  });

  it('honors security-header opt-out without mutating caller middleware', async () => {
    // Given
    class AppModule {}
    defineModule(AppModule, {});
    const middleware = [{
      async handle({ response }: { response: { send(body: unknown): unknown } }) {
        await response.send({ ok: true });
      },
    }];
    const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(AppModule, {
      adapter, logger: logger(), middleware, securityHeaders: false,
    });
    try {
      // When
      await app.listen();
      const response = await fetch(adapter.getListenTarget().url);
      // Then
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('x-content-type-options')).toBeNull();
      expect(middleware).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('closes after post-listen registration failure and preserves its error', async () => {
    // Given
    const failure = new Error('registration failed');
    const adapter: HttpApplicationAdapter = { close: vi.fn(), listen: vi.fn() };
    class AppModule {}
    defineModule(AppModule, {});
    const app = await FluoFactory.create(AppModule, {
      adapter,
      logger: logger(),
      shutdownRegistration() { throw failure; },
    });
    // When / Then
    await expect(app.listen()).rejects.toBe(failure);
    expect(adapter.close).toHaveBeenCalledExactlyOnceWith('bootstrap-failed');
    expect(app.state).toBe('closed');
  });

  it('shares unregister failures across concurrent closes while completing resource cleanup', async () => {
    // Given
    const failure = new Error('unregister failed');
    const entered = deferred();
    const release = deferred();
    const unregister = vi.fn(() => { throw failure; });
    const adapter: HttpApplicationAdapter = {
      async close() { entered.resolve(); await release.promise; },
      listen() {},
    };
    class AppModule {}
    defineModule(AppModule, {});
    const app = await FluoFactory.create(AppModule, {
      adapter, logger: logger(), shutdownRegistration: () => unregister,
    });
    await app.listen();
    // When
    const first = app.close('SIGTERM');
    const second = app.close('SIGINT');
    const results = Promise.allSettled([first, second]);
    await entered.promise;
    release.resolve();
    // Then
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(unregister).toHaveBeenCalledOnce();
    expect(app.state).toBe('closed');
    await expect(app.close()).rejects.toBe(failure);
  });

  it('settles a racing failed listen and close without registering late signals', async () => {
    // Given
    const entered = deferred();
    const release = deferred();
    const failure = new Error('listen failed');
    const unregister = vi.fn();
    const registration = vi.fn(() => unregister);
    const adapter: HttpApplicationAdapter = {
      close: vi.fn(),
      async listen() { entered.resolve(); await release.promise; throw failure; },
    };
    class AppModule {}
    defineModule(AppModule, {});
    const app = await FluoFactory.create(AppModule, {
      adapter, logger: logger(), shutdownRegistration: registration,
    });
    // When
    const listening = app.listen();
    await entered.promise;
    const closing = app.close('manual');
    const results = Promise.allSettled([listening, closing]);
    release.resolve();
    // Then
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: undefined },
    ]);
    expect(adapter.close).toHaveBeenCalledExactlyOnceWith('manual');
    expect(registration).not.toHaveBeenCalled();
  });

  it('infers PublicToken values and preserves class identity before closing an unstarted host-owned app', async () => {
    // Given
    const token = publicToken<{ value: number }>('factory.test.value');
    class Service { readonly value = 17; }
    class AppModule {}
    const service = new Service();
    defineModule(AppModule, { providers: [Service, { provide: token, useValue: service }] });
    const registration = vi.fn();
    const adapter: HttpApplicationAdapter = { close: vi.fn(), listen: vi.fn() };
    const app = await FluoFactory.create(AppModule, {
      adapter, logger: logger(), shutdownRegistration: registration,
    });
    const value = await app.get(token);
    expectTypeOf(value).toEqualTypeOf<{ value: number }>();
    expect(value).toBe(service);
    expect(await app.get(Service)).toBeInstanceOf(Service);
    expect(await app.get(Service)).toBe(await app.container.resolve(Service));
    // When
    await app.close();
    // Then
    expect(adapter.listen).not.toHaveBeenCalled();
    expect(registration).not.toHaveBeenCalled();
    expect(adapter.close).toHaveBeenCalledOnce();
    await expect(app.get(token)).rejects.toThrow();
  });
});
