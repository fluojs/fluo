import type { Middleware, MiddlewareContext, Next } from '@konekti/http';
import { Counter, Histogram, type Registry } from 'prom-client';

type HttpMetricLabels = {
  method: string;
  path: string;
  status: string;
};

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

  constructor(registry: Registry) {
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

  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    const start = performance.now();
    const method = context.request.method;
    const path = context.request.path;
    let requestError: unknown;

    try {
      await next();
    } catch (error) {
      requestError = error;
      throw error;
    } finally {
      const responseStatusCode = context.response.statusCode;
      const statusCode =
        responseStatusCode
        ?? (requestError
          ? (readErrorStatusCode(requestError) ?? 500)
          : 200);
      const status = String(statusCode);
      const durationSeconds = (performance.now() - start) / 1000;
      const labels: HttpMetricLabels = { method, path, status };

      this.requestsTotal.inc(labels);
      this.requestDuration.observe(labels, durationSeconds);

      if (statusCode >= 400 || requestError !== undefined) {
        this.errorsTotal.inc(labels);
      }
    }
  }
}
