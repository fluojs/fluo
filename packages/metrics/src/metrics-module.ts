import type { Provider } from '@fluojs/di';
import { Controller, Get, type MiddlewareLike, type RequestContext } from '@fluojs/http';
import { defineModule, type ModuleType, PLATFORM_SHELL, type PlatformShellSnapshot } from '@fluojs/runtime';
import { collectDefaultMetrics, Gauge, Registry as PrometheusRegistry, type Registry } from 'prom-client';

import {
  HttpMetricsMiddleware,
  type HttpMetricsMiddlewareOptions,
  type HttpMetricsPathLabelMode,
  type HttpMetricsPathLabelNormalizer,
} from './http-metrics-middleware.js';
import { METER_PROVIDER } from './providers/meter-provider.js';
import { MetricsService } from './metrics-service.js';
import { PrometheusMeterProvider } from './providers/prometheus-meter-provider.js';

/** HTTP-specific metric labeling options exposed by `MetricsModule.forRoot(...)`. */
export interface MetricsHttpOptions {
  pathLabelMode?: HttpMetricsPathLabelMode;
  pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  unknownPathLabel?: string;
}

/**
 * Module options for exposing Prometheus metrics and runtime platform telemetry.
 */
export interface MetricsModuleOptions {
  http?: boolean | MetricsHttpOptions;
  path?: string;
  provider?: 'prometheus';
  defaultMetrics?: boolean;
  middleware?: MiddlewareLike[];
  platformTelemetry?: {
    env?: string;
    instance?: string;
  };
  /** External Prometheus registry to share between built-in and custom metrics. */
  registry?: Registry;
}

/** Module entry point that exposes `/metrics` and optional HTTP/runtime telemetry. */
export class MetricsModule {
  private static registeredRegistries = new WeakSet<Registry>();

  /**
   * Register framework metrics, optional HTTP middleware, and a scrape endpoint.
   *
   * @example
   * ```ts
   * MetricsModule.forRoot({
   *   http: { pathLabelMode: 'template' },
   *   registry: new Registry(),
   * });
   * ```
   *
   * @param options Metrics endpoint, registry, HTTP middleware, and runtime telemetry configuration.
   * @returns A runtime module that exposes metrics through the configured path.
   */
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
    const platformTelemetry = new RuntimePlatformTelemetry(
      registry,
      options.registry ? 'shared' : 'isolated',
      options.platformTelemetry,
    );

    if (options.defaultMetrics !== false && !MetricsModule.registeredRegistries.has(registry)) {
      MetricsModule.registeredRegistries.add(registry);
      collectDefaultMetrics({ register: registry });
    }

    const middleware = httpOptions
      ? [new HttpMetricsMiddleware(registry, httpOptions), ...(options.middleware ?? [])]
      : (options.middleware ?? []);

    const providers: Provider[] = [
      {
        provide: MetricsService,
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
        await platformTelemetry.refresh(ctx);
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

type RegistryMode = 'isolated' | 'shared';

const PLATFORM_COMPONENT_LABELS = ['component_id', 'component_kind', 'operation', 'result', 'env', 'instance'] as const;
const REGISTRY_MODE_LABELS = ['mode'] as const;

function toReadinessValue(status: PlatformShellSnapshot['readiness']['status']): number {
  return status === 'ready' ? 1 : 0;
}

function toHealthValue(status: PlatformShellSnapshot['health']['status']): number {
  return status === 'healthy' ? 1 : 0;
}

function getOrCreateGauge(
  registry: Registry,
  config: {
    help: string;
    labelNames: readonly string[];
    name: string;
  },
): Gauge<string> {
  const existing = registry.getSingleMetric(config.name);

  if (existing instanceof Gauge) {
    return existing;
  }

  return new Gauge({
    help: config.help,
    labelNames: [...config.labelNames],
    name: config.name,
    registers: [registry],
  });
}

class RuntimePlatformTelemetry {
  private readonly readinessGauge: Gauge<string>;
  private readonly healthGauge: Gauge<string>;
  private readonly registryModeGauge: Gauge<string>;

  constructor(
    registry: Registry,
    private readonly registryMode: RegistryMode,
    private readonly labels: MetricsModuleOptions['platformTelemetry'] = {},
  ) {
    this.readinessGauge = getOrCreateGauge(registry, {
      help: 'Runtime platform component readiness from shared platform snapshot semantics.',
      labelNames: PLATFORM_COMPONENT_LABELS,
      name: 'konekti_component_ready',
    });
    this.healthGauge = getOrCreateGauge(registry, {
      help: 'Runtime platform component health from shared platform snapshot semantics.',
      labelNames: PLATFORM_COMPONENT_LABELS,
      name: 'konekti_component_health',
    });
    this.registryModeGauge = getOrCreateGauge(registry, {
      help: 'Metrics module registry mode: isolated or shared.',
      labelNames: REGISTRY_MODE_LABELS,
      name: 'konekti_metrics_registry_mode',
    });
  }

  async refresh(ctx: RequestContext): Promise<void> {
    this.registryModeGauge.reset();
    this.registryModeGauge.labels(this.registryMode).set(1);

    const platformShell = await this.resolvePlatformShell(ctx);
    if (!platformShell) {
      return;
    }

    const snapshot = await platformShell.snapshot();
    const env = this.labels?.env ?? 'unknown';
    const instance = this.labels?.instance ?? 'local';

    this.readinessGauge.reset();
    this.healthGauge.reset();

    this.readinessGauge.labels('runtime.shell', 'runtime', 'readiness', snapshot.readiness.status, env, instance).set(
      toReadinessValue(snapshot.readiness.status),
    );
    this.healthGauge.labels('runtime.shell', 'runtime', 'health', snapshot.health.status, env, instance).set(
      toHealthValue(snapshot.health.status),
    );

    for (const component of snapshot.components) {
      this.readinessGauge
        .labels(component.id, component.kind, 'readiness', component.readiness.status, env, instance)
        .set(toReadinessValue(component.readiness.status));

      this.healthGauge
        .labels(component.id, component.kind, 'health', component.health.status, env, instance)
        .set(toHealthValue(component.health.status));
    }
  }

  private async resolvePlatformShell(ctx: RequestContext): Promise<{ snapshot(): Promise<PlatformShellSnapshot> } | undefined> {
    try {
      return await ctx.container.resolve(PLATFORM_SHELL);
    } catch {
      return undefined;
    }
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
