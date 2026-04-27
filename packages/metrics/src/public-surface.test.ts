import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as metrics from './index.js';

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
});
