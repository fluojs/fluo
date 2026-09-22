import { Inject } from '@fluojs/core';
import { Controller, ForbiddenException, FromPath, Get, type MiddlewareContext, type Next, Post, RequestDto } from '@fluojs/http';
import { MetricsModule, MetricsService } from '@fluojs/metrics';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/metrics guide evidence: the /metrics scrape contract (content type,
 * registry-mode series, default collectors), custom application metrics
 * through the non-global MetricsService, HTTP instrumentation with template
 * path labels, endpoint middleware protection feeding the error counters, and
 * path: false disabling the scrape route - real request pipeline, no sleeps.
 */

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

@Inject(MetricsService)
class OrdersService {
  private readonly ordersCreated;

  constructor(metrics: MetricsService) {
    // Create each collector once during construction, then reuse it.
    this.ordersCreated = metrics.counter({
      help: 'Total orders created',
      name: 'orders_created_total',
    });
  }

  recordOrderCreated(): void {
    this.ordersCreated.inc();
  }
}

class OrderParamsDto {
  @FromPath('id')
  id = '';
}

@Inject(OrdersService)
@Controller('/orders')
class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('/:id')
  @RequestDto(OrderParamsDto)
  get(input: OrderParamsDto): { id: string } {
    return { id: input.id };
  }

  @Post()
  create(): { recorded: true } {
    this.orders.recordOrderCreated();
    return { recorded: true };
  }
}

@Inject(MetricsService)
@Controller('/diagnostics')
class DiagnosticsController {
  constructor(private readonly metrics: MetricsService) {}

  // Advanced scrape path: the same registry the /metrics controller renders,
  // reached through MetricsService.getRegistry() (guide: "advanced
  // integrations" seam).
  @Get('/metrics')
  async registryDump(): Promise<string> {
    return this.metrics.getRegistry().metrics();
  }
}

class RejectMetricsRequestMiddleware {
  async handle(_context: MiddlewareContext, _next: Next): Promise<void> {
    throw new ForbiddenException('Metrics endpoint requires x-metrics-token.');
  }
}

async function withApp<T>(
  module: ModuleType,
  run: (app: Awaited<ReturnType<typeof Test.createApp>>) => Promise<T>,
): Promise<T> {
  const app = await Test.createApp({ rootModule: module });
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

describe('@fluojs/metrics guide examples', () => {
  it('serves the Prometheus scrape contract with an isolated registry', async () => {
    class BareAppModule {}

    await withApp(
      defineModule(BareAppModule, {
        imports: [MetricsModule.forRoot({})],
      }),
      async (app) => {
        const response = await app.request('GET', '/metrics').send();

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe(PROMETHEUS_CONTENT_TYPE);
        expect(response.body).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');
        // defaultMetrics defaults to true: process/Node.js collectors are present.
        expect(response.body).toContain('process_cpu_seconds_total');
        // HTTP instrumentation is opt-in and absent here.
        expect(response.body).not.toContain('http_requests_total');
      },
    );
  });

  it('renders custom MetricsService collectors on the module registry', async () => {
    class OrdersAppModule {}

    await withApp(
      defineModule(OrdersAppModule, {
        imports: [MetricsModule.forRoot({ defaultMetrics: false })],
        providers: [OrdersService],
        controllers: [OrdersController, DiagnosticsController],
      }),
      async (app) => {
        // MetricsService is non-global: OrdersService injects it because
        // OrdersAppModule directly imports the MetricsModule.forRoot() registration.
        await app.request('POST', '/orders').body({}).send();
        await app.request('POST', '/orders').body({}).send();

        const response = await app.request('GET', '/metrics').send();

        expect(response.body).toContain('orders_created_total 2');
      },
    );
  });

  it('labels HTTP metrics with route templates when http instrumentation is enabled', async () => {
    class InstrumentedAppModule {}

    await withApp(
      defineModule(InstrumentedAppModule, {
        imports: [MetricsModule.forRoot({ defaultMetrics: false, http: true })],
        providers: [OrdersService],
        controllers: [OrdersController],
      }),
      async (app) => {
        const hit = await app.request('GET', '/orders/42').send();
        expect(hit.status).toBe(200);

        const scrape = await app.request('GET', '/metrics').send();

        expect(scrape.body).toContain('http_requests_total{method="GET",path="/orders/:id",status="200"} 1');
        expect(scrape.body).toContain('http_request_duration_seconds_bucket');
      },
    );
  });

  it('records protected-scrape failures in the built-in HTTP collectors', async () => {
    class ProtectedAppModule {}

    await withApp(
      defineModule(ProtectedAppModule, {
        imports: [
          MetricsModule.forRoot({
            defaultMetrics: false,
            endpointMiddleware: [RejectMetricsRequestMiddleware],
            http: true,
          }),
        ],
        controllers: [DiagnosticsController],
      }),
      async (app) => {
        const rejected = await app.request('GET', '/metrics').send();
        expect(rejected.status).toBe(403);

        // The protected-scrape 403 is itself counted; the advanced
        // getRegistry() scrape path renders the same registry contents.
        const dump = await app.request('GET', '/diagnostics/metrics').send();
        expect(dump.status).toBe(200);
        expect(dump.body).toContain('http_errors_total{method="GET",path="/metrics",status="403"} 1');
        expect(dump.body).toContain('http_requests_total{method="GET",path="/metrics",status="403"} 1');
      },
    );
  });

  it('disables the scrape endpoint entirely with path: false', async () => {
    class NoScrapeAppModule {}

    await withApp(
      defineModule(NoScrapeAppModule, {
        imports: [MetricsModule.forRoot({ defaultMetrics: false, path: false })],
      }),
      async (app) => {
        const response = await app.request('GET', '/metrics').send();
        expect(response.status).toBe(404);
      },
    );
  });
});
