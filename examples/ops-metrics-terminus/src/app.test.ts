import { describe, expect, it } from 'vitest';

import { createTestApp } from '@fluojs/testing';
import { MetricsService, Registry } from '@fluojs/metrics';

import { AppModule } from './app';
import { OpsMetricsService } from './ops/ops-metrics.service';

describe('OpsMetricsService', () => {
  it('returns the trigger acknowledgement shape', () => {
    const service = new OpsMetricsService(new MetricsService(new Registry()));

    expect(service.triggerJob()).toEqual({
      accepted: true,
      metric: 'example_ops_jobs_triggered_total',
    });
  });
});

describe('AppModule e2e', () => {
  it('serves protected metrics and ops routes through createTestApp request helpers', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    try {
      await expect(app.request('GET', '/health').send()).resolves.toMatchObject({
        status: 200,
      });

      await expect(app.request('GET', '/ready').send()).resolves.toMatchObject({
        status: 200,
      });

      const triggerResult = await app.request('GET', '/ops/jobs/trigger').send();
      expect(triggerResult.status).toBe(200);
      expect(triggerResult.body).toEqual({
        accepted: true,
        metric: 'example_ops_jobs_triggered_total',
      });

      const forbiddenMetricsResult = await app.request('GET', '/metrics').send();
      expect(forbiddenMetricsResult.status).toBe(403);

      const metricsResult = await app.request('GET', '/metrics').header('x-metrics-token', 'secret-token').send();
      expect(metricsResult.status).toBe(200);
      expect(metricsResult.body).toContain('example_ops_jobs_triggered_total');
      expect(metricsResult.body).toContain('fluo_component_ready');
      expect(metricsResult.body).toContain('http_requests_total{method="GET",path="/metrics",status="403"} 1');
      expect(metricsResult.body).toContain('http_errors_total{method="GET",path="/metrics",status="403"} 1');
    } finally {
      await app.close();
    }
  });
});
