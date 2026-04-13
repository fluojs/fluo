import { ForbiddenException, type FrameworkRequest, type FrameworkResponse, type MiddlewareContext, type Next } from '@fluojs/http';
import { bootstrapApplication, defineModule, type PlatformComponent } from '@fluojs/runtime';
import { Counter, Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { METER_PROVIDER } from './providers/meter-provider.js';
import { MetricsModule } from './metrics-module.js';
import { MetricsService } from './metrics-service.js';
import { PrometheusMeterProvider } from './providers/prometheus-meter-provider.js';

type TestResponse = FrameworkResponse & { body?: unknown };

function createRequest(path: string, headers: FrameworkRequest['headers'] = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
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
      const headers = this.headers as Record<string, string | string[]>;
      headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('MetricsModule', () => {
  it('can disable the scrape endpoint explicitly', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, path: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const response = createResponse();
    await app.dispatch(createRequest('/metrics'), response);

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('supports route-scoped endpoint middleware for scrape protection', async () => {
    class MetricsAccessMiddleware {
      async handle(context: MiddlewareContext, next: Next): Promise<void> {
        if (context.request.headers['x-metrics-token'] !== 'secret-token') {
          throw new ForbiddenException('Metrics endpoint requires x-metrics-token.');
        }

        await next();
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          endpointMiddleware: [MetricsAccessMiddleware],
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const forbiddenResponse = createResponse();
    await app.dispatch(createRequest('/metrics'), forbiddenResponse);
    expect(forbiddenResponse.statusCode).toBe(403);

    const metricsResponse = createResponse();
    await app.dispatch(createRequest('/metrics', { 'x-metrics-token': 'secret-token' }), metricsResponse);

    expect(metricsResponse.statusCode).toBe(200);
    expect(String(metricsResponse.body)).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');

    await app.close();
  });

  it('serves Prometheus text with Node/process metrics', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot()],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('/metrics'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toEqual(expect.stringContaining('fluo_metrics_registry_mode{mode="isolated"} 1'));
    expect(response.body).toEqual(expect.stringContaining('fluo_component_ready{component_id="runtime.shell",component_kind="runtime",operation="readiness",result="ready",env="unknown",instance="local"} 1'));
    expect(response.body).toEqual(expect.stringContaining('fluo_component_health{component_id="runtime.shell",component_kind="runtime",operation="health",result="healthy",env="unknown",instance="local"} 1'));
    expect(response.body).toEqual(expect.stringContaining('process_cpu_seconds_total'));
    expect(response.body).toEqual(expect.stringContaining('nodejs_heap_size_total_bytes'));

    await app.close();
  });

  it('uses explicit platform telemetry labels when provided', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          platformTelemetry: {
            env: 'production',
            instance: 'api-1',
          },
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('/metrics'), response);

    expect(response.statusCode).toBe(200);
    expect(String(response.body)).toContain(
      'fluo_component_ready{component_id="runtime.shell",component_kind="runtime",operation="readiness",result="ready",env="production",instance="api-1"} 1',
    );
    expect(String(response.body)).toContain(
      'fluo_component_health{component_id="runtime.shell",component_kind="runtime",operation="health",result="healthy",env="production",instance="api-1"} 1',
    );

    await app.close();
  });

  it('uses an isolated registry for each forRoot call', async () => {
    class FirstAppModule {}
    class SecondAppModule {}

    defineModule(FirstAppModule, {
      imports: [MetricsModule.forRoot({ path: '/metrics-a' })],
    });
    defineModule(SecondAppModule, {
      imports: [MetricsModule.forRoot({ path: '/metrics-b' })],
    });

    const firstApp = await bootstrapApplication({
      rootModule: FirstAppModule,
    });
    const secondApp = await bootstrapApplication({
      rootModule: SecondAppModule,
    });

    const firstResponse = createResponse();
    const secondResponse = createResponse();

    await firstApp.dispatch(createRequest('/metrics-a'), firstResponse);
    await secondApp.dispatch(createRequest('/metrics-b'), secondResponse);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(String(firstResponse.body)).toContain('process_cpu_seconds_total');
    expect(String(secondResponse.body)).toContain('process_cpu_seconds_total');

    await firstApp.close();
    await secondApp.close();
  });

  it('records thrown middleware errors with 500 status labels', async () => {
    let failNextRequest = true;

    const failingMiddleware = {
      async handle(_context: unknown, next: () => Promise<void>): Promise<void> {
        if (failNextRequest) {
          failNextRequest = false;
          throw new Error('metrics route boom');
        }

        await next();
      },
    };

    class AppModule {}
    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, middleware: [failingMiddleware] })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const errorResponse = createResponse();
    await app.dispatch(createRequest('/metrics'), errorResponse);
    expect(errorResponse.statusCode).toBe(500);

    const metricsResponse = createResponse();
    await app.dispatch(createRequest('/metrics'), metricsResponse);

    const metricsText = String(metricsResponse.body);

    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics",status="500"} 1');
    expect(metricsText).toContain('http_errors_total{method="GET",path="/metrics",status="500"} 1');

    await app.close();
  });

  it('normalizes HTTP metric path labels through module-level http options', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          http: true,
          path: '/metrics/:resourceId',
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const firstResponse = createResponse();
    await app.dispatch(createRequest('/metrics/123'), firstResponse);
    expect(firstResponse.statusCode).toBe(200);

    const secondResponse = createResponse();
    await app.dispatch(createRequest('/metrics/456'), secondResponse);

    const metricsText = String(secondResponse.body);

    expect(secondResponse.statusCode).toBe(200);
    expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics/:resourceId",status="200"} 1');

    await app.close();
  });

  it('binds prometheus provider by default and for explicit provider option', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({ defaultMetrics: false }),
        MetricsModule.forRoot({ defaultMetrics: false, path: '/metrics-explicit', provider: 'prometheus' }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const meterProvider = await app.container.resolve(METER_PROVIDER);

    expect(meterProvider).toBeInstanceOf(PrometheusMeterProvider);
    expect((meterProvider as PrometheusMeterProvider).type).toBe('prometheus');

    await app.close();
  });

  it('uses equivalent duplicate-name behavior across MetricsService and MeterProvider APIs', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const metricsService = await app.container.resolve(MetricsService);
    const meterProvider = await app.container.resolve(METER_PROVIDER) as PrometheusMeterProvider;

    metricsService.counter({
      help: 'dup check service first',
      name: 'metrics_duplicate_name_contract_total',
    });

    expect(() => {
      meterProvider.createCounter('metrics_duplicate_name_contract_total', 'dup check provider second');
    }).toThrow('A metric with the name metrics_duplicate_name_contract_total has already been registered.');

    await app.close();
  });

  it('rejects unsupported providers at runtime', () => {
    expect(() => MetricsModule.forRoot({ provider: 'otel' as unknown as 'prometheus' })).toThrow(
      'MetricsModule provider "otel" is not supported. Use provider "prometheus".',
    );
  });

  it('rejects unsafe raw path labels unless explicitly enabled', () => {
    expect(() =>
      MetricsModule.forRoot({
        defaultMetrics: false,
        http: {
          pathLabelMode: 'raw',
        },
      }),
    ).toThrow(
      'HttpMetricsMiddleware pathLabelMode "raw" is disabled by default. Pass allowUnsafeRawPathLabelMode: true only when you have bounded path cardinality.',
    );
  });

  it('uses shared registry when provided via options', async () => {
    const sharedRegistry = new Registry();

    const customCounter = new Counter({
      name: 'app_custom_requests_total',
      help: 'Custom application request counter',
      labelNames: ['endpoint'],
      registers: [sharedRegistry],
    });
    customCounter.inc({ endpoint: '/api' });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ registry: sharedRegistry, defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const metricsService = await app.container.resolve(MetricsService);
    const resolvedRegistry = metricsService.getRegistry();

    expect(resolvedRegistry).toBe(sharedRegistry);

    const response = createResponse();
    await app.dispatch(createRequest('/metrics'), response);

    expect(response.statusCode).toBe(200);
    expect(String(response.body)).toContain('app_custom_requests_total{endpoint="/api"} 1');
    expect(String(response.body)).toContain('fluo_metrics_registry_mode{mode="shared"} 1');

    await app.close();
  });

  it('exports runtime component readiness and health metrics with shared labels', async () => {
    const component: PlatformComponent = {
      async health() {
        return { status: 'degraded' };
      },
      id: 'cache.default',
      kind: 'cache',
      async ready() {
        return { critical: false, status: 'degraded' };
      },
      snapshot() {
        return {
          dependencies: [],
          details: { mode: 'memory' },
          health: { status: 'degraded' },
          id: 'cache.default',
          kind: 'cache',
          ownership: { externallyManaged: false, ownsResources: true },
          readiness: { critical: false, status: 'degraded' },
          state: 'ready',
          telemetry: { namespace: 'cache', tags: {} },
        };
      },
      async start() {},
      state() {
        return 'ready';
      },
      async stop() {},
      async validate() {
        return { issues: [], ok: true };
      },
    };

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      platform: { components: [component] },
      rootModule: AppModule,
    });

    const response = createResponse();
    await app.dispatch(createRequest('/metrics'), response);

    const metricsText = String(response.body);
    expect(response.statusCode).toBe(200);
    expect(metricsText).toContain('fluo_component_ready{component_id="cache.default",component_kind="cache",operation="readiness",result="degraded"');
    expect(metricsText).toContain('fluo_component_health{component_id="cache.default",component_kind="cache",operation="health",result="degraded"');

    await app.close();
  });

  it('serializes overlapping scrapes and removes stale platform status series', async () => {
    let currentReadiness: 'ready' | 'degraded' = 'ready';
    let currentHealth: 'healthy' | 'degraded' = 'healthy';
    let firstProbe = true;
    let startFirstProbe: (() => void) | undefined;
    let releaseFirstProbe: (() => void) | undefined;

    const firstProbeStarted = new Promise<void>((resolve) => {
      startFirstProbe = resolve;
    });
    const firstProbeReleased = new Promise<void>((resolve) => {
      releaseFirstProbe = resolve;
    });

    async function waitForFirstProbeRelease(): Promise<void> {
      if (!firstProbe) {
        return;
      }

      firstProbe = false;
      startFirstProbe?.();
      await firstProbeReleased;
    }

    const component: PlatformComponent = {
      async health() {
        const status = currentHealth;
        await waitForFirstProbeRelease();
        return { status };
      },
      id: 'cache.default',
      kind: 'cache',
      async ready() {
        const status = currentReadiness;
        await waitForFirstProbeRelease();
        return { critical: false, status };
      },
      snapshot() {
        return {
          dependencies: [],
          details: { mode: 'memory' },
          health: { status: currentHealth },
          id: 'cache.default',
          kind: 'cache',
          ownership: { externallyManaged: false, ownsResources: true },
          readiness: { critical: false, status: currentReadiness },
          state: 'ready',
          telemetry: { namespace: 'cache', tags: {} },
        };
      },
      async start() {},
      state() {
        return 'ready';
      },
      async stop() {},
      async validate() {
        return { issues: [], ok: true };
      },
    };

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      platform: { components: [component] },
      rootModule: AppModule,
    });

    const firstResponse = createResponse();
    const secondResponse = createResponse();

    const firstDispatch = app.dispatch(createRequest('/metrics'), firstResponse);
    await firstProbeStarted;

    currentReadiness = 'degraded';
    currentHealth = 'degraded';

    const secondDispatch = app.dispatch(createRequest('/metrics'), secondResponse);
    releaseFirstProbe?.();

    await Promise.all([firstDispatch, secondDispatch]);

    const firstMetrics = String(firstResponse.body);
    const secondMetrics = String(secondResponse.body);

    expect(firstResponse.statusCode).toBe(200);
    expect(firstMetrics).toContain(
      'fluo_component_ready{component_id="cache.default",component_kind="cache",operation="readiness",result="ready",env="unknown",instance="local"} 1',
    );
    expect(firstMetrics).toContain(
      'fluo_component_health{component_id="cache.default",component_kind="cache",operation="health",result="healthy",env="unknown",instance="local"} 1',
    );
    expect(firstMetrics).not.toContain('result="degraded"');

    expect(secondResponse.statusCode).toBe(200);
    expect(secondMetrics).toContain(
      'fluo_component_ready{component_id="cache.default",component_kind="cache",operation="readiness",result="degraded",env="unknown",instance="local"} 0',
    );
    expect(secondMetrics).toContain(
      'fluo_component_health{component_id="cache.default",component_kind="cache",operation="health",result="degraded",env="unknown",instance="local"} 0',
    );
    expect(secondMetrics).not.toContain('result="ready"');
    expect(secondMetrics).not.toContain('result="healthy"');

    await app.close();
  });

  it('emits both framework and custom metrics from shared registry', async () => {
    const sharedRegistry = new Registry();

    const customGauge = new Counter({
      name: 'app_active_connections',
      help: 'Active connection count',
      registers: [sharedRegistry],
    });
    customGauge.inc(5);

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ registry: sharedRegistry })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const response = createResponse();
    await app.dispatch(createRequest('/metrics'), response);

    const metricsText = String(response.body);

    expect(response.statusCode).toBe(200);
    expect(metricsText).toContain('app_active_connections');
    expect(metricsText).toContain('process_cpu_seconds_total');

    await app.close();
  });

  it('throws on duplicate metric names when using shared registry with MetricsService', async () => {
    const sharedRegistry = new Registry();

    new Counter({
      name: 'shared_duplicate_counter',
      help: 'First registration',
      registers: [sharedRegistry],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ registry: sharedRegistry, defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const metricsService = await app.container.resolve(MetricsService);

    expect(() => {
      metricsService.counter({
        help: 'Duplicate registration',
        name: 'shared_duplicate_counter',
      });
    }).toThrow('A metric with the name shared_duplicate_counter has already been registered.');

    await app.close();
  });

  it('creates isolated registry by default when registry option is omitted', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const metricsService = await app.container.resolve(MetricsService);
    const registry = metricsService.getRegistry();

    metricsService.counter({
      help: 'Isolated counter',
      name: 'isolated_counter_total',
    });

    const metrics = await registry.metrics();
    expect(metrics).toContain('isolated_counter_total');

    await app.close();
  });
});
