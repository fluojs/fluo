import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';

import { bootstrapApplication, defineModule } from './bootstrap.js';
import { createHealthModule } from './health.js';

type TestResponse = FrameworkResponse & { body?: unknown };
type ReadinessManagedModule = ReturnType<typeof createHealthModule> & {
  addReadinessCheck(fn: () => boolean | Promise<boolean>): void;
  markReady(): void;
  markStarting(): void;
};

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
  it('returns a starting readiness status until the runtime marks the module ready', async () => {
    const healthModule = createHealthModule() as ReadinessManagedModule;

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
    const healthModule = createHealthModule() as ReadinessManagedModule;
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

  it('supports custom health responses while preserving readiness behavior', async () => {
    const healthModule = createHealthModule({
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
});
