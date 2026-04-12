import type { FrameworkRequest, Middleware, MiddlewareContext, Next } from '@fluojs/http';
import type { Registry } from 'prom-client';

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
    if (options.pathLabelMode === 'raw' && options.allowUnsafeRawPathLabelMode !== true) {
      throw new Error(
        'HttpMetricsMiddleware pathLabelMode "raw" is disabled by default. Pass allowUnsafeRawPathLabelMode: true only when you have bounded path cardinality.',
      );
    }

    this.pathLabelMode = options.pathLabelMode ?? 'template';
    this.pathLabelNormalizer = options.pathLabelNormalizer;
    this.unknownPathLabel = options.unknownPathLabel ?? 'UNKNOWN';
    this.requestsTotal = createPrometheusCounter(registry, {
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
      name: 'http_requests_total',
    });
    this.errorsTotal = createPrometheusCounter(registry, {
      help: 'Total number of HTTP error responses (4xx/5xx)',
      labelNames: ['method', 'path', 'status'],
      name: 'http_errors_total',
    });
    this.requestDuration = createPrometheusHistogram(registry, {
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path', 'status'],
      name: 'http_request_duration_seconds',
    });
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
