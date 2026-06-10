import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as metrics from './index.js';
import { MetricsService, Registry } from './index.js';
import type { MeterCounter, MeterGauge, MeterHistogram, MeterProvider } from './index.js';

describe('@fluojs/metrics public surface', () => {
  it('keeps the documented metrics barrel public while hiding package-only wiring details', () => {
    expect(metrics).toHaveProperty('MetricsModule');
    expect(metrics).toHaveProperty('MetricsService');
    expect(metrics).toHaveProperty('METER_PROVIDER');
    expect(metrics).toHaveProperty('PrometheusMeterProvider');
    expect(metrics).toHaveProperty('HttpMetricsMiddleware');
    expect(metrics).toHaveProperty('Registry');
    expect(metrics).not.toHaveProperty('RuntimePlatformTelemetry');
    expect(metrics).not.toHaveProperty('createMetricsModule');
  });

  it('keeps the published package surface aligned with emitted dist artifacts', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, { import: string; types: string }>;
      files: string[];
      main: string;
      types: string;
    };

    expect(packageJson.exports).toMatchObject({
      '.': {
        import: './dist/index.js',
        types: './dist/index.d.ts',
      },
    });
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.files).toEqual(['dist']);
  });

  it('keeps the documented MetricsService registry accessor public', () => {
    const registry = new Registry();
    const service = new MetricsService(registry);

    expect(service.getRegistry()).toBe(registry);
  });

  it('keeps the documented meter abstraction types assignable from package integrations', () => {
    const counter: MeterCounter = { inc: () => undefined };
    const gauge: MeterGauge = { set: () => undefined };
    const histogram: MeterHistogram = { observe: () => undefined };
    const provider: MeterProvider = {
      type: 'test-provider',
      createCounter: () => counter,
      createGauge: () => gauge,
      createHistogram: () => histogram,
    };

    expect(provider.createCounter('jobs_total', 'Total jobs')).toBe(counter);
    expect(provider.createGauge('queue_depth', 'Queue depth')).toBe(gauge);
    expect(provider.createHistogram('job_duration_seconds', 'Job duration')).toBe(histogram);
  });
});
