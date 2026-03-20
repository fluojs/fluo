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
    setHeader(name: string, value: string) {
      this.headers[name] = value;
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
});
