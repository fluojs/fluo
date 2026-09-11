import { describe, expect, it } from 'vitest';

import { Test } from '@fluojs/testing';
import { MetricsService } from '@fluojs/metrics';
import { Registry } from '@fluojs/metrics/integration';

import { AppModule, opsMetricsBootstrapProviders } from './app';
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
  it('serves protected metrics and ops routes through Test.createApp request helpers', async () => {
    const app = await Test.createApp({ rootModule: AppModule, providers: opsMetricsBootstrapProviders });

    try {
      const forbiddenHealthResult = await app.request('GET', '/health').send();
      expect(forbiddenHealthResult.status).toBe(403);

      await expect(app.request('GET', '/health').header('x-health-token', 'secret-token').send()).resolves.toMatchObject({
        status: 200,
      });

      await expect(app.request('GET', '/ready').header('x-health-token', 'secret-token').send()).resolves.toMatchObject({
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

  it('reuses the shared custom counter across repeated app bootstraps', async () => {
    const firstApp = await Test.createApp({ rootModule: AppModule, providers: opsMetricsBootstrapProviders });
    let firstCounterValue: number;

    try {
      await expect(firstApp.request('GET', '/ops/jobs/trigger').send()).resolves.toMatchObject({
        status: 200,
      });

      const firstMetricsResult = await firstApp.request('GET', '/metrics').header('x-metrics-token', 'secret-token').send();
      const firstCounterMatch = String(firstMetricsResult.body).match(/example_ops_jobs_triggered_total (\d+)/);
      expect(firstMetricsResult.status).toBe(200);
      expect(firstCounterMatch).not.toBeNull();
      firstCounterValue = Number(firstCounterMatch?.[1]);
    } finally {
      await firstApp.close();
    }

    const secondApp = await Test.createApp({ rootModule: AppModule, providers: opsMetricsBootstrapProviders });

    try {
      await expect(secondApp.request('GET', '/ops/jobs/trigger').send()).resolves.toMatchObject({ status: 200 });

      const metricsResult = await secondApp.request('GET', '/metrics').header('x-metrics-token', 'secret-token').send();
      expect(metricsResult.status).toBe(200);
      expect(String(metricsResult.body)).toContain(`example_ops_jobs_triggered_total ${firstCounterValue + 1}`);
    } finally {
      await secondApp.close();
    }
  });
});
