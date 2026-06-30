import type { FrameworkRequest, Middleware, MiddlewareContext, Next } from '@fluojs/http';
import { Counter, Histogram, type Registry } from 'prom-client';

import { createPrometheusCounter, createPrometheusHistogram } from './providers/prometheus-metrics-factory.js';

type HttpMetricLabels = {
  method: string;
  path: string;
  status: string;
};

type MetricCounterLike = {
  inc(labels: Record<string, string>): void;
};

type MetricHistogramLike = {
  observe(labels: Record<string, string>, value: number): void;
};

type HttpMetricsCollectorConfiguration = {
  pathLabelMode: HttpMetricsPathLabelMode;
  pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  unknownPathLabel: string;
};

const FRAMEWORK_HTTP_COUNTERS = new WeakSet<Counter<string>>();
const FRAMEWORK_HTTP_HISTOGRAMS = new WeakSet<Histogram<string>>();
const FRAMEWORK_HTTP_COLLECTOR_CONFIGURATION = new WeakMap<Counter<string> | Histogram<string>, HttpMetricsCollectorConfiguration>();

/** Strategy used to label request paths in emitted HTTP metrics. */
export type HttpMetricsPathLabelMode = 'raw' | 'template';

/** Context passed to a custom path-label normalizer. */
export interface HttpMetricsPathLabelContext {
  method: string;
  params: Readonly<Record<string, string>>;
  path: string;
  request: FrameworkRequest;
}

/** Callback that resolves the final path label used in emitted metrics. */
export type HttpMetricsPathLabelNormalizer = (context: HttpMetricsPathLabelContext) => string;

/** Options that tune HTTP request metric label generation. */
export interface HttpMetricsMiddlewareOptions {
  pathLabelMode?: HttpMetricsPathLabelMode;
  pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  unknownPathLabel?: string;
  allowUnsafeRawPathLabelMode?: boolean;
}

function readErrorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  const fromStatus = typeof candidate.status === 'number' ? candidate.status : undefined;
  const fromStatusCode = typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined;

  if (fromStatus !== undefined && Number.isFinite(fromStatus)) {
    return fromStatus;
  }

  if (fromStatusCode !== undefined && Number.isFinite(fromStatusCode)) {
    return fromStatusCode;
  }

  return undefined;
}

/**
 * Middleware that records HTTP request totals, failures, and latency.
 */
export class HttpMetricsMiddleware implements Middleware {
  private readonly requestsTotal: MetricCounterLike;
  private readonly errorsTotal: MetricCounterLike;
  private readonly requestDuration: MetricHistogramLike;
  private readonly pathLabelMode: HttpMetricsPathLabelMode;
  private readonly pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  private readonly unknownPathLabel: string;

  constructor(registry: Registry, options: HttpMetricsMiddlewareOptions = {}) {
    const collectorConfiguration = resolveHttpMetricsCollectorConfiguration(options);

    this.pathLabelMode = collectorConfiguration.pathLabelMode;
    this.pathLabelNormalizer = collectorConfiguration.pathLabelNormalizer;
    this.unknownPathLabel = collectorConfiguration.unknownPathLabel;
    this.requestsTotal = getOrCreateHttpCounter(registry, {
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
      name: 'http_requests_total',
    }, collectorConfiguration);
    this.errorsTotal = getOrCreateHttpCounter(registry, {
      help: 'Total number of HTTP error responses (4xx/5xx)',
      labelNames: ['method', 'path', 'status'],
      name: 'http_errors_total',
    }, collectorConfiguration);
    this.requestDuration = getOrCreateHttpHistogram(registry, {
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path', 'status'],
      name: 'http_request_duration_seconds',
    }, collectorConfiguration);
  }

  private resolvePathLabel(request: FrameworkRequest): string {
    if (this.pathLabelNormalizer) {
      const normalized = this.pathLabelNormalizer({
        method: request.method,
        params: request.params,
        path: request.path,
        request,
      });
      return normalized.trim() || this.unknownPathLabel;
    }

    if (this.pathLabelMode === 'raw') {
      return request.path;
    }

    const normalized = normalizePathToTemplate(request.path, request.params);
    return normalized || this.unknownPathLabel;
  }

  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    const start = performance.now();
    const method = context.request.method;
    const path = this.resolvePathLabel(context.request);
    let requestError: unknown;

    try {
      await next();
    } catch (error) {
      requestError = error;
      throw error;
    } finally {
      const durationSeconds = (performance.now() - start) / 1000;

      this.recordRequestMetrics(method, path, this.resolveStatusCode(context.response.statusCode, requestError), durationSeconds, requestError);
    }
  }

  private resolveStatusCode(responseStatusCode: number | undefined, requestError: unknown): number {
    if (responseStatusCode !== undefined) {
      return responseStatusCode;
    }

    if (requestError === undefined) {
      return 200;
    }

    return readErrorStatusCode(requestError) ?? 500;
  }

  private recordRequestMetrics(
    method: string,
    path: string,
    statusCode: number,
    durationSeconds: number,
    requestError: unknown,
  ): void {
    const baseLabels: HttpMetricLabels = {
      method,
      path,
      status: String(statusCode),
    };
    const requestLabels: HttpMetricLabels = { ...baseLabels };
    const errorLabels = statusCode >= 400 || requestError !== undefined ? { ...baseLabels } : undefined;

    this.requestsTotal.inc(requestLabels);
    this.requestDuration.observe(baseLabels, durationSeconds);

    if (errorLabels) {
      this.errorsTotal.inc(errorLabels);
    }
  }
}

