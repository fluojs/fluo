import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, MiddlewareContext } from '@fluojs/http';
import { Counter, Histogram, Registry } from 'prom-client';

import { HttpMetricsMiddleware } from './http-metrics-middleware.js';

function createRequest(path: string, params: Readonly<Record<string, string>> = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params,
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('location', location);
      this.committed = true;
    },
    send(_body: unknown) {
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      const headers = this.headers as Record<string, string | string[]>;
      headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createContext(path: string, params: Readonly<Record<string, string>> = {}): MiddlewareContext {
  const request = createRequest(path, params);
  const response = createResponse();

  return {
    request,
    requestContext: {
      container: {} as MiddlewareContext['requestContext']['container'],
      metadata: {},
      request,
      response,
    },
    response,
  };
}

describe('HttpMetricsMiddleware', () => {
  it('normalizes path labels to param templates by default', async () => {
    const registry = new Registry();
    const middleware = new HttpMetricsMiddleware(registry);

    const context = createContext('/users/123/orders/88', {
      orderId: '88',
      userId: '123',
    });

    await middleware.handle(context, async () => {
      context.response.setStatus(200);
    });

    const metricsText = await registry.metrics();

    expect(metricsText).toContain('http_requests_total{method="GET",path="/users/:userId/orders/:orderId",status="200"} 1');
  });

  it('supports custom path label normalizers', async () => {
    const registry = new Registry();
    const middleware = new HttpMetricsMiddleware(registry, {
      pathLabelNormalizer: ({ path }) => (path.startsWith('/users/') ? '/users/:id' : '/other'),
    });

    const context = createContext('/users/abc-1', { id: 'abc-1' });

    await middleware.handle(context, async () => {
      context.response.setStatus(200);
    });

    const metricsText = await registry.metrics();

    expect(metricsText).toContain('http_requests_total{method="GET",path="/users/:id",status="200"} 1');
  });

  it('rejects raw path labels unless explicitly allowed', () => {
    const registry = new Registry();

    expect(() => {
      new HttpMetricsMiddleware(registry, {
        pathLabelMode: 'raw',
      });
    }).toThrow(
      'HttpMetricsMiddleware pathLabelMode "raw" is disabled by default. Pass allowUnsafeRawPathLabelMode: true only when you have bounded path cardinality.',
    );
  });

  it('allows raw path labels only behind an explicit unsafe opt-in', async () => {
    const registry = new Registry();
    const middleware = new HttpMetricsMiddleware(registry, {
      allowUnsafeRawPathLabelMode: true,
      pathLabelMode: 'raw',
    });

    const context = createContext('/users/123/orders/88', {
      orderId: '88',
      userId: '123',
    });

    await middleware.handle(context, async () => {
      context.response.setStatus(200);
    });

    const metricsText = await registry.metrics();

    expect(metricsText).toContain('http_requests_total{method="GET",path="/users/123/orders/88",status="200"} 1');
  });

  it('records non-throwing 4xx and 5xx responses as request errors', async () => {
    const registry = new Registry();
    const middleware = new HttpMetricsMiddleware(registry);

    const notFoundContext = createContext('/status/not-found');
    await middleware.handle(notFoundContext, async () => {
      notFoundContext.response.setStatus(404);
    });

    const unavailableContext = createContext('/status/unavailable');
    await middleware.handle(unavailableContext, async () => {
      unavailableContext.response.setStatus(503);
    });

    const metricsText = await registry.metrics();

    expect(metricsText).toContain('http_requests_total{method="GET",path="/status/not-found",status="404"} 1');
    expect(metricsText).toContain('http_requests_total{method="GET",path="/status/unavailable",status="503"} 1');
    expect(metricsText).toContain('http_errors_total{method="GET",path="/status/not-found",status="404"} 1');
    expect(metricsText).toContain('http_errors_total{method="GET",path="/status/unavailable",status="503"} 1');
  });

  it('does not reuse a param key when multiple params share the same value', async () => {
    const registry = new Registry();
    const middleware = new HttpMetricsMiddleware(registry);

    const context = createContext('/users/foo/orders/foo', {
      orderId: 'foo',
      userId: 'foo',
    });

    await middleware.handle(context, async () => {
      context.response.setStatus(200);
    });

    const metricsText = await registry.metrics();

    expect(metricsText).toContain('http_requests_total{method="GET",path="/users/:orderId/orders/:userId",status="200"} 1');
  });

  it('rejects application-owned built-in HTTP counter names', () => {
    const registry = new Registry();

    new Counter({
      help: 'Application-defined request count',
      name: 'http_requests_total',
      registers: [registry],
    });

    expect(() => new HttpMetricsMiddleware(registry)).toThrow(
      'Metric name "http_requests_total" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.',
    );
  });

  it('rejects application-owned built-in HTTP error counter names', () => {
    const registry = new Registry();

    new Counter({
      help: 'Application-defined error count',
      name: 'http_errors_total',
      registers: [registry],
    });

    expect(() => new HttpMetricsMiddleware(registry)).toThrow(
      'Metric name "http_errors_total" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.',
    );
  });

  it('rejects application-owned built-in HTTP duration histogram names', () => {
    const registry = new Registry();

    new Histogram({
      help: 'Application-defined request duration',
      name: 'http_request_duration_seconds',
      registers: [registry],
    });

    expect(() => new HttpMetricsMiddleware(registry)).toThrow(
      'Metric name "http_request_duration_seconds" is already registered by the application. Built-in HTTP metrics require framework-owned collectors.',
    );
  });

  it('passes immutable label snapshots to each metric recorder call', async () => {
    const registry = new Registry();
    const middleware = new HttpMetricsMiddleware(registry);

    const calls: Array<{ sink: 'duration' | 'errors' | 'requests'; labels: Record<string, string> }> = [];
    const requestsRecorder = {
      inc(labels: Record<string, string>) {
        labels.path = '/mutated-by-requests';
        calls.push({ labels: { ...labels }, sink: 'requests' });
      },
    };
    const durationRecorder = {
      observe(labels: Record<string, string>, _value: number) {
        calls.push({ labels: { ...labels }, sink: 'duration' });
      },
    };
    const errorsRecorder = {
      inc(labels: Record<string, string>) {
        calls.push({ labels: { ...labels }, sink: 'errors' });
      },
    };

    Reflect.set(middleware, 'requestsTotal', requestsRecorder);
    Reflect.set(middleware, 'requestDuration', durationRecorder);
    Reflect.set(middleware, 'errorsTotal', errorsRecorder);

    const context = createContext('/users/123', { id: '123' });

    await middleware.handle(context, async () => {
      context.response.setStatus(500);
    });

    expect(calls).toEqual([
      {
        labels: { method: 'GET', path: '/mutated-by-requests', status: '500' },
        sink: 'requests',
      },
      {
        labels: { method: 'GET', path: '/users/:id', status: '500' },
        sink: 'duration',
      },
      {
        labels: { method: 'GET', path: '/users/:id', status: '500' },
        sink: 'errors',
      },
    ]);
  });
});
