import { Controller, Get, type MiddlewareLike, type RequestContext } from '@konekti/http';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';
import { type Registry, Registry as PrometheusRegistry, collectDefaultMetrics } from 'prom-client';

import {
  HttpMetricsMiddleware,
  type HttpMetricsMiddlewareOptions,
  type HttpMetricsPathLabelMode,
  type HttpMetricsPathLabelNormalizer,
} from './http-metrics-middleware.js';
import { METER_PROVIDER } from './meter-provider.js';
import { METRICS_SERVICE, MetricsService } from './metrics-service.js';
import { PrometheusMeterProvider } from './prometheus-meter-provider.js';

export interface MetricsHttpOptions {
  pathLabelMode?: HttpMetricsPathLabelMode;
  pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  unknownPathLabel?: string;
}

export interface MetricsModuleOptions {
  http?: boolean | MetricsHttpOptions;
  path?: string;
  provider?: 'prometheus';
  defaultMetrics?: boolean;
  middleware?: MiddlewareLike[];
  /** External Prometheus registry to share between built-in and custom metrics. */
  registry?: Registry;
}

export class MetricsModule {
  private static registeredRegistries = new WeakSet<Registry>();

  static forRoot(options: MetricsModuleOptions = {}): ModuleType {
    const provider = options.provider ?? 'prometheus';
    if (provider !== 'prometheus') {
      throw new Error(`MetricsModule provider "${provider}" is not supported. Use provider "prometheus".`);
    }

    const httpOptions = resolveHttpOptions(options.http);
    const metricsPath = options.path ?? '/metrics';
    const registry = options.registry ?? new PrometheusRegistry();
    const metricsService = new MetricsService(registry);
    const meterProvider = new PrometheusMeterProvider(registry);

    if (options.defaultMetrics !== false && !MetricsModule.registeredRegistries.has(registry)) {
      MetricsModule.registeredRegistries.add(registry);
      collectDefaultMetrics({ register: registry });
    }

    const middleware = httpOptions
      ? [new HttpMetricsMiddleware(registry, httpOptions), ...(options.middleware ?? [])]
      : (options.middleware ?? []);

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

function resolveHttpOptions(http: MetricsModuleOptions['http']): HttpMetricsMiddlewareOptions | undefined {
  if (!http) {
    return undefined;
  }

  if (http === true) {
    return {};
  }

  return {
    pathLabelMode: http.pathLabelMode,
    pathLabelNormalizer: http.pathLabelNormalizer,
    unknownPathLabel: http.unknownPathLabel,
  };
}