function getOrCreateHttpCounter(
  registry: Registry,
  config: {
    help: string;
    labelNames: readonly string[];
    name: string;
  },
  collectorConfiguration: HttpMetricsCollectorConfiguration,
): Counter<string> {
  const existing = registry.getSingleMetric(config.name);

  if (existing instanceof Counter) {
    if (!FRAMEWORK_HTTP_COUNTERS.has(existing)) {
      throw new Error(
        `Metric name "${config.name}" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.`,
      );
    }

    assertHttpMetricLabelSchema(existing, config);
    assertHttpMetricConfiguration(existing, config.name, collectorConfiguration);
    return existing;
  }

  const counter = createPrometheusCounter(registry, {
    help: config.help,
    labelNames: [...config.labelNames],
    name: config.name,
  });
  FRAMEWORK_HTTP_COUNTERS.add(counter);
  FRAMEWORK_HTTP_COLLECTOR_CONFIGURATION.set(counter, collectorConfiguration);
  return counter;
}

function getOrCreateHttpHistogram(
  registry: Registry,
  config: {
    help: string;
    labelNames: readonly string[];
    name: string;
  },
  collectorConfiguration: HttpMetricsCollectorConfiguration,
): Histogram<string> {
  const existing = registry.getSingleMetric(config.name);

  if (existing instanceof Histogram) {
    if (!FRAMEWORK_HTTP_HISTOGRAMS.has(existing)) {
      throw new Error(
        `Metric name "${config.name}" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.`,
      );
    }

    assertHttpMetricLabelSchema(existing, config);
    assertHttpMetricConfiguration(existing, config.name, collectorConfiguration);
    return existing;
  }

  const histogram = createPrometheusHistogram(registry, {
    help: config.help,
    labelNames: [...config.labelNames],
    name: config.name,
  });
  FRAMEWORK_HTTP_HISTOGRAMS.add(histogram);
  FRAMEWORK_HTTP_COLLECTOR_CONFIGURATION.set(histogram, collectorConfiguration);
  return histogram;
}

function assertHttpMetricLabelSchema(
  metric: Counter<string> | Histogram<string>,
  config: {
    labelNames: readonly string[];
    name: string;
  },
): void {
  const registeredLabels = ((metric as (Counter<string> | Histogram<string>) & { labelNames?: string[] }).labelNames ?? []).join(',');
  const expectedLabels = config.labelNames.join(',');

  if (registeredLabels !== expectedLabels) {
    throw new Error(
      `Metric name "${config.name}" is already registered with labels [${registeredLabels}]. Built-in HTTP metrics require labels [${expectedLabels}].`,
    );
  }
}

function resolveHttpMetricsCollectorConfiguration(options: HttpMetricsMiddlewareOptions): HttpMetricsCollectorConfiguration {
  if (options.pathLabelMode === 'raw' && options.allowUnsafeRawPathLabelMode !== true) {
    throw new Error(
      'HttpMetricsMiddleware pathLabelMode "raw" is disabled by default. Pass allowUnsafeRawPathLabelMode: true only when you have bounded path cardinality.',
    );
  }

  return {
    pathLabelMode: options.pathLabelMode ?? 'template',
    pathLabelNormalizer: options.pathLabelNormalizer,
    unknownPathLabel: options.unknownPathLabel ?? 'UNKNOWN',
  };
}

function assertHttpMetricConfiguration(
  metric: Counter<string> | Histogram<string>,
  metricName: string,
  expected: HttpMetricsCollectorConfiguration,
): void {
  const registered = FRAMEWORK_HTTP_COLLECTOR_CONFIGURATION.get(metric);

  if (!registered) {
    throw new Error(
      `Metric name "${metricName}" is already registered as a framework-owned HTTP collector without path-label configuration metadata. Built-in HTTP metrics require matching path-label configuration before reuse.`,
    );
  }

  if (hasSameHttpMetricConfiguration(registered, expected)) {
    return;
  }

  throw new Error(
    `Metric name "${metricName}" is already registered with framework HTTP path-label configuration ${describeHttpMetricConfiguration(registered)}. Built-in HTTP metrics require matching path-label configuration before reuse; received ${describeHttpMetricConfiguration(expected)}.`,
  );
}

function hasSameHttpMetricConfiguration(
  left: HttpMetricsCollectorConfiguration,
  right: HttpMetricsCollectorConfiguration,
): boolean {
  return left.pathLabelMode === right.pathLabelMode
    && left.pathLabelNormalizer === right.pathLabelNormalizer
    && left.unknownPathLabel === right.unknownPathLabel;
}

function describeHttpMetricConfiguration(configuration: HttpMetricsCollectorConfiguration): string {
  return `pathLabelMode="${configuration.pathLabelMode}", pathLabelNormalizer=${configuration.pathLabelNormalizer ? 'custom' : 'none'}, unknownPathLabel="${configuration.unknownPathLabel}"`;
}

function normalizePathToTemplate(path: string, params: Readonly<Record<string, string>>): string {
  if (!path) {
    return '/';
  }

  const normalizedSegments: string[] = [];
  const paramEntries = Object.entries(params);
  const usedParamKeys = new Set<string>();

  for (const segment of path.split('/')) {
    if (!segment) {
      continue;
    }

    const decoded = safeDecodeURIComponent(segment);
    let normalizedSegment = segment;

    for (const [paramKey, paramValue] of paramEntries) {
      if (usedParamKeys.has(paramKey)) {
        continue;
      }

      if (segment === paramValue || decoded === paramValue) {
        normalizedSegment = `:${paramKey}`;
        usedParamKeys.add(paramKey);
        break;
      }
    }

    normalizedSegments.push(normalizedSegment);
  }

  if (normalizedSegments.length === 0) {
    return '/';
  }

  return `/${normalizedSegments.join('/')}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
