import { ForbiddenException } from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
import { createTestApp } from '@fluojs/testing';
import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';

import { MetricsModule } from './metrics-module.js';

describe('MetricsModule request contract', () => {
  it('serves the default Prometheus scrape response through the request helper', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false })],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      // Given: the metrics module exposes its default scrape endpoint.

      // When: a consumer requests the endpoint through the canonical test app surface.
      const response = await app.request('GET', '/metrics').send();

      // Then: the response preserves the documented Prometheus HTTP contract.
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe(Registry.PROMETHEUS_CONTENT_TYPE);
      expect(response.body).toEqual(expect.stringContaining('fluo_metrics_registry_mode{mode="isolated"} 1'));
    } finally {
      await app.close();
    }
  });

  it('returns not found through the request helper when the scrape endpoint is disabled', async () => {
    class AppModule {}

    defineModule(AppModule, {
      imports: [MetricsModule.forRoot({ defaultMetrics: false, path: false })],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      // Given: the metrics module disables its scrape endpoint explicitly.

      // When: a consumer requests the default metrics path.
      const response = await app.request('GET', '/metrics').send();

      // Then: the real request pipeline reports the route as missing.
      expect(response.status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('records endpoint middleware failures from request helper dispatch', async () => {
    class RejectMetricsRequestMiddleware {
      async handle(): Promise<void> {
        throw new ForbiddenException('Metrics scrape rejected.');
      }
    }

    const registry = new Registry();

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        MetricsModule.forRoot({
          defaultMetrics: false,
          endpointMiddleware: [RejectMetricsRequestMiddleware],
          http: true,
          registry,
        }),
      ],
    });

    const app = await createTestApp({ rootModule: AppModule });

    try {
      // Given: HTTP instrumentation observes a protected metrics endpoint.

      // When: endpoint middleware rejects a request through the canonical helper.
      const response = await app.request('GET', '/metrics').send();

      // Then: the request failure remains observable in both HTTP collectors.
      const metricsText = await registry.metrics();
      expect(response.status).toBe(403);
      expect(metricsText).toContain('http_requests_total{method="GET",path="/metrics",status="403"} 1');
      expect(metricsText).toContain('http_errors_total{method="GET",path="/metrics",status="403"} 1');
    } finally {
      await app.close();
    }
  });
});
