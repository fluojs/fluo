import { describe, expect, it } from 'vitest';

import { createTestApp } from '@fluojs/testing';

import { AppModule } from './app';
import { OpsMetricsService } from './ops/ops-metrics.service';

describe('OpsMetricsService', () => {
  it('returns the trigger acknowledgement shape', () => {
    const service = new OpsMetricsService();

    expect(service.triggerJob()).toEqual({
      accepted: true,
      metric: 'example_ops_jobs_triggered_total',
    });
  });
});

describe('AppModule e2e', () => {
  it('serves health, ready, metrics, and ops routes through createTestApp request helpers', async () => {
    const app = await createTestApp({ rootModule: AppModule });

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

    const metricsResult = await app.request('GET', '/metrics').send();
    expect(metricsResult.status).toBe(200);
    expect(metricsResult.body).toContain('example_ops_jobs_triggered_total');
    expect(metricsResult.body).toContain('fluo_component_ready');

    await app.close();
  });
});
