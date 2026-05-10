import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, RequestContext } from '@fluojs/http';

import { bootstrapApplication, defineModule } from '../bootstrap.js';
import type { ModuleType } from '../types.js';
import { HealthModule } from './health.js';
import * as healthModuleExports from './health.js';

type TestResponse = FrameworkResponse & { body?: unknown };
type ReadinessManagedModule = ModuleType & {
  addReadinessCheck(fn: (ctx: RequestContext) => boolean | Promise<boolean>): void;
  markReady(): void;
  markStarting(): void;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('location', location);
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
  };
}

describe('createHealthModule', () => {
  it('preserves the compatibility helper module class name', () => {
    const compatibilityHelperName = 'createHealthModule' as const;
    const compatibilityHelper = (healthModuleExports as Record<typeof compatibilityHelperName, () => ModuleType>)[
      compatibilityHelperName
    ];

    expect(compatibilityHelper().name).toBe('HealthModule');
    expect(HealthModule.forRoot().name).toBe('HealthModule');
  });

  it('exposes the application-facing HealthModule.forRoot facade', async () => {
    const healthModule = HealthModule.forRoot() as ReadinessManagedModule;

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('returns a starting readiness status until the runtime marks the module ready', async () => {
    const healthModule = HealthModule.forRoot() as ReadinessManagedModule;

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    healthModule.markStarting();

    const startingResponse = createResponse();
    await app.dispatch(createRequest('/ready'), startingResponse);
    expect(startingResponse.statusCode).toBe(503);
    expect(startingResponse.body).toEqual({ status: 'starting' });

    healthModule.markReady();

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('keeps liveness unchanged and respects failing readiness checks after bootstrap', async () => {
    const healthModule = HealthModule.forRoot() as ReadinessManagedModule;
    healthModule.addReadinessCheck(() => false);

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.body).toEqual({ status: 'ok' });

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(503);
    expect(readyResponse.body).toEqual({ status: 'unavailable' });

    await app.close();
  });

  it('passes the request context into readiness checks', async () => {
    const healthModule = HealthModule.forRoot() as ReadinessManagedModule;
    healthModule.addReadinessCheck((ctx) => ctx.request.path === '/ready');

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('supports custom health responses while preserving readiness behavior', async () => {
    const healthModule = HealthModule.forRoot({
      healthCheck: async () => ({
        body: { status: 'unavailable', subsystem: 'cache' },
        statusCode: 503,
      }),
    }) as ReadinessManagedModule;

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const healthResponse = createResponse();
    await app.dispatch(createRequest('/health'), healthResponse);
    expect(healthResponse.statusCode).toBe(503);
    expect(healthResponse.body).toEqual({ status: 'unavailable', subsystem: 'cache' });

    const readyResponse = createResponse();
    await app.dispatch(createRequest('/ready'), readyResponse);
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('marks readiness as starting as soon as application close begins', async () => {
    const healthModule = HealthModule.forRoot() as ReadinessManagedModule;
    const shutdownBlocker = createDeferred<void>();
    const shutdownStarted = createDeferred<void>();

    class BlockingShutdownService {
      onApplicationShutdown() {
        shutdownStarted.resolve();
        return shutdownBlocker.promise;
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
      providers: [BlockingShutdownService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const readyBeforeClose = createResponse();
    await app.dispatch(createRequest('/ready'), readyBeforeClose);
    expect(readyBeforeClose.statusCode).toBe(200);
    expect(readyBeforeClose.body).toEqual({ status: 'ready' });

    const closePromise = app.close('SIGTERM');
    await shutdownStarted.promise;

    const readyDuringClose = createResponse();
    await app.dispatch(createRequest('/ready'), readyDuringClose);
    expect(readyDuringClose.statusCode).toBe(503);
    expect(readyDuringClose.body).toEqual({ status: 'starting' });

    shutdownBlocker.resolve();
    await closePromise;
  });

  it('keeps readiness out of rotation when shutdown hooks fail', async () => {
    const healthModule = HealthModule.forRoot() as ReadinessManagedModule;
    const shutdownBlocker = createDeferred<void>();
    const shutdownStarted = createDeferred<void>();

    class FailingShutdownService {
      async onApplicationShutdown() {
        shutdownStarted.resolve();
        await shutdownBlocker.promise;
        throw new Error('shutdown failed');
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [healthModule],
      providers: [FailingShutdownService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const closePromise = app.close('SIGTERM');
    await shutdownStarted.promise;

    const readyDuringFailedClose = createResponse();
    await app.dispatch(createRequest('/ready'), readyDuringFailedClose);
    expect(readyDuringFailedClose.statusCode).toBe(503);
    expect(readyDuringFailedClose.body).toEqual({ status: 'starting' });

    shutdownBlocker.resolve();
    await expect(closePromise).rejects.toThrow('shutdown failed');
  });
});
