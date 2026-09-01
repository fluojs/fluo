import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Inject, type Token } from '@fluojs/core';
import { type Container, ContainerResolutionError, type Provider } from '@fluojs/di';
import { Controller, forRoutes, Get, type Middleware, type MiddlewareLike, type RequestContext } from '@fluojs/http';
import {
  defineModule,
  type ModuleType,
  type OnModuleDestroy,
  PLATFORM_SHELL,
  type PlatformShellSnapshot,
} from '@fluojs/runtime';
import { BOOTSTRAP_PROVIDER_TOKENS, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import { collectDefaultMetrics, Gauge, Registry as PrometheusRegistry, type Registry } from 'prom-client';

import {
  HttpMetricsMiddleware,
  type HttpMetricsMiddlewareOptions,
  type HttpMetricsPathLabelMode,
  type HttpMetricsPathLabelNormalizer,
} from './http-metrics-middleware.js';
import { MetricsService } from './metrics-service.js';
import { METER_PROVIDER } from './providers/meter-provider.js';
import { PrometheusMeterProvider } from './providers/prometheus-meter-provider.js';

/** HTTP-specific metric labeling options exposed by `MetricsModule.forRoot(...)`. */
export interface MetricsHttpOptions {
  /** Duration buckets in seconds for the built-in HTTP request histogram. */
  durationHistogramBuckets?: readonly number[];
  /** How request paths are converted into Prometheus label values. Defaults to route templates. */
  pathLabelMode?: HttpMetricsPathLabelMode;
  /** Custom path-label normalizer for bounded application-specific label values. */
  pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  /** Label value used when no normalized path can be derived. */
  unknownPathLabel?: string;
  /** Explicit opt-in required before raw URL paths may be used as labels. */
  allowUnsafeRawPathLabelMode?: boolean;
}

/**
 * Module options for exposing Prometheus metrics and runtime platform telemetry.
 */
export interface MetricsModuleOptions {
  /** Enables built-in HTTP request collectors when `true` or configured with path-label options. */
  http?: boolean | MetricsHttpOptions;
  /** Scrape endpoint path. Defaults to `/metrics`; `false` disables the scrape endpoint and endpoint-scoped middleware. */
  path?: string | false;
  /** Meter provider implementation. Currently only `prometheus` is supported. */
  provider?: 'prometheus';
  /** Whether Prometheus process and Node.js default collectors are registered once per registry. Defaults to `true`. */
  defaultMetrics?: boolean;
  /** Module-level middleware applied after framework HTTP metrics and endpoint-scoped middleware. */
  middleware?: MiddlewareLike[];
  /** Class-based middleware bound only to the configured scrape endpoint. Ignored when `path: false`. */
  endpointMiddleware?: Array<new (...args: any[]) => Middleware>;
  /** Fixed labels attached to built-in runtime platform telemetry gauges. */
  platformTelemetry?: {
    /** Deployment environment label value. Defaults to `unknown`. */
    env?: string;
    /** Instance label value. Defaults to `local`. */
    instance?: string;
  };
  /** Legacy shared-registry fallback. Prefer the `METRICS_REGISTRY` bootstrap provider. */
  registry?: Registry;
}

/** Bootstrap provider token for a Registry shared by metrics module instances. */
export const METRICS_REGISTRY: Token<Registry> = Symbol.for('fluo.metrics.registry');

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
   * });
   * ```
   *
   * @param options Metrics endpoint, HTTP middleware, and runtime telemetry configuration.
   * @returns A runtime module that exposes metrics through the configured path.
   */
  static forRoot(options: MetricsModuleOptions = {}): ModuleType {
    const provider = options.provider ?? 'prometheus';
    if (provider !== 'prometheus') {
      throw new Error(`MetricsModule provider "${provider}" is not supported. Use provider "prometheus".`);
    }

    const httpOptions = resolveHttpOptions(options.http);
    const metricsPath = options.path === undefined ? '/metrics' : options.path;

    const registryToken: Token<Registry> = Symbol('MetricsModule.registry');
    const platformTelemetryToken: Token<RuntimePlatformTelemetry> = Symbol('MetricsModule.platformTelemetry');
    const httpMetricsMiddleware = httpOptions
      ? createHttpMetricsMiddleware(registryToken, httpOptions)
      : undefined;

    const endpointMiddleware = typeof metricsPath === 'string'
      ? (options.endpointMiddleware ?? []).map((middlewareClass) => forRoutes(middlewareClass, metricsPath))
      : [];
    const middleware = [
      ...endpointMiddleware,
      ...(options.middleware ?? []),
    ];

    const registryProvider: Provider = {
      provide: registryToken,
      inject: [RUNTIME_CONTAINER, BOOTSTRAP_PROVIDER_TOKENS],
      useFactory: async (container: unknown, bootstrapProviderTokens: unknown) => {
        const runtimeContainer = assertRuntimeContainer(container);
        const configuredRegistry = assertBootstrapProviderTokens(bootstrapProviderTokens).has(METRICS_REGISTRY)
          ? assertPrometheusRegistry(await runtimeContainer.resolve(METRICS_REGISTRY))
          : undefined;

        return MetricsModule.createRegistry(options, configuredRegistry);
      },
    };
    const imports: ModuleType[] = [];
    const includeRuntimeRegistryProvider = httpMetricsMiddleware === undefined;

    if (httpOptions && httpMetricsMiddleware) {
      class MetricsHttpInstrumentationModule {}

      defineModule(MetricsHttpInstrumentationModule, {
        exports: [registryToken],
        global: true,
        middleware: [httpMetricsMiddleware],
        providers: [registryProvider, httpMetricsMiddleware],
      });

      imports.push(MetricsHttpInstrumentationModule);
    }

    const providers: Provider[] = [
      ...(includeRuntimeRegistryProvider ? [registryProvider] : []),
      {
        provide: MetricsService,
        inject: [registryToken, platformTelemetryToken],
        useFactory: (registry: unknown) => new MetricsService(assertPrometheusRegistry(registry)),
      },
      {
        provide: METER_PROVIDER,
        inject: [registryToken],
        useFactory: (registry: unknown) => new PrometheusMeterProvider(assertPrometheusRegistry(registry)),
      },
      {
        provide: platformTelemetryToken,
        inject: [registryToken, RUNTIME_CONTAINER, BOOTSTRAP_PROVIDER_TOKENS],
        useFactory: (registry: unknown, container: unknown, bootstrapProviderTokens: unknown) => new RuntimePlatformTelemetry(
          assertPrometheusRegistry(registry),
          assertRuntimeContainer(container),
          resolveRegistryMode(options, assertBootstrapProviderTokens(bootstrapProviderTokens)),
          options.platformTelemetry,
        ),
      },
    ];

    const controllers: ModuleType[] = [];

    if (typeof metricsPath === 'string') {
      const metricsRoutePath = metricsPath;

      @Inject(registryToken, platformTelemetryToken)
      @Controller('')
      class MetricsController {
        constructor(
          private readonly registry: Registry,
          private readonly platformTelemetry: RuntimePlatformTelemetry,
        ) {}

        @Get(metricsRoutePath)
        async getMetrics(_input: undefined, ctx: RequestContext): Promise<string> {
          ctx.response.setHeader('content-type', this.registry.contentType);
          return this.platformTelemetry.collectMetrics(this.registry);
        }
      }

      controllers.push(MetricsController);
    }

    class MetricsRuntimeModule {}

    defineModule(MetricsRuntimeModule, {
      controllers,
      exports: [MetricsService, METER_PROVIDER],
      imports,
      middleware,
      providers,
    });

    return MetricsRuntimeModule;
  }

  private static createRegistry(options: MetricsModuleOptions, configuredRegistry?: Registry): Registry {
    const registry = configuredRegistry ?? options.registry ?? new PrometheusRegistry();

    if (options.defaultMetrics !== false && !MetricsModule.registeredRegistries.has(registry)) {
      assertNoDefaultMetricCollisions(registry);

      const existingMetricNames = new Set(registry.getMetricsAsArray().map((metric) => metric.name));

      try {
        collectDefaultMetrics({ register: registry });
      } catch (error) {
        for (const metric of registry.getMetricsAsArray()) {
          if (!existingMetricNames.has(metric.name)) {
            registry.removeSingleMetric(metric.name);
          }
        }

        throw error;
      }

      MetricsModule.registeredRegistries.add(registry);
    }

    return registry;
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
type ComponentStatusMap<TStatus extends string> = Map<string, Map<string, Map<string, Map<string, TStatus>>>>;
type ComponentStatusEntry<TStatus extends string> = {
  env: string;
  instance: string;
  componentId: string;
  componentKind: string;
  status: TStatus;
};
type RuntimePlatformTelemetryRegistryState = {
  lastHealthStatuses: ComponentStatusMap<PlatformHealthStatus>;
  lastReadinessStatuses: ComponentStatusMap<PlatformReadinessStatus>;
  originalMetrics?: Registry['metrics'];
  registrations: RuntimePlatformTelemetry[];
  scrapeChain: Promise<unknown>;
};
type ContainerPresenceProbe = RequestContext['container'] & { has?: (token: Token) => boolean };

const PLATFORM_COMPONENT_LABELS = ['component_id', 'component_kind', 'operation', 'result', 'env', 'instance'] as const;
const REGISTRY_MODE_LABELS = ['mode'] as const;
const require = createRequire(import.meta.url);
// prom-client exposes collector IDs publicly but not their metric names. This v15.1.3-only
// private metadata seam keeps collision preflight side-effect-free; the exact package pin and
// runtime-support regression must be updated together before changing prom-client.
const DEFAULT_METRIC_COLLECTORS = collectDefaultMetrics.metricsList.map((collectorName) => {
  const collector: unknown = require(`prom-client/lib/metrics/${collectorName}`);

  if (!hasDefaultMetricNames(collector)) {
    throw new Error(`prom-client default collector "${collectorName}" does not expose metricNames.`);
  }

  return { collectorName, metricNames: collector.metricNames };
});
const FRAMEWORK_PLATFORM_GAUGES = new WeakSet<Gauge<string>>();
const PLATFORM_TELEMETRY_REGISTRY_STATES = new WeakMap<Registry, RuntimePlatformTelemetryRegistryState>();
const HTTP_INSTRUMENTATION_OWNERS = new WeakMap<Container, WeakSet<Registry>>();
const HEALTH_STATUSES = ['healthy', 'unhealthy', 'degraded'] as const satisfies readonly PlatformHealthStatus[];
const READINESS_STATUSES = ['ready', 'not-ready', 'degraded'] as const satisfies readonly PlatformReadinessStatus[];
const PLATFORM_SHELL_TOKEN_NAMES = new Set([String(PLATFORM_SHELL)]);

function createHttpMetricsMiddleware(
  registryToken: Token<Registry>,
  httpOptions: HttpMetricsMiddlewareOptions,
): new (registry: Registry, container: Container) => Middleware {
  @Inject(registryToken, RUNTIME_CONTAINER)
  class MetricsHttpMiddleware implements Middleware {
    private readonly delegate: HttpMetricsMiddleware | undefined;

    constructor(registry: Registry, container: unknown) {
      const httpMetricsMiddleware = new HttpMetricsMiddleware(registry, httpOptions);
      const runtimeContainer = assertRuntimeContainer(container);

      if (claimsHttpInstrumentationOwnership(runtimeContainer, registry)) {
        this.delegate = httpMetricsMiddleware;
      }
    }

    handle(context: Parameters<Middleware['handle']>[0], next: Parameters<Middleware['handle']>[1]): ReturnType<Middleware['handle']> {
      return this.delegate ? this.delegate.handle(context, next) : next();
    }
  }

  return MetricsHttpMiddleware;
}

function claimsHttpInstrumentationOwnership(container: Container, registry: Registry): boolean {
  let registryOwners = HTTP_INSTRUMENTATION_OWNERS.get(container);

  if (!registryOwners) {
    registryOwners = new WeakSet();
    HTTP_INSTRUMENTATION_OWNERS.set(container, registryOwners);
  }

  if (registryOwners.has(registry)) {
    return false;
  }

  registryOwners.add(registry);
  return true;
}

function assertPrometheusRegistry(value: unknown): Registry {
  if (!(value instanceof PrometheusRegistry)) {
    throw new Error('MetricsModule registry provider resolved an invalid Prometheus registry.');
  }

  return value;
}

function hasDefaultMetricNames(value: unknown): value is { metricNames: readonly string[] } {
  return typeof value === 'function'
    && 'metricNames' in value
    && Array.isArray(value.metricNames)
    && value.metricNames.every((metricName) => typeof metricName === 'string');
}

function assertNoDefaultMetricCollisions(registry: Registry): void {
  for (const { collectorName, metricNames } of DEFAULT_METRIC_COLLECTORS) {
    if (!isDefaultCollectorActive(collectorName)) {
      continue;
    }

    for (const metricName of metricNames) {
      if (registry.getSingleMetric(metricName)) {
        throw new Error(`A metric with the name ${metricName} has already been registered.`);
      }
    }
  }
}

function isDefaultCollectorActive(collectorName: string): boolean {
  if (collectorName === 'processHandles') {
    return typeof Reflect.get(process, '_getActiveHandles') === 'function';
  }

  if (collectorName === 'processRequests') {
    return typeof Reflect.get(process, '_getActiveRequests') === 'function';
  }

  if (collectorName === 'processOpenFileDescriptors') {
    return process.platform === 'linux';
  }

  if (collectorName === 'processMaxFileDescriptors') {
    try {
      return readFileSync('/proc/self/limits', 'utf8')
        .split('\n')
        .some((line) => line.startsWith('Max open files'));
    } catch {
      return false;
    }
  }

  return true;
}

function assertRuntimeContainer(value: unknown): Container {
  if (!isRuntimeContainer(value)) {
    throw new Error('MetricsModule runtime container provider resolved an invalid container.');
  }

  return value;
}

function assertBootstrapProviderTokens(value: unknown): ReadonlySet<Token> {
  if (!(value instanceof Set)) {
    throw new Error('MetricsModule bootstrap provider token metadata resolved invalidly.');
  }

  return value as ReadonlySet<Token>;
}

function resolveRegistryMode(options: MetricsModuleOptions, bootstrapProviderTokens: ReadonlySet<Token>): RegistryMode {
  return options.registry || bootstrapProviderTokens.has(METRICS_REGISTRY) ? 'shared' : 'isolated';
}

function isRuntimeContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null && 'resolve' in value && typeof value.resolve === 'function';
}

function getRuntimePlatformTelemetryRegistryState(registry: Registry): RuntimePlatformTelemetryRegistryState {
  const existing = PLATFORM_TELEMETRY_REGISTRY_STATES.get(registry);
  if (existing) {
    return existing;
  }

  const state: RuntimePlatformTelemetryRegistryState = {
    lastHealthStatuses: new Map(),
    lastReadinessStatuses: new Map(),
    registrations: [],
    scrapeChain: Promise.resolve(),
  };
  PLATFORM_TELEMETRY_REGISTRY_STATES.set(registry, state);
  return state;
}

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
    if (!FRAMEWORK_PLATFORM_GAUGES.has(existing)) {
      throw new Error(
        `Metric name "${config.name}" is already registered by the application. Built-in platform telemetry requires framework-owned gauges.`,
      );
    }

    assertGaugeLabelSchema(existing, config);
    return existing;
  }

  const gauge = new Gauge({
    help: config.help,
    labelNames: [...config.labelNames],
    name: config.name,
    registers: [registry],
  });
  FRAMEWORK_PLATFORM_GAUGES.add(gauge);
  return gauge;
}

function assertGaugeLabelSchema(
  gauge: Gauge<string>,
  config: {
    labelNames: readonly string[];
    name: string;
  },
): void {
  const registeredLabels = ((gauge as Gauge<string> & { labelNames?: string[] }).labelNames ?? []).join(',');
  const expectedLabels = config.labelNames.join(',');

  if (registeredLabels !== expectedLabels) {
    throw new Error(
      `Metric name "${config.name}" is already registered with labels [${registeredLabels}]. Built-in platform telemetry requires labels [${expectedLabels}].`,
    );
  }
}

class RuntimePlatformTelemetry implements OnModuleDestroy {
  private readonly readinessGauge: Gauge<string>;
  private readonly healthGauge: Gauge<string>;
  private readonly registryModeGauge: Gauge<string>;
  private readonly telemetryState: RuntimePlatformTelemetryRegistryState;

  constructor(
    private readonly registry: Registry,
    private readonly container: Container,
    private readonly registryMode: RegistryMode,
    private readonly labels: MetricsModuleOptions['platformTelemetry'] = {},
  ) {
    this.telemetryState = getRuntimePlatformTelemetryRegistryState(registry);
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
    this.installRegistryRefresh();
  }

  collectMetrics(registry: Registry): Promise<string> {
    return registry.metrics();
  }

  onModuleDestroy(): void {
    const registrationIndex = this.telemetryState.registrations.lastIndexOf(this);
    if (registrationIndex >= 0) {
      this.telemetryState.registrations.splice(registrationIndex, 1);
    }

    if (this.telemetryState.registrations.length > 0) {
      return;
    }

    const originalMetrics = this.telemetryState.originalMetrics;
    if (originalMetrics) {
      this.registry.metrics = originalMetrics;
      this.telemetryState.originalMetrics = undefined;
    }
  }

  private installRegistryRefresh(): void {
    this.telemetryState.registrations.push(this);
    if (this.telemetryState.originalMetrics) {
      return;
    }

    const registry = this.registry;
    const telemetryState = this.telemetryState;
    const originalMetrics = registry.metrics;
    telemetryState.originalMetrics = originalMetrics;
    registry.metrics = () => {
      const activeRegistration = telemetryState.registrations.at(-1);
      if (!activeRegistration) {
        return originalMetrics.call(registry);
      }

      return activeRegistration.collectScrape(() => originalMetrics.call(registry));
    };
  }

  private collectScrape(render: () => Promise<string>): Promise<string> {
    const scrape = this.telemetryState.scrapeChain.then(async () => {
      await this.refresh();
      return await render();
    });

    this.telemetryState.scrapeChain = scrape.then(
      () => undefined,
      () => undefined,
    );

    return scrape;
  }

  private async refresh(): Promise<void> {
    const platformShell = await this.resolvePlatformShell();
    if (!platformShell) {
      this.clearPlatformTelemetry();
      return;
    }

    const snapshot = await platformShell.snapshot();
    this.syncSnapshot(snapshot);
  }

  private syncSnapshot(snapshot: PlatformShellSnapshot): void {
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
      currentStatuses: this.toComponentStatusMap(components, env, instance, (component) => component.health),
      gauge: this.healthGauge,
      lastStatuses: this.telemetryState.lastHealthStatuses,
      operation: 'health',
      statuses: HEALTH_STATUSES,
      toMetricValue: toHealthValue,
    });
    this.syncGaugeStatuses({
      currentStatuses: this.toComponentStatusMap(components, env, instance, (component) => component.readiness),
      gauge: this.readinessGauge,
      lastStatuses: this.telemetryState.lastReadinessStatuses,
      operation: 'readiness',
      statuses: READINESS_STATUSES,
      toMetricValue: toReadinessValue,
    });
  }

  private clearPlatformTelemetry(): void {
    this.clearGaugeStatuses({
      gauge: this.healthGauge,
      lastStatuses: this.telemetryState.lastHealthStatuses,
      operation: 'health',
      statuses: HEALTH_STATUSES,
    });
    this.clearGaugeStatuses({
      gauge: this.readinessGauge,
      lastStatuses: this.telemetryState.lastReadinessStatuses,
      operation: 'readiness',
      statuses: READINESS_STATUSES,
    });
  }

  private clearGaugeStatuses<TStatus extends string>({
    gauge,
    lastStatuses,
    operation,
    statuses,
  }: {
    gauge: Gauge<string>;
    lastStatuses: ComponentStatusMap<TStatus>;
    operation: 'health' | 'readiness';
    statuses: readonly TStatus[];
  }): void {
    for (const { componentId, componentKind, env, instance } of this.componentStatusEntries(lastStatuses)) {
      for (const status of statuses) {
        gauge.remove(componentId, componentKind, operation, status, env, instance);
      }
    }

    lastStatuses.clear();
  }

  private syncGaugeStatuses<TStatus extends string>({
    currentStatuses,
    gauge,
    lastStatuses,
    operation,
    statuses,
    toMetricValue,
  }: {
    currentStatuses: ComponentStatusMap<TStatus>;
    gauge: Gauge<string>;
    lastStatuses: ComponentStatusMap<TStatus>;
    operation: 'health' | 'readiness';
    statuses: readonly TStatus[];
    toMetricValue(status: TStatus): number;
  }): void {
    for (const { componentId, componentKind, env, instance, status: previousStatus } of this.componentStatusEntries(lastStatuses)) {
      const nextStatus = this.getComponentStatus(currentStatuses, env, instance, componentId, componentKind);
      if (nextStatus === previousStatus) {
        continue;
      }

      for (const status of statuses) {
        if (status !== previousStatus) {
          continue;
        }

        gauge.remove(componentId, componentKind, operation, status, env, instance);
      }
    }

    for (const { componentId, componentKind, env, instance, status: currentStatus } of this.componentStatusEntries(currentStatuses)) {
      gauge.labels(componentId, componentKind, operation, currentStatus, env, instance).set(toMetricValue(currentStatus));
    }

    lastStatuses.clear();
    for (const { componentId, componentKind, env, instance, status: currentStatus } of this.componentStatusEntries(currentStatuses)) {
      this.setComponentStatus(lastStatuses, env, instance, componentId, componentKind, currentStatus);
    }
  }

  private toComponentStatusMap<TStatus extends string>(
    components: readonly RuntimeTelemetryComponent[],
    env: string,
    instance: string,
    getStatus: (component: RuntimeTelemetryComponent) => TStatus,
  ): ComponentStatusMap<TStatus> {
    const statuses: ComponentStatusMap<TStatus> = new Map();

    for (const component of components) {
      this.setComponentStatus(statuses, env, instance, component.id, component.kind, getStatus(component));
    }

    return statuses;
  }

  private setComponentStatus<TStatus extends string>(
    statuses: ComponentStatusMap<TStatus>,
    env: string,
    instance: string,
    componentId: string,
    componentKind: string,
    status: TStatus,
  ): void {
    let statusByInstance = statuses.get(env);
    if (!statusByInstance) {
      statusByInstance = new Map();
      statuses.set(env, statusByInstance);
    }

    let statusByComponent = statusByInstance.get(instance);
    if (!statusByComponent) {
      statusByComponent = new Map();
      statusByInstance.set(instance, statusByComponent);
    }

    let statusByKind = statusByComponent.get(componentId);
    if (!statusByKind) {
      statusByKind = new Map();
      statusByComponent.set(componentId, statusByKind);
    }

    statusByKind.set(componentKind, status);
  }

  private getComponentStatus<TStatus extends string>(
    statuses: ComponentStatusMap<TStatus>,
    env: string,
    instance: string,
    componentId: string,
    componentKind: string,
  ): TStatus | undefined {
    return statuses.get(env)?.get(instance)?.get(componentId)?.get(componentKind);
  }

  private *componentStatusEntries<TStatus extends string>(
    statuses: ComponentStatusMap<TStatus>,
  ): Iterable<ComponentStatusEntry<TStatus>> {
    for (const [env, statusByInstance] of statuses) {
      for (const [instance, statusByComponent] of statusByInstance) {
        for (const [componentId, statusByKind] of statusByComponent) {
          for (const [componentKind, status] of statusByKind) {
            yield { componentId, componentKind, env, instance, status };
          }
        }
      }
    }
  }

  private async resolvePlatformShell(): Promise<{ snapshot(): Promise<PlatformShellSnapshot> } | undefined> {
    const hasPlatformShell = hasContainerToken(this.container, PLATFORM_SHELL);
    if (hasPlatformShell === false) {
      return undefined;
    }

    try {
      return await this.container.resolve(PLATFORM_SHELL);
    } catch (error) {
      if (hasPlatformShell !== true && isMissingPlatformShellResolutionError(error)) {
        return undefined;
      }

      throw error;
    }
  }
}

function hasContainerToken(container: RequestContext['container'], token: Token): boolean | undefined {
  const has = (container as ContainerPresenceProbe).has;

  if (typeof has !== 'function') {
    return undefined;
  }

  return has.call(container, token);
}

function isMissingPlatformShellResolutionError(error: unknown): error is ContainerResolutionError {
  if (!(error instanceof ContainerResolutionError)) {
    return false;
  }

  const containerError = error as ContainerResolutionError & { meta?: Record<string, unknown> };
  const token = typeof containerError.meta?.token === 'string' ? containerError.meta.token : undefined;

  return token !== undefined && PLATFORM_SHELL_TOKEN_NAMES.has(token);
}

function resolveHttpOptions(http: MetricsModuleOptions['http']): HttpMetricsMiddlewareOptions | undefined {
  if (!http) {
    return undefined;
  }

  if (http === true) {
    return {};
  }

  if (http.pathLabelMode === 'raw' && http.allowUnsafeRawPathLabelMode !== true) {
    throw new Error(
      'HttpMetricsMiddleware pathLabelMode "raw" is disabled by default. Pass allowUnsafeRawPathLabelMode: true only when you have bounded path cardinality.',
    );
  }

  return {
    allowUnsafeRawPathLabelMode: http.allowUnsafeRawPathLabelMode,
    durationHistogramBuckets: http.durationHistogramBuckets,
    pathLabelMode: http.pathLabelMode,
    pathLabelNormalizer: http.pathLabelNormalizer,
    unknownPathLabel: http.unknownPathLabel,
  };
}
