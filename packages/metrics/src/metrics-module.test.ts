import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { MetricsModule } from './metrics-module.js';
import { METER_PROVIDER } from './meter-provider.js';
import { METRICS_SERVICE, MetricsService } from './metrics-service.js';
import { PrometheusMeterProvider } from './prometheus-meter-provider.js';

type TestResponse = FrameworkResponse & { body?: unknown };

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
    setHeader(name: string, value: string) {
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

describe('MetricsModule', () => {
  it('serves Prometheus text with Node/process metrics', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot()],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('/metrics'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toEqual(expect.stringContaining('process_cpu_seconds_total'));
    expect(response.body).toEqual(expect.stringContaining('nodejs_heap_size_total_bytes'));

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
      mode: 'test',
      rootModule: FirstAppModule,
    });
    const secondApp = await bootstrapApplication({
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
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
      mode: 'test',
      rootModule: AppModule,
    });

    const metricsService = await app.container.resolve(METRICS_SERVICE) as MetricsService;
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
});
