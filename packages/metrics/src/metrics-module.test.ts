import { getModuleMetadata, Inject } from '@fluojs/core';
import { ContainerResolutionError } from '@fluojs/di';
import {
  Controller,
  ForbiddenException,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  type MiddlewareContext,
  type Next,
} from '@fluojs/http';
import { bootstrapApplication, defineModule, PLATFORM_SHELL, type PlatformComponent } from '@fluojs/runtime';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { METER_PROVIDER } from './providers/meter-provider.js';
import { MetricsModule } from './metrics-module.js';
import { MetricsService } from './metrics-service.js';
import { PrometheusMeterProvider } from './providers/prometheus-meter-provider.js';

type TestResponse = FrameworkResponse & { body?: unknown };
type TestPlatformHealthStatus = 'healthy' | 'unhealthy' | 'degraded';
type TestPlatformReadinessStatus = 'ready' | 'not-ready' | 'degraded';

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

function createPlatformComponent({
  health = 'healthy',
  id,
  kind,
  readiness = 'ready',
}: {
  health?: TestPlatformHealthStatus;
  id: string;
  kind: string;
  readiness?: TestPlatformReadinessStatus;
}): PlatformComponent {
  return {
    async health() {
      return { status: health };
    },
    id,
    kind,
    async ready() {
      return { critical: false, status: readiness };
    },
    snapshot() {
      return {
        dependencies: [],
        details: {},
        health: { status: health },
        id,
        kind,
        ownership: { externallyManaged: false, ownsResources: true },
        readiness: { critical: false, status: readiness },
        state: readiness === 'ready' ? 'ready' : 'starting',
        telemetry: { namespace: kind, tags: {} },
      };
    },
    async start() {},
    state() {
      return readiness === 'ready' ? 'ready' : 'starting';
    },
    async stop() {},
    async validate() {
      return { issues: [], ok: health !== 'unhealthy' };
    },
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

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
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

    try {
      const forbiddenResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), forbiddenResponse);
      expect(forbiddenResponse.statusCode).toBe(403);

      const metricsResponse = createResponse();
      await app.dispatch(createRequest('/metrics', { 'x-metrics-token': 'secret-token' }), metricsResponse);

      expect(metricsResponse.statusCode).toBe(200);
      expect(String(metricsResponse.body)).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');
    } finally {
      await app.close();
    }
  });

  it('binds endpoint middleware when the scrape endpoint path is empty', async () => {
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
          path: '',
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const forbiddenResponse = createResponse();
      await app.dispatch(createRequest(''), forbiddenResponse);
      expect(forbiddenResponse.statusCode).toBe(403);

      const metricsResponse = createResponse();
      await app.dispatch(createRequest('', { 'x-metrics-token': 'secret-token' }), metricsResponse);

      expect(metricsResponse.statusCode).toBe(200);
      expect(String(metricsResponse.body)).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');
    } finally {
      await app.close();
    }
  });

  it('records endpoint middleware failures when HTTP instrumentation is enabled', async () => {
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
          http: true,
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const forbiddenResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), forbiddenResponse);
      expect(forbiddenResponse.statusCode).toBe(403);

      const metricsResponse = createResponse();
      await app.dispatch(createRequest('/metrics', { 'x-metrics-token': 'secret-token' }), metricsResponse);

      const metricsText = String(metricsResponse.body);

      expect(metricsResponse.statusCode).toBe(200);
      expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics",status="403"} 1');
      expect(metricsText).toContain('http_errors_total{method="GET",path="/metrics",status="403"} 1');
      expect(metricsText).toContain('http_request_duration_seconds_count{method="GET",path="/metrics",status="403"} 1');
    } finally {
      await app.close();
    }
  });

  it('keeps endpoint middleware route-scoped while module-level middleware remains unfiltered', () => {
    class EndpointMiddleware {
      async handle(_context: MiddlewareContext, next: Next): Promise<void> {
        await next();
      }
    }

    const moduleMiddleware = {
      async handle(_context: MiddlewareContext, next: Next): Promise<void> {
        await next();
      },
    };

    const metricsRuntimeModule = MetricsModule.forRoot({
      defaultMetrics: false,
      endpointMiddleware: [EndpointMiddleware],
      middleware: [moduleMiddleware],
    });

    const metadata = getModuleMetadata(metricsRuntimeModule);

    expect(metadata?.middleware).toHaveLength(2);
    expect(metadata?.middleware?.[0]).toMatchObject({
      middleware: EndpointMiddleware,
      routes: ['/metrics'],
    });
    expect(metadata?.middleware?.[1]).toBe(moduleMiddleware);
  });

  it('composes endpoint middleware before module-level middleware on the scrape route', async () => {
    const calls: string[] = [];

    class EndpointMiddleware {
      async handle(_context: MiddlewareContext, next: Next): Promise<void> {
        calls.push('endpoint:before');
        await next();
        calls.push('endpoint:after');
      }
    }

    const moduleMiddleware = {
      async handle(_context: MiddlewareContext, next: Next): Promise<void> {
        calls.push('module:before');
        await next();
        calls.push('module:after');
      },
    };

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          endpointMiddleware: [EndpointMiddleware],
          middleware: [moduleMiddleware],
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      expect(response.statusCode).toBe(200);
      expect(calls).toEqual(['endpoint:before', 'module:before', 'module:after', 'endpoint:after']);
    } finally {
      await app.close();
    }
  });

  it('does not bind endpoint middleware when the scrape endpoint is disabled', async () => {
    class DisabledEndpointMiddleware {
      async handle(): Promise<void> {
        throw new ForbiddenException('Disabled metrics endpoint middleware should not run.');
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          endpointMiddleware: [DisabledEndpointMiddleware],
          path: false,
        }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const response = createResponse();
    await app.dispatch(createRequest('/metrics'), response);

    expect(response.statusCode).toBe(404);

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

    try {
      const response = createResponse();

      await app.dispatch(createRequest('/metrics'), response);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe(Registry.PROMETHEUS_CONTENT_TYPE);
      expect(response.body).toEqual(expect.stringContaining('fluo_metrics_registry_mode{mode="isolated"} 1'));
      expect(response.body).toEqual(expect.stringContaining('fluo_component_ready{component_id="runtime.shell",component_kind="runtime",operation="readiness",result="ready",env="unknown",instance="local"} 1'));
      expect(response.body).toEqual(expect.stringContaining('fluo_component_health{component_id="runtime.shell",component_kind="runtime",operation="health",result="healthy",env="unknown",instance="local"} 1'));
      expect(response.body).toEqual(expect.stringContaining('process_cpu_seconds_total'));
      expect(response.body).toEqual(expect.stringContaining('nodejs_heap_size_total_bytes'));
    } finally {
      await app.close();
    }
  });

  it('omits Prometheus default collectors when defaultMetrics is false', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      const metricsText = String(response.body);
      expect(response.statusCode).toBe(200);
      expect(metricsText).not.toContain('process_cpu_seconds_total');
      expect(metricsText).not.toContain('nodejs_heap_size_total_bytes');
    } finally {
      await app.close();
    }
  });

  it('does not install HTTP collectors until HTTP instrumentation is opted in', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      const metricsText = String(response.body);
      expect(response.statusCode).toBe(200);
      expect(metricsText).not.toContain('http_requests_total');
      expect(metricsText).not.toContain('http_errors_total');
      expect(metricsText).not.toContain('http_request_duration_seconds');
    } finally {
      await app.close();
    }
  });

  it('keeps default metrics registration once per shared registry', async () => {
    const sharedRegistry = new Registry();

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({ registry: sharedRegistry, path: '/metrics-a' }),
        MetricsModule.forRoot({ registry: sharedRegistry, path: '/metrics-b' }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const response = createResponse();
    await app.dispatch(createRequest('/metrics-b'), response);

    expect(response.statusCode).toBe(200);
    expect(String(response.body)).toContain('process_cpu_seconds_total');
    expect(String(response.body)).toContain('fluo_metrics_registry_mode{mode="shared"} 1');

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

    try {
      const errorResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), errorResponse);
      expect(errorResponse.statusCode).toBe(500);

      const metricsResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), metricsResponse);

      const metricsText = String(metricsResponse.body);

      expect(metricsResponse.statusCode).toBe(200);
      expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics",status="500"} 1');
      expect(metricsText).toContain('http_errors_total{method="GET",path="/metrics",status="500"} 1');
    } finally {
      await app.close();
    }
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

    try {
      const firstResponse = createResponse();
      await app.dispatch(createRequest('/metrics/123'), firstResponse);
      expect(firstResponse.statusCode).toBe(200);

      const secondResponse = createResponse();
      await app.dispatch(createRequest('/metrics/456'), secondResponse);

      const metricsText = String(secondResponse.body);

      expect(secondResponse.statusCode).toBe(200);
      expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics/:resourceId",status="200"} 1');
    } finally {
      await app.close();
    }
  });

  it('records ordinary application routes when HTTP instrumentation is enabled', async () => {
    @Controller('/orders')
    class OrdersController {
      @Get('/:orderId')
      getOrder(): { id: string } {
        return { id: '123' };
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      controllers: [OrdersController],
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const routeResponse = createResponse();
      await app.dispatch(createRequest('/orders/123'), routeResponse);
      expect(routeResponse.statusCode).toBe(200);

      const metricsResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), metricsResponse);

      const metricsText = String(metricsResponse.body);
      expect(metricsResponse.statusCode).toBe(200);
      expect(metricsText).toContain('http_requests_total{method="GET",path="/orders/:orderId",status="200"} 1');
      expect(metricsText).toContain('http_request_duration_seconds_count{method="GET",path="/orders/:orderId",status="200"} 1');
      expect(metricsText).not.toContain('http_errors_total{method="GET",path="/orders/:orderId",status="200"}');
    } finally {
      await app.close();
    }
  });

  it('does not make metrics providers visible to sibling modules', async () => {
    @Inject(MetricsService)
    class SiblingService {
      constructor(readonly metrics: MetricsService) {}
    }

    class SiblingModule {}

    defineModule(SiblingModule, {
      providers: [SiblingService],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true }), SiblingModule],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow('not visible through a global module');
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

    const metricsService = (await app.container.resolve(MetricsService)) as MetricsService;
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

    try {
      const metricsService = (await app.container.resolve(MetricsService)) as MetricsService;
      const resolvedRegistry = metricsService.getRegistry();

      expect(resolvedRegistry).toBe(sharedRegistry);

      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      expect(response.statusCode).toBe(200);
      expect(String(response.body)).toContain('app_custom_requests_total{endpoint="/api"} 1');
      expect(String(response.body)).toContain('fluo_metrics_registry_mode{mode="shared"} 1');
    } finally {
      await app.close();
    }
  });

  it('refreshes platform telemetry when the shared registry is scraped directly', async () => {
    const sharedRegistry = new Registry();
    const component = createPlatformComponent({
      health: 'degraded',
      id: 'queue.direct',
      kind: 'queue',
      readiness: 'degraded',
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, path: false, registry: sharedRegistry })],
    });

    const app = await bootstrapApplication({
      platform: { components: [component] },
      rootModule: AppModule,
    });

    try {
      const metricsService = (await app.container.resolve(MetricsService)) as MetricsService;
      const metricsText = await metricsService.getRegistry().metrics();

      expect(metricsText).toContain('fluo_metrics_registry_mode{mode="shared"} 1');
      expect(metricsText).toContain('fluo_component_ready{component_id="queue.direct",component_kind="queue",operation="readiness",result="degraded"');
      expect(metricsText).toContain('fluo_component_health{component_id="queue.direct",component_kind="queue",operation="health",result="degraded"');
    } finally {
      await app.close();
    }
  });

  it('reuses built-in HTTP metrics when multiple module instances share one registry', async () => {
    const sharedRegistry = new Registry();

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({ defaultMetrics: false, http: true, path: '/metrics-a', registry: sharedRegistry }),
        MetricsModule.forRoot({ defaultMetrics: false, http: true, path: '/metrics-b', registry: sharedRegistry }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const firstResponse = createResponse();
    await app.dispatch(createRequest('/metrics-a'), firstResponse);
    expect(firstResponse.statusCode).toBe(200);

    const secondResponse = createResponse();
    await app.dispatch(createRequest('/metrics-b'), secondResponse);
    expect(secondResponse.statusCode).toBe(200);

    const metricsText = await sharedRegistry.metrics();
    expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics-a",status="200"} 1');
    expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics-b",status="200"} 1');
    expect(metricsText).toContain('fluo_metrics_registry_mode{mode="shared"} 1');

    await app.close();
  });

  it('validates framework-owned HTTP collector label schemas before reuse', async () => {
    const sharedRegistry = new Registry();

    class FirstAppModule {}

    defineModule(FirstAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, path: '/metrics-a', registry: sharedRegistry })],
    });

    const firstApp = await bootstrapApplication({
      rootModule: FirstAppModule,
    });
    const requestsCounter = sharedRegistry.getSingleMetric('http_requests_total') as Counter<string> & { labelNames: string[] };
    requestsCounter.labelNames = ['method'];

    await firstApp.close();

    class SecondAppModule {}

    defineModule(SecondAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, path: '/metrics-b', registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: SecondAppModule })).rejects.toThrow(
      'Metric name "http_requests_total" is already registered with labels [method]. Built-in HTTP metrics require labels [method,path,status].',
    );
  });

  it('validates framework-owned HTTP duration histogram label schemas before reuse', async () => {
    const sharedRegistry = new Registry();

    class FirstAppModule {}

    defineModule(FirstAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, path: '/metrics-a', registry: sharedRegistry })],
    });

    const firstApp = await bootstrapApplication({
      rootModule: FirstAppModule,
    });
    const durationHistogram = sharedRegistry.getSingleMetric('http_request_duration_seconds') as Histogram<string> & { labelNames: string[] };
    durationHistogram.labelNames = ['method', 'path'];

    await firstApp.close();

    class SecondAppModule {}

    defineModule(SecondAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, path: '/metrics-b', registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: SecondAppModule })).rejects.toThrow(
      'Metric name "http_request_duration_seconds" is already registered with labels [method,path]. Built-in HTTP metrics require labels [method,path,status].',
    );
  });

  it('rejects shared-registry HTTP collector reuse with incompatible path-label configuration', async () => {
    const sharedRegistry = new Registry();

    class FirstAppModule {}

    defineModule(FirstAppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          http: {
            unknownPathLabel: 'FIRST_UNKNOWN',
          },
          path: '/metrics-a',
          registry: sharedRegistry,
        }),
      ],
    });

    const firstApp = await bootstrapApplication({
      rootModule: FirstAppModule,
    });
    await firstApp.close();

    class SecondAppModule {}

    defineModule(SecondAppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          http: {
            unknownPathLabel: 'SECOND_UNKNOWN',
          },
          path: '/metrics-b',
          registry: sharedRegistry,
        }),
      ],
    });

    await expect(bootstrapApplication({ rootModule: SecondAppModule })).rejects.toThrow(
      'Metric name "http_requests_total" is already registered with framework HTTP path-label configuration pathLabelMode="template", pathLabelNormalizer=none, unknownPathLabel="FIRST_UNKNOWN". Built-in HTTP metrics require matching path-label configuration before reuse; received pathLabelMode="template", pathLabelNormalizer=none, unknownPathLabel="SECOND_UNKNOWN".',
    );
  });

  it('reuses framework-owned platform telemetry gauges when module instances share one registry', async () => {
    const sharedRegistry = new Registry();

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({ defaultMetrics: false, path: '/metrics-a', registry: sharedRegistry }),
        MetricsModule.forRoot({ defaultMetrics: false, path: '/metrics-b', registry: sharedRegistry }),
      ],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const firstResponse = createResponse();
    await app.dispatch(createRequest('/metrics-a'), firstResponse);
    expect(firstResponse.statusCode).toBe(200);

    const secondResponse = createResponse();
    await app.dispatch(createRequest('/metrics-b'), secondResponse);
    expect(secondResponse.statusCode).toBe(200);

    const metricsText = await sharedRegistry.metrics();
    expect(metricsText).toContain('fluo_metrics_registry_mode{mode="shared"} 1');
    expect(metricsText).toContain('fluo_component_ready{component_id="runtime.shell"');
    expect(metricsText).toContain('fluo_component_health{component_id="runtime.shell"');

    await app.close();
  });

  it('replaces stale platform telemetry series when a shared registry is reused by a later module instance', async () => {
    const sharedRegistry = new Registry();
    const staleComponent = createPlatformComponent({
      id: 'cache.previous',
      kind: 'cache',
    });
    const currentComponent = createPlatformComponent({
      health: 'degraded',
      id: 'queue.current',
      kind: 'queue',
      readiness: 'degraded',
    });

    class FirstAppModule {}

    defineModule(FirstAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, registry: sharedRegistry })],
    });

    const firstApp = await bootstrapApplication({
      platform: { components: [staleComponent] },
      rootModule: FirstAppModule,
    });

    const firstResponse = createResponse();
    await firstApp.dispatch(createRequest('/metrics'), firstResponse);
    expect(String(firstResponse.body)).toContain('component_id="cache.previous"');

    await firstApp.close();

    class SecondAppModule {}

    defineModule(SecondAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, registry: sharedRegistry })],
    });

    const secondApp = await bootstrapApplication({
      platform: { components: [currentComponent] },
      rootModule: SecondAppModule,
    });

    try {
      const secondResponse = createResponse();
      await secondApp.dispatch(createRequest('/metrics'), secondResponse);

      const metricsText = String(secondResponse.body);

      expect(secondResponse.statusCode).toBe(200);
      expect(metricsText).not.toContain('component_id="cache.previous"');
      expect(metricsText).toContain('fluo_component_ready{component_id="queue.current",component_kind="queue",operation="readiness",result="degraded"');
      expect(metricsText).toContain('fluo_component_health{component_id="queue.current",component_kind="queue",operation="health",result="degraded"');
    } finally {
      await secondApp.close();
    }
  });

  it('throws when an app predefines a built-in platform telemetry gauge name', async () => {
    const sharedRegistry = new Registry();

    new Gauge({
      help: 'Application-defined platform readiness',
      labelNames: ['component_id'],
      name: 'fluo_component_ready',
      registers: [sharedRegistry],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Metric name "fluo_component_ready" is already registered by the application. Built-in platform telemetry requires framework-owned gauges.',
    );
  });

  it('validates framework-owned platform telemetry gauge label schemas before reuse', async () => {
    const sharedRegistry = new Registry();

    class FirstAppModule {}

    defineModule(FirstAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, path: '/metrics-a', registry: sharedRegistry })],
    });

    const firstApp = await bootstrapApplication({
      rootModule: FirstAppModule,
    });
    const readinessGauge = sharedRegistry.getSingleMetric('fluo_component_ready') as Gauge<string> & { labelNames: string[] };
    readinessGauge.labelNames = ['component_id'];

    await firstApp.close();

    class SecondAppModule {}

    defineModule(SecondAppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, path: '/metrics-b', registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: SecondAppModule })).rejects.toThrow(
      'Metric name "fluo_component_ready" is already registered with labels [component_id]. Built-in platform telemetry requires labels [component_id,component_kind,operation,result,env,instance].',
    );
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

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      const metricsText = String(response.body);
      expect(response.statusCode).toBe(200);
      expect(metricsText).toContain('fluo_component_ready{component_id="cache.default",component_kind="cache",operation="readiness",result="degraded"');
      expect(metricsText).toContain('fluo_component_health{component_id="cache.default",component_kind="cache",operation="health",result="degraded"');
    } finally {
      await app.close();
    }
  });

  it('preserves platform telemetry components whose ids and kinds contain key separators', async () => {
    const firstComponent = createPlatformComponent({
      id: 'cache::default',
      kind: 'redis',
    });
    const secondComponent = createPlatformComponent({
      health: 'degraded',
      id: 'cache',
      kind: 'default::redis',
      readiness: 'degraded',
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      platform: { components: [firstComponent, secondComponent] },
      rootModule: AppModule,
    });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      const metricsText = String(response.body);
      expect(response.statusCode).toBe(200);
      expect(metricsText).toContain('fluo_component_ready{component_id="cache::default",component_kind="redis",operation="readiness",result="ready"');
      expect(metricsText).toContain('fluo_component_health{component_id="cache::default",component_kind="redis",operation="health",result="healthy"');
      expect(metricsText).toContain('fluo_component_ready{component_id="cache",component_kind="default::redis",operation="readiness",result="degraded"');
      expect(metricsText).toContain('fluo_component_health{component_id="cache",component_kind="default::redis",operation="health",result="degraded"');
    } finally {
      await app.close();
    }
  });

  it('omits platform telemetry when the platform shell token is absent during scrape refresh', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const container = app.container as typeof app.container & { has: (token: unknown) => boolean };
      const originalHas = container.has.bind(container);
      container.has = (token: unknown) => token !== PLATFORM_SHELL && originalHas(token as Parameters<typeof originalHas>[0]);

      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      const metricsText = String(response.body);

      expect(response.statusCode).toBe(200);
      expect(metricsText).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');
      expect(metricsText).not.toContain('fluo_component_ready{');
      expect(metricsText).not.toContain('fluo_component_health{');
    } finally {
      await app.close();
    }
  });

  it('clears stale platform telemetry series when the platform shell becomes unavailable', async () => {
    let platformShellAvailable = true;

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const container = app.container as typeof app.container & { has: (token: unknown) => boolean };
      const originalHas = container.has.bind(container);
      container.has = (token: unknown) => {
        if (token === PLATFORM_SHELL) {
          return platformShellAvailable;
        }

        return originalHas(token as Parameters<typeof originalHas>[0]);
      };

      const initialResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), initialResponse);
      expect(String(initialResponse.body)).toContain('fluo_component_ready{');
      expect(String(initialResponse.body)).toContain('fluo_component_health{');

      platformShellAvailable = false;
      const missingShellResponse = createResponse();
      await app.dispatch(createRequest('/metrics'), missingShellResponse);

      const metricsText = String(missingShellResponse.body);
      expect(missingShellResponse.statusCode).toBe(200);
      expect(metricsText).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');
      expect(metricsText).not.toContain('fluo_component_ready{');
      expect(metricsText).not.toContain('fluo_component_health{');
    } finally {
      await app.close();
    }
  });

  it('surfaces platform shell resolution failures even when diagnostics use a missing-provider hint', async () => {
    const resolutionFailure = new ContainerResolutionError(
      'Structured missing provider context should not be treated as absence when the token is registered.',
      {
        hint: 'Ensure the provider is registered in a module\'s providers array, or that the module exporting it is imported by the consuming module.',
        token: PLATFORM_SHELL,
      },
    );
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    try {
      const container = app.container as typeof app.container & { has: (token: unknown) => boolean };
      const originalResolve = app.container.resolve.bind(app.container);
      container.has = (token: unknown) => token === PLATFORM_SHELL;
      app.container.resolve = (async (token: Parameters<typeof originalResolve>[0]) => {
        if (token === PLATFORM_SHELL) {
          throw resolutionFailure;
        }

        return await originalResolve(token);
      }) as typeof app.container.resolve;

      const response = createResponse();
      await app.dispatch(createRequest('/metrics'), response);

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Internal server error.',
            status: 500,
          }),
        }),
      );
    } finally {
      await app.close();
    }
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

    try {
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
    } finally {
      await app.close();
    }
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

    const metricsService = (await app.container.resolve(MetricsService)) as MetricsService;

    expect(() => {
      metricsService.counter({
        help: 'Duplicate registration',
        name: 'shared_duplicate_counter',
      });
    }).toThrow('A metric with the name shared_duplicate_counter has already been registered.');

    await app.close();
  });

  it('throws when an app predefines a built-in HTTP counter name', async () => {
    const sharedRegistry = new Registry();

    new Counter({
      help: 'Application-defined HTTP requests',
      name: 'http_requests_total',
      registers: [sharedRegistry],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Metric name "http_requests_total" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.',
    );
  });

  it('throws when an app predefines a built-in HTTP error counter name', async () => {
    const sharedRegistry = new Registry();

    new Counter({
      help: 'Application-defined HTTP errors',
      name: 'http_errors_total',
      registers: [sharedRegistry],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Metric name "http_errors_total" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.',
    );
  });

  it('throws when an app predefines the built-in HTTP duration histogram name', async () => {
    const sharedRegistry = new Registry();

    new Histogram({
      help: 'Application-defined HTTP durations',
      name: 'http_request_duration_seconds',
      registers: [sharedRegistry],
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true, registry: sharedRegistry })],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Metric name "http_request_duration_seconds" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.',
    );
  });

  it('creates isolated registry by default when registry option is omitted', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    const metricsService = (await app.container.resolve(MetricsService)) as MetricsService;
    const registry = metricsService.getRegistry();

    metricsService.counter({
      help: 'Isolated counter',
      name: 'isolated_counter_total',
    });

    const metrics = await registry.metrics();
    expect(metrics).toContain('isolated_counter_total');

    await app.close();
  });

  it('creates a fresh isolated registry for each bootstrap of a reused dynamic metrics module', async () => {
    const MetricsRuntimeModule = MetricsModule.forRoot({ defaultMetrics: false });

    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsRuntimeModule],
    });

    const firstApp = await bootstrapApplication({
      rootModule: AppModule,
    });
    const firstMetricsService = (await firstApp.container.resolve(MetricsService)) as MetricsService;
    const firstRegistry = firstMetricsService.getRegistry();

    firstMetricsService.counter({
      help: 'Counter scoped to the first bootstrap only',
      name: 'bootstrap_local_counter_total',
    });

    expect(await firstRegistry.metrics()).toContain('bootstrap_local_counter_total');

    await firstApp.close();

    const secondApp = await bootstrapApplication({
      rootModule: AppModule,
    });
    const secondMetricsService = (await secondApp.container.resolve(MetricsService)) as MetricsService;
    const secondRegistry = secondMetricsService.getRegistry();

    expect(secondRegistry).not.toBe(firstRegistry);
    expect(await secondRegistry.metrics()).not.toContain('bootstrap_local_counter_total');

    await secondApp.close();
  });
});
