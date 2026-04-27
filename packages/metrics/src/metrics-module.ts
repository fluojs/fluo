import { ContainerResolutionError, type Provider } from '@fluojs/di';
import { Controller, Get, forRoutes, type Middleware, type MiddlewareLike, type RequestContext } from '@fluojs/http';
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
  allowUnsafeRawPathLabelMode?: boolean;
}

/**
 * Module options for exposing Prometheus metrics and runtime platform telemetry.
 */
export interface MetricsModuleOptions {
  http?: boolean | MetricsHttpOptions;
  path?: string | false;
  provider?: 'prometheus';
  defaultMetrics?: boolean;
  middleware?: MiddlewareLike[];
  endpointMiddleware?: Array<new (...args: any[]) => Middleware>;
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
    const metricsPath = options.path === undefined ? '/metrics' : options.path;
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

    const endpointMiddleware = metricsPath
      ? (options.endpointMiddleware ?? []).map((middlewareClass) => forRoutes(middlewareClass, metricsPath))
      : [];
    const middleware = [
      ...endpointMiddleware,
      ...(httpOptions ? [new HttpMetricsMiddleware(registry, httpOptions)] : []),
      ...(options.middleware ?? []),
    ];

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

    const controllers: Array<new () => object> = [];

    if (typeof metricsPath === 'string') {
      const metricsRoutePath = metricsPath;

      @Controller('')
      class MetricsController {
        @Get(metricsRoutePath)
        async getMetrics(_input: undefined, ctx: RequestContext): Promise<string> {
          ctx.response.setHeader('content-type', registry.contentType);
          return platformTelemetry.collectMetrics(ctx, registry);
        }
      }

      controllers.push(MetricsController);
    }

    class MetricsRuntimeModule {}

    defineModule(MetricsRuntimeModule, {
      controllers,
      middleware,
      providers,
    });

    return MetricsRuntimeModule;
  }
}

type RegistryMode = 'isolated' | 'shared';
type PlatformHealthStatus = PlatformShellSnapshot['health']['status'];
type PlatformReadinessStatus = PlatformShellSnapshot['readiness']['status'];
type RuntimeTelemetryComponent = {
  id: string;
  kind: string;
  health: PlatformHealthStatus;
  readiness: PlatformReadinessStatus;
};

