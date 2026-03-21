import type { FrameworkRequest, Middleware, MiddlewareContext, Next } from '@konekti/http';
import { Counter, Histogram, type Registry } from 'prom-client';

type HttpMetricLabels = {
  method: string;
  path: string;
  status: string;
};

export type HttpMetricsPathLabelMode = 'raw' | 'template';

export interface HttpMetricsPathLabelContext {
  method: string;
  params: Readonly<Record<string, string>>;
  path: string;
  request: FrameworkRequest;
}

export type HttpMetricsPathLabelNormalizer = (context: HttpMetricsPathLabelContext) => string;

export interface HttpMetricsMiddlewareOptions {
  pathLabelMode?: HttpMetricsPathLabelMode;
  pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  unknownPathLabel?: string;
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

export class HttpMetricsMiddleware implements Middleware {
  private readonly requestsTotal: Counter<string>;
  private readonly errorsTotal: Counter<string>;
  private readonly requestDuration: Histogram<string>;
  private readonly pathLabelMode: HttpMetricsPathLabelMode;
  private readonly pathLabelNormalizer?: HttpMetricsPathLabelNormalizer;
  private readonly unknownPathLabel: string;

  constructor(registry: Registry, options: HttpMetricsMiddlewareOptions = {}) {
    this.pathLabelMode = options.pathLabelMode ?? 'template';
    this.pathLabelNormalizer = options.pathLabelNormalizer;
    this.unknownPathLabel = options.unknownPathLabel ?? 'UNKNOWN';
    this.requestsTotal = new Counter({
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
      name: 'http_requests_total',
      registers: [registry],
    });
    this.errorsTotal = new Counter({
      help: 'Total number of HTTP error responses (4xx/5xx)',
      labelNames: ['method', 'path', 'status'],
      name: 'http_errors_total',
      registers: [registry],
    });
    this.requestDuration = new Histogram({
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path', 'status'],
      name: 'http_request_duration_seconds',
      registers: [registry],
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
    const labels: HttpMetricLabels = {
      method,
      path,
      status: String(statusCode),
    };

    this.requestsTotal.inc(labels);
    this.requestDuration.observe(labels, durationSeconds);

    if (statusCode >= 400 || requestError !== undefined) {
      this.errorsTotal.inc(labels);
    }
  }
}

function normalizePathToTemplate(path: string, params: Readonly<Record<string, string>>): string {
  if (!path) {
    return '/';
  }

  const normalizedSegments = path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const decoded = safeDecodeURIComponent(segment);
      for (const [paramKey, paramValue] of Object.entries(params)) {
        if (segment === paramValue || decoded === paramValue) {
          return `:${paramKey}`;
        }
      }

      return segment;
    });

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
