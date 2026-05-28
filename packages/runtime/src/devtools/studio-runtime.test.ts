import type { RequestContext } from '@fluojs/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapApplication, bootstrapModule } from '../bootstrap.js';
import { defineRuntimeClassDiMetadata, defineRuntimeModuleMetadata } from '../internal/core-metadata.js';
import type { ApplicationLogger } from '../types.js';
import type { StudioLiveEvent } from './contracts.js';
import { createStudioLiveSnapshot } from './snapshot.js';
import { StudioDevtoolsRuntime, createStudioDevtoolsRuntimeFromEnv } from './studio-runtime.js';

const logger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

const studioEnvKeys = [
  'FLUO_STUDIO',
  'FLUO_STUDIO_APP_ID',
  'FLUO_STUDIO_ENDPOINT',
  'FLUO_STUDIO_EPOCH',
  'FLUO_STUDIO_RUNTIME',
  'FLUO_STUDIO_TOKEN',
  'FLUO_STUDIO_URL',
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of studioEnvKeys) {
  originalEnv.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of studioEnvKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }

  vi.restoreAllMocks();
});

describe('Studio devtools runtime bridge', () => {
  it('stays disabled unless Studio env injection includes a token-protected endpoint', () => {
    expect(createStudioDevtoolsRuntimeFromEnv({})).toBeUndefined();
    expect(createStudioDevtoolsRuntimeFromEnv({ FLUO_STUDIO: '1', FLUO_STUDIO_URL: 'http://127.0.0.1:49152' })).toBeUndefined();
    expect(createStudioDevtoolsRuntimeFromEnv({ FLUO_STUDIO: '1', FLUO_STUDIO_TOKEN: 'secret' })).toBeUndefined();
  });

  it('builds module, provider, controller, export, and dependency graph snapshots', () => {
    class Repository {}
    class Service {
      constructor(readonly repository: Repository) {}
    }
    class HealthController {
      constructor(readonly service: Service) {}
    }
    class AppModule {}

    defineRuntimeClassDiMetadata(Service, { inject: [Repository] });
    defineRuntimeClassDiMetadata(HealthController, { inject: [Service] });
    defineRuntimeModuleMetadata(AppModule, {
      controllers: [HealthController],
      exports: [Service],
      providers: [Repository, Service],
    });

    const bootstrapped = bootstrapModule(AppModule, { logger });
    const snapshot = createStudioLiveSnapshot({
      appId: 'app-test',
      modules: bootstrapped.modules,
      rootModule: AppModule,
    });

    expect(snapshot.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'module:AppModule', kind: 'module', label: 'AppModule' }),
        expect.objectContaining({ id: 'provider:AppModule:Repository', kind: 'provider', label: 'Repository' }),
        expect.objectContaining({ id: 'provider:AppModule:Service', kind: 'provider', label: 'Service' }),
        expect.objectContaining({ id: 'controller:AppModule:HealthController', kind: 'controller', label: 'HealthController' }),
      ]),
    );
    expect(snapshot.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'module:AppModule', kind: 'owns_provider', to: 'provider:AppModule:Repository' }),
        expect.objectContaining({ from: 'module:AppModule', kind: 'owns_controller', to: 'controller:AppModule:HealthController' }),
        expect.objectContaining({ from: 'provider:AppModule:Service', kind: 'depends_on', to: 'provider:AppModule:Repository' }),
        expect.objectContaining({ from: 'controller:AppModule:HealthController', kind: 'depends_on', to: 'provider:AppModule:Service' }),
        expect.objectContaining({ from: 'module:AppModule', kind: 'exports', to: 'provider:AppModule:Service' }),
      ]),
    );
  });

  it('emits request lifecycle traces without leaking request bodies', () => {
    const events: StudioLiveEvent[] = [];
    const runtime = new StudioDevtoolsRuntime({
      appId: 'app-test',
      epoch: 'epoch-test',
      transport: {
        publish(event) {
          events.push(event);
        },
      },
    });
    const requestContext = {
      container: {},
      metadata: {},
      request: {
        body: { password: 'do-not-send' },
        cookies: {},
        headers: { 'x-request-id': 'req-1' },
        method: 'POST',
        params: {},
        path: '/login',
        query: {},
        raw: {},
        requestId: 'req-1',
        url: '/login',
      },
      response: {
        committed: false,
        headers: {},
        setHeader() {},
        setStatus() {},
        async send() {},
        redirect() {},
        statusCode: 201,
      },
    } as unknown as RequestContext;

    runtime.requestObserver.onRequestStart?.({ requestContext });
    runtime.requestObserver.onRequestSuccess?.({ requestContext }, { ok: true });
    runtime.requestObserver.onRequestFinish?.({ requestContext });

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[0]).toMatchObject({ type: 'request', payload: { requestId: 'req-1', status: 'started' } });
    expect(events[1]).toMatchObject({ type: 'request', payload: { requestId: 'req-1', status: 'succeeded', statusCode: 201 } });
    expect(JSON.stringify(events)).not.toContain('do-not-send');
  });

  it('auto-instruments bootstrap when fluo dev --studio injects Studio env', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    process.env.FLUO_STUDIO = '1';
    process.env.FLUO_STUDIO_URL = 'http://127.0.0.1:49152';
    process.env.FLUO_STUDIO_TOKEN = 'studio-token';
    process.env.FLUO_STUDIO_APP_ID = 'app-env-test';
    process.env.FLUO_STUDIO_EPOCH = 'epoch-env-test';

    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});

    const app = await bootstrapApplication({ logger, rootModule: AppModule });

    expect(app.bootstrapTiming).toBeDefined();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:49152/api/runtime/events',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(requestInit.headers).toMatchObject({
      authorization: 'Bearer studio-token',
      'content-type': 'application/json',
    });
    const event = JSON.parse(String(requestInit.body)) as StudioLiveEvent;
    expect(event).toMatchObject({
      epoch: 'epoch-env-test',
      payload: {
        appId: 'app-env-test',
        graph: {
          nodes: [expect.objectContaining({ id: 'module:AppModule', kind: 'module' })],
        },
      },
      sequence: 2,
      source: { appId: 'app-env-test', runtime: 'node' },
      type: 'snapshot',
      version: 1,
    });

    await app.close();
  });
});
