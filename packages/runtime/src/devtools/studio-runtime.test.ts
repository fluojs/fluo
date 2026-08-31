import { Container } from '@fluojs/di';
import type { RequestContext } from '@fluojs/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapApplication, bootstrapModule, FluoFactory } from '../bootstrap.js';
import { defineRuntimeClassDiMetadata, defineRuntimeModuleMetadata } from '../internal/core-metadata.js';
import type { ApplicationLogger } from '../types.js';
import type { StudioLiveEvent } from './contracts.js';
import { createStudioLiveSnapshot } from './snapshot.js';
import { createStudioDevtoolsRuntimeFromConfig, createStudioDevtoolsRuntimeFromEnv, StudioDevtoolsRuntime } from './studio-runtime.js';

const logger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

const studioGlobalConfigKey = '__FLUO_STUDIO_DEVTOOLS_CONFIG__';
const originalStudioGlobalConfig = (globalThis as Record<string, unknown>)[studioGlobalConfigKey];

afterEach(() => {
  if (originalStudioGlobalConfig === undefined) {
    delete (globalThis as Record<string, unknown>)[studioGlobalConfigKey];
  } else {
    (globalThis as Record<string, unknown>)[studioGlobalConfigKey] = originalStudioGlobalConfig;
  }

  vi.restoreAllMocks();
});

