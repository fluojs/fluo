import { Controller, Get, type MiddlewareLike, type RequestContext } from '@konekti/http';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';
import { Registry, collectDefaultMetrics } from 'prom-client';

import { HttpMetricsMiddleware } from './http-metrics-middleware.js';
import { METER_PROVIDER } from './meter-provider.js';
import { METRICS_SERVICE, MetricsService } from './metrics-service.js';
import { PrometheusMeterProvider } from './prometheus-meter-provider.js';

export interface MetricsModuleOptions {
  http?: boolean;
  path?: string;
  provider?: 'prometheus' | 'otel';
  defaultMetrics?: boolean;
  middleware?: MiddlewareLike[];
}

export class MetricsModule {
  private static registeredRegistries = new WeakSet<Registry>();

  static forRoot(options: MetricsModuleOptions = {}): ModuleType {
    if (options.provider === 'otel') {
      throw new Error('MetricsModule provider "otel" is not implemented yet. Use provider "prometheus".');
    }

    const metricsPath = options.path ?? '/metrics';
    const registry = new Registry();
    const metricsService = new MetricsService(registry);
    const meterProvider = new PrometheusMeterProvider(registry);

    if (options.defaultMetrics !== false && !MetricsModule.registeredRegistries.has(registry)) {
      MetricsModule.registeredRegistries.add(registry);
      collectDefaultMetrics({ register: registry });
    }

    const middleware = options.http === true ? [new HttpMetricsMiddleware(registry), ...(options.middleware ?? [])] : (options.middleware ?? []);

    const providers: Provider[] = [
      {
        provide: METRICS_SERVICE,
        useValue: metricsService,
      },
      {
        provide: METER_PROVIDER,
        useValue: meterProvider,
      },
    ];

    @Controller('')
    class MetricsController {
      @Get(metricsPath)
      async getMetrics(_input: undefined, ctx: RequestContext): Promise<string> {
        ctx.response.setHeader('content-type', registry.contentType);
        return registry.metrics();
      }
    }

    class MetricsRuntimeModule {}

    defineModule(MetricsRuntimeModule, {
      controllers: [MetricsController],
      middleware,
      providers,
    });

    return MetricsRuntimeModule;
  }
}
