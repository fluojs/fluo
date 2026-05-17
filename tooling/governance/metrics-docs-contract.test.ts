import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = {
  bookEn: 'book/beginner/ch19-metrics.md',
  bookKo: 'book/beginner/ch19-metrics.ko.md',
  readmeEn: 'packages/metrics/README.md',
  readmeKo: 'packages/metrics/README.ko.md',
} as const;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('metrics documentation contract', () => {
  it('documents Prometheus content type and isolated registry ownership', () => {
    const docs = Object.values(files).map(read).join('\n');

    expect(docs).toContain('Prometheus content type');
    expect(docs).toContain('isolated registry');
    expect(docs).toContain('격리된 Registry');
    expect(docs).not.toMatch(/OpenMetrics|global default registry|글로벌 기본 레지스트리/);
  });

  it('keeps endpointMiddleware examples aligned with class-based middleware', () => {
    const docs = Object.values(files).map(read).join('\n');

    expect(docs).toContain('class MetricsTokenMiddleware');
    expect(docs).toContain('class-based');
    expect(docs).not.toContain('process.env.MONITORING_SECRET');
    expect(docs).not.toMatch(/endpointMiddleware:\s*\[\s*\(context, next\)/);
  });

  it('documents metrics public responsibility boundaries and module option wiring', () => {
    const docs = Object.values(files).map(read).join('\n');

    expect(docs).toContain('MetricsService');
    expect(docs).toContain('METER_PROVIDER');
    expect(docs).toContain('PrometheusMeterProvider');
    expect(docs).toContain('provider');
    expect(docs).toContain('defaultMetrics');
    expect(docs).toContain('path: false');
    expect(docs).toContain('module-level `middleware`');
    expect(docs).toContain('endpoint-scoped middleware');
    expect(docs).toContain('Route-scoped가 아니므로');
  });
});
