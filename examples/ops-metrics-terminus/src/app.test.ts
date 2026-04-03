import { describe, expect, it } from 'vitest';

import { createTestApp } from '@konekti/testing';
import { KonektiFactory } from '@konekti/runtime';
import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';

import { AppModule } from './app';
import { OpsMetricsService } from './ops/ops-metrics.service';

function createRequest(method: FrameworkRequest['method'], path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

describe('OpsMetricsService', () => {
  it('returns the trigger acknowledgement shape', () => {
    const service = new OpsMetricsService();

    expect(service.triggerJob()).toEqual({
      accepted: true,
      metric: 'example_ops_jobs_triggered_total',
    });
  });
});

describe('AppModule integration', () => {
  it('dispatches /health, /ready, and the ops trigger route', async () => {
    const app = await KonektiFactory.create(AppModule, {});

    const healthRes = createResponse();
    await app.dispatch(createRequest('GET', '/health'), healthRes);
    expect(healthRes.statusCode).toBe(200);

    const readyRes = createResponse();
    await app.dispatch(createRequest('GET', '/ready'), readyRes);
    expect(readyRes.statusCode).toBe(200);

    const triggerRes = createResponse();
    await app.dispatch(createRequest('GET', '/ops/jobs/trigger'), triggerRes);
    expect(triggerRes.body).toEqual({
      accepted: true,
      metric: 'example_ops_jobs_triggered_total',
    });

    const metricsRes = createResponse();
    await app.dispatch(createRequest('GET', '/metrics'), metricsRes);
    expect(metricsRes.body).toContain('example_ops_jobs_triggered_total');

    await app.close();
  });
});

describe('AppModule e2e', () => {
  it('serves health, ready, metrics, and ops routes through createTestApp', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.dispatch({ method: 'GET', path: '/health' })).resolves.toMatchObject({
      status: 200,
    });

    const triggerResult = await app.dispatch({ method: 'GET', path: '/ops/jobs/trigger' });
    expect(triggerResult.status).toBe(200);
    expect(triggerResult.body).toEqual({
      accepted: true,
      metric: 'example_ops_jobs_triggered_total',
    });

    const metricsResult = await app.dispatch({ method: 'GET', path: '/metrics' });
    expect(metricsResult.status).toBe(200);
    expect(metricsResult.body).toContain('example_ops_jobs_triggered_total');
    expect(metricsResult.body).toContain('konekti_component_ready');

    await app.close();
  });
});