describe('Studio devtools runtime bridge', () => {
  it('stays disabled unless Studio env injection includes a token-protected endpoint', () => {
    expect(createStudioDevtoolsRuntimeFromConfig()).toBeUndefined();
    expect(createStudioDevtoolsRuntimeFromEnv({})).toBeUndefined();
    expect(createStudioDevtoolsRuntimeFromEnv({ FLUO_STUDIO: '1', FLUO_STUDIO_URL: 'http://127.0.0.1:49152' })).toBeUndefined();
    expect(createStudioDevtoolsRuntimeFromEnv({ FLUO_STUDIO: '1', FLUO_STUDIO_TOKEN: 'secret' })).toBeUndefined();
  });

  it('captures each CLI-injected Studio config field once when creating the runtime bridge', async () => {
    // Given
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    let token = 'studio-token-at-bootstrap';
    (globalThis as Record<string, unknown>)[studioGlobalConfigKey] = {
      FLUO_STUDIO: '1',
      FLUO_STUDIO_ENDPOINT: 'http://127.0.0.1:49152/api/runtime/events',
      get FLUO_STUDIO_TOKEN() {
        const capturedToken = token;
        token = 'studio-token-after-bootstrap';
        return capturedToken;
      },
    };

    // When
    const runtime = createStudioDevtoolsRuntimeFromConfig();
    runtime?.publish('heartbeat', { uptimeMs: 0 });

    // Then
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:49152/api/runtime/events',
        expect.objectContaining({
          headers: {
            authorization: 'Bearer studio-token-at-bootstrap',
            'content-type': 'application/json',
          },
        }),
      );
    });
  });

  it('stays disabled when the captured Studio endpoint is malformed', () => {
    // Given
    (globalThis as Record<string, unknown>)[studioGlobalConfigKey] = {
      FLUO_STUDIO: '1',
      FLUO_STUDIO_ENDPOINT: 'not-an-absolute-url',
      FLUO_STUDIO_TOKEN: 'studio-token',
    };

    // When
    const runtime = createStudioDevtoolsRuntimeFromConfig();

    // Then
    expect(runtime).toBeUndefined();
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

  it('emits request lifecycle traces without bodies, cookies, or full headers', () => {
    // Given
    const secrets = {
      cookie: 'studio-cookie-secret',
      header: 'studio-header-secret',
      requestBody: 'studio-request-body-secret',
      responseBody: 'studio-response-body-secret',
      urlFragment: 'studio-url-fragment-secret',
      urlQuery: 'studio-url-query-secret',
    } as const;
    const forbiddenTraceFields = ['body', 'cookie', 'cookies', 'headers', 'payload', 'rawBody', 'requestBody', 'responseBody'] as const;
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
      container: new Container(),
      metadata: {},
      request: {
        body: { password: secrets.requestBody },
        cookies: { session: secrets.cookie },
        headers: {
          authorization: `Bearer ${secrets.header}`,
          cookie: `session=${secrets.cookie}`,
          'x-request-id': 'req-1',
        },
        method: 'POST',
        params: {},
        path: '/login',
        query: {},
        raw: {},
        requestId: 'req-1',
        url: `/login?token=${secrets.urlQuery}#${secrets.urlFragment}`,
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
    } satisfies RequestContext;

    // When
    runtime.requestObserver.onRequestStart?.({ requestContext });
    runtime.requestObserver.onRequestSuccess?.({ requestContext }, { accessToken: secrets.responseBody });
    runtime.requestObserver.onRequestFinish?.({ requestContext });

    // Then
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events[0]).toMatchObject({ type: 'request', payload: { requestId: 'req-1', status: 'started' } });
    expect(events[1]).toMatchObject({ type: 'request', payload: { requestId: 'req-1', status: 'succeeded', statusCode: 201 } });
    expect(events[0]?.payload).toMatchObject({ url: '/login' });
    const serializedEvents = JSON.stringify(events);
    const serializedTracePayloads = JSON.stringify(events.map((event) => event.payload));
    for (const secret of Object.values(secrets)) {
      expect(serializedEvents).not.toContain(secret);
    }
    for (const field of forbiddenTraceFields) {
      expect(serializedTracePayloads).not.toContain(`"${field}":`);
    }
  });

  it('auto-instruments bootstrap when fluo dev --studio injects Studio env', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    (globalThis as Record<string, unknown>)[studioGlobalConfigKey] = {
      FLUO_STUDIO: '1',
      FLUO_STUDIO_APP_ID: 'app-env-test',
      FLUO_STUDIO_EPOCH: 'epoch-env-test',
      FLUO_STUDIO_TOKEN: 'studio-token',
      FLUO_STUDIO_URL: 'http://127.0.0.1:49152',
    };

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

  it('publishes application and context bootstrap events through an explicit host bridge', async () => {
    const events: StudioLiveEvent[] = [];
    const createBridge = (runtime: 'bun' | 'worker') =>
      new StudioDevtoolsRuntime({
        appId: `${runtime}-host`,
        epoch: `${runtime}-epoch`,
        runtime,
        transport: {
          publish(event) {
            events.push(event);
          },
        },
      });

    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});

    const app = await bootstrapApplication({
      logger,
      rootModule: AppModule,
      studioDevtools: createBridge('bun'),
    });
    await app.close();

    const context = await FluoFactory.createApplicationContext(AppModule, {
      studioDevtools: createBridge('worker'),
    });
    await context.close();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: { appId: 'bun-host', runtime: 'bun' }, type: 'snapshot' }),
        expect.objectContaining({ source: { appId: 'bun-host', runtime: 'bun' }, type: 'heartbeat' }),
        expect.objectContaining({ source: { appId: 'worker-host', runtime: 'worker' }, type: 'snapshot' }),
        expect.objectContaining({ source: { appId: 'worker-host', runtime: 'worker' }, type: 'heartbeat' }),
      ]),
    );
  });

  it('keeps bootstrap and request observation operational when a host transport throws synchronously', async () => {
    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});

    const studioDevtools = new StudioDevtoolsRuntime({
      appId: 'throwing-host',
      transport: {
        publish() {
          throw new Error('host transport unavailable');
        },
      },
    });
    const observerContext = {
      requestContext: {
        request: {
          cookies: {},
          headers: {},
          method: 'GET',
          path: '/health',
          params: {},
          query: {},
          raw: undefined,
          requestId: 'request-1',
          url: '/health',
        },
        response: {
          committed: false,
          headers: {},
          redirect() {},
          async send() {},
          setHeader() {},
          setStatus() {},
          statusCode: 200,
        },
      } satisfies Pick<RequestContext, 'request' | 'response'>,
    } as unknown as Parameters<NonNullable<typeof studioDevtools.requestObserver.onRequestStart>>[0];

    const app = await bootstrapApplication({
      logger,
      rootModule: AppModule,
      studioDevtools,
    });
    await app.close();

    const factoryApp = await FluoFactory.create(AppModule, { studioDevtools });
    await factoryApp.close();

    const context = await FluoFactory.createApplicationContext(AppModule, { studioDevtools });
    await context.close();

    expect(() => studioDevtools.requestObserver.onRequestStart?.(observerContext)).not.toThrow();
  });

  it('keeps bootstrap, request observation, and close operational when a host transport rejects asynchronously', async () => {
    // Given
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    let resolveRejectionTurn: (() => void) | undefined;
    let rejectionTurnTimeout: ReturnType<typeof setTimeout> | undefined;
    const rejectionTurnSettled = new Promise<void>((resolve, reject) => {
      resolveRejectionTurn = resolve;
      rejectionTurnTimeout = setTimeout(() => {
        rejectionTurnTimeout = undefined;
        reject(new Error('Studio transport rejection turn did not settle'));
      }, 1_000);
    });

    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});

    const studioDevtools = new StudioDevtoolsRuntime({
      appId: 'rejecting-host',
      transport: {
        publish() {
          return Promise.reject(new Error('host transport unavailable'));
        },
      },
    });
    const observerContext = {
      requestContext: {
        request: {
          cookies: {},
          headers: {},
          method: 'GET',
          path: '/health',
          params: {},
          query: {},
          raw: undefined,
          requestId: 'request-1',
          url: '/health',
        },
        response: {
          committed: false,
          headers: {},
          redirect() {},
          async send() {},
          setHeader() {},
          setStatus() {},
          statusCode: 200,
        },
      } satisfies Pick<RequestContext, 'request' | 'response'>,
    } as unknown as Parameters<NonNullable<typeof studioDevtools.requestObserver.onRequestStart>>[0];

    try {
      // When
      const app = await bootstrapApplication({
        logger,
        rootModule: AppModule,
        studioDevtools,
      });
      studioDevtools.requestObserver.onRequestStart?.(observerContext);
      await app.close();

      setImmediate(() => {
        if (rejectionTurnTimeout !== undefined) {
          clearTimeout(rejectionTurnTimeout);
          rejectionTurnTimeout = undefined;
        }
        resolveRejectionTurn?.();
      });

      // Then
      await rejectionTurnSettled;
      expect(unhandledRejections).toEqual([]);
    } finally {
      if (rejectionTurnTimeout !== undefined) {
        clearTimeout(rejectionTurnTimeout);
      }
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('prefers an explicit bridge over CLI injection without calling injected fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    const events: StudioLiveEvent[] = [];
    (globalThis as Record<string, unknown>)[studioGlobalConfigKey] = {
      FLUO_STUDIO: '1',
      FLUO_STUDIO_TOKEN: 'cli-token',
      FLUO_STUDIO_URL: 'http://127.0.0.1:49152',
    };

    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});

    const app = await FluoFactory.create(AppModule, {
      studioDevtools: new StudioDevtoolsRuntime({
        appId: 'explicit-host',
        runtime: 'bun',
        transport: {
          publish(event) {
            events.push(event);
          },
        },
      }),
    });
    await app.close();

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: { appId: 'explicit-host', runtime: 'bun' }, type: 'snapshot' }),
      expect.objectContaining({ source: { appId: 'explicit-host', runtime: 'bun' }, type: 'heartbeat' }),
    ]));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
