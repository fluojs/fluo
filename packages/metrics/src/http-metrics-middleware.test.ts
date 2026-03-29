import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, MiddlewareContext } from '@konekti/http';
import { Registry } from 'prom-client';

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

    expect(metricsText).toContain('http_requests_total{method="GET",path="/users/:userId/orders/:orderId",status="200"} 1');
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