const PLATFORM_COMPONENT_LABELS = ['component_id', 'component_kind', 'operation', 'result', 'env', 'instance'] as const;
const REGISTRY_MODE_LABELS = ['mode'] as const;
const HEALTH_STATUSES = ['healthy', 'unhealthy', 'degraded'] as const satisfies readonly PlatformHealthStatus[];
const READINESS_STATUSES = ['ready', 'not-ready', 'degraded'] as const satisfies readonly PlatformReadinessStatus[];
const PLATFORM_SHELL_TOKEN_NAME = 'PLATFORM_SHELL';
const PLATFORM_SHELL_TOKEN_NAMES = new Set([PLATFORM_SHELL_TOKEN_NAME, String(PLATFORM_SHELL)]);

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
  private readonly lastHealthStatuses = new Map<string, PlatformHealthStatus>();
  private readonly lastReadinessStatuses = new Map<string, PlatformReadinessStatus>();
  private scrapeChain: Promise<unknown> = Promise.resolve();

  constructor(
    registry: Registry,
    private readonly registryMode: RegistryMode,
    private readonly labels: MetricsModuleOptions['platformTelemetry'] = {},
  ) {
    this.readinessGauge = getOrCreateGauge(registry, {
      help: 'Runtime platform component readiness from shared platform snapshot semantics.',
      labelNames: PLATFORM_COMPONENT_LABELS,
      name: 'fluo_component_ready',
    });
    this.healthGauge = getOrCreateGauge(registry, {
      help: 'Runtime platform component health from shared platform snapshot semantics.',
      labelNames: PLATFORM_COMPONENT_LABELS,
      name: 'fluo_component_health',
    });
    this.registryModeGauge = getOrCreateGauge(registry, {
      help: 'Metrics module registry mode: isolated or shared.',
      labelNames: REGISTRY_MODE_LABELS,
      name: 'fluo_metrics_registry_mode',
    });

    this.registryModeGauge.labels(this.registryMode).set(1);
  }

  async collectMetrics(ctx: RequestContext, registry: Registry): Promise<string> {
    const collect = this.scrapeChain.then(async () => {
      await this.refresh(ctx);
      return registry.metrics();
    });

    this.scrapeChain = collect.then(
      () => undefined,
      () => undefined,
    );

    return collect;
  }

  async refresh(ctx: RequestContext): Promise<void> {
    const platformShell = await this.resolvePlatformShell(ctx);
    if (!platformShell) {
      this.clearPlatformTelemetry();
      return;
    }

    const snapshot = await platformShell.snapshot();
    const env = this.labels?.env ?? 'unknown';
    const instance = this.labels?.instance ?? 'local';

    const components: RuntimeTelemetryComponent[] = [
      {
        health: snapshot.health.status,
        id: 'runtime.shell',
        kind: 'runtime',
        readiness: snapshot.readiness.status,
      },
      ...snapshot.components.map((component: PlatformShellSnapshot['components'][number]) => ({
        health: component.health.status,
        id: component.id,
        kind: component.kind,
        readiness: component.readiness.status,
      })),
    ];

    this.syncGaugeStatuses({
      currentStatuses: new Map(components.map((component) => [this.toComponentKey(component.id, component.kind), component.health])),
      env,
      gauge: this.healthGauge,
      instance,
      lastStatuses: this.lastHealthStatuses,
      operation: 'health',
      statuses: HEALTH_STATUSES,
      toMetricValue: toHealthValue,
    });
    this.syncGaugeStatuses({
      currentStatuses: new Map(components.map((component) => [this.toComponentKey(component.id, component.kind), component.readiness])),
      env,
      gauge: this.readinessGauge,
      instance,
      lastStatuses: this.lastReadinessStatuses,
      operation: 'readiness',
      statuses: READINESS_STATUSES,
      toMetricValue: toReadinessValue,
    });
  }

  private clearPlatformTelemetry(): void {
    this.clearGaugeStatuses({
      env: this.labels?.env ?? 'unknown',
      gauge: this.healthGauge,
      instance: this.labels?.instance ?? 'local',
      lastStatuses: this.lastHealthStatuses,
      operation: 'health',
      statuses: HEALTH_STATUSES,
    });
    this.clearGaugeStatuses({
      env: this.labels?.env ?? 'unknown',
      gauge: this.readinessGauge,
      instance: this.labels?.instance ?? 'local',
      lastStatuses: this.lastReadinessStatuses,
      operation: 'readiness',
      statuses: READINESS_STATUSES,
    });
  }

  private clearGaugeStatuses<TStatus extends string>({
    env,
    gauge,
    instance,
    lastStatuses,
    operation,
    statuses,
  }: {
    env: string;
    gauge: Gauge<string>;
    instance: string;
    lastStatuses: Map<string, TStatus>;
    operation: 'health' | 'readiness';
    statuses: readonly TStatus[];
  }): void {
    for (const componentKey of lastStatuses.keys()) {
      const [componentId, componentKind] = this.fromComponentKey(componentKey);

      for (const status of statuses) {
        gauge.remove(componentId, componentKind, operation, status, env, instance);
      }
    }

    lastStatuses.clear();
  }

  private syncGaugeStatuses<TStatus extends string>({
    currentStatuses,
    env,
    gauge,
    instance,
    lastStatuses,
    operation,
    statuses,
    toMetricValue,
  }: {
    currentStatuses: Map<string, TStatus>;
    env: string;
    gauge: Gauge<string>;
    instance: string;
    lastStatuses: Map<string, TStatus>;
    operation: 'health' | 'readiness';
    statuses: readonly TStatus[];
    toMetricValue(status: TStatus): number;
  }): void {
    for (const [componentKey, previousStatus] of lastStatuses) {
      const nextStatus = currentStatuses.get(componentKey);
      if (nextStatus === previousStatus) {
        continue;
      }

      const [componentId, componentKind] = this.fromComponentKey(componentKey);
      for (const status of statuses) {
        if (status !== previousStatus) {
          continue;
        }

        gauge.remove(componentId, componentKind, operation, status, env, instance);
      }
    }

    for (const [componentKey, currentStatus] of currentStatuses) {
      const [componentId, componentKind] = this.fromComponentKey(componentKey);
      gauge.labels(componentId, componentKind, operation, currentStatus, env, instance).set(toMetricValue(currentStatus));
    }

    lastStatuses.clear();
    for (const [componentKey, currentStatus] of currentStatuses) {
      lastStatuses.set(componentKey, currentStatus);
    }
  }

  private fromComponentKey(componentKey: string): [string, string] {
    const separatorIndex = componentKey.indexOf('::');
    return [componentKey.slice(0, separatorIndex), componentKey.slice(separatorIndex + 2)];
  }

  private toComponentKey(componentId: string, componentKind: string): string {
    return `${componentId}::${componentKind}`;
  }

  private async resolvePlatformShell(ctx: RequestContext): Promise<{ snapshot(): Promise<PlatformShellSnapshot> } | undefined> {
    try {
      return await ctx.container.resolve(PLATFORM_SHELL);
    } catch (error) {
      if (isMissingPlatformShellResolutionError(error)) {
        return undefined;
      }

      throw error;
    }
  }
}

function isMissingPlatformShellResolutionError(error: unknown): error is ContainerResolutionError {
  if (!(error instanceof ContainerResolutionError)) {
    return false;
  }

  const containerError = error as ContainerResolutionError & { meta?: Record<string, unknown> };
  const token = typeof containerError.meta?.['token'] === 'string' ? containerError.meta['token'] : undefined;
  if (token && PLATFORM_SHELL_TOKEN_NAMES.has(token)) {
    return containerError.message.startsWith(`No provider registered for token ${token}.`);
  }

  for (const tokenName of PLATFORM_SHELL_TOKEN_NAMES) {
    if (containerError.message.startsWith(`No provider registered for token ${tokenName}.`)) {
      return true;
    }
  }

  return false;
}

function resolveHttpOptions(http: MetricsModuleOptions['http']): HttpMetricsMiddlewareOptions | undefined {
  if (!http) {
    return undefined;
  }

  if (http === true) {
    return {};
  }

  return {
    allowUnsafeRawPathLabelMode: http.allowUnsafeRawPathLabelMode,
    pathLabelMode: http.pathLabelMode,
    pathLabelNormalizer: http.pathLabelNormalizer,
    unknownPathLabel: http.unknownPathLabel,
  };
}
