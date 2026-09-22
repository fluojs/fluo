import { defineModule, FluoFactory, type ModuleType } from '@fluojs/runtime';
import { type HealthCheckReport, type HealthIndicator, type HealthIndicatorResult, TerminusHealthService, TerminusModule } from '@fluojs/terminus';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/terminus guide evidence: /health aggregation semantics (200 vs 503,
 * contributors, details), the binary /ready admission contract, the
 * readiness opt-out, the indicator timeout guardrail, and per-indicator
 * overlap protection - deferred promises instead of sleeps, apps closed in
 * finally.
 */

function upIndicator(key: string): HealthIndicator {
  return {
    key,
    async check(): Promise<HealthIndicatorResult> {
      return { [key]: { status: 'up' } };
    },
  };
}

function downIndicator(key: string, message: string): HealthIndicator {
  return {
    key,
    async check(): Promise<HealthIndicatorResult> {
      return { [key]: { message, status: 'down' } };
    },
  };
}

/** Indicator whose check() signals start-up and waits on a manual promise. */
function gatedIndicator(key: string): {
  indicator: HealthIndicator;
  settle: (result: 'up' | 'down') => void;
  started: Promise<void>;
} {
  let settleFn: ((result: 'up' | 'down') => void) | undefined;
  let startedFn: (() => void) | undefined;
  const gate = new Promise<'up' | 'down'>((resolve) => {
    settleFn = resolve;
  });
  const started = new Promise<void>((resolve) => {
    startedFn = resolve;
  });

  return {
    indicator: {
      key,
      async check(): Promise<HealthIndicatorResult> {
        startedFn?.();
        const result = await gate;
        return { [key]: { status: result } };
      },
    },
    settle: (result) => {
      settleFn?.(result);
    },
    started,
  };
}

async function withApp<T>(module: ModuleType, run: (app: Awaited<ReturnType<typeof Test.createApp>>) => Promise<T>): Promise<T> {
  const app = await Test.createApp({ rootModule: module });
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

describe('@fluojs/terminus guide examples', () => {
  it('returns a 200 aggregated report and an admitting /ready when every indicator is up', async () => {
    class HealthyAppModule {}

    await withApp(
      defineModule(HealthyAppModule, {
        imports: [TerminusModule.forRoot({ indicators: [upIndicator('app-state')] })],
      }),
      async (app) => {
        const health = await app.request('GET', '/health').send();
        expect(health.status).toBe(200);
        expect(health.body).toMatchObject({
          contributors: { down: [], up: ['app-state'] },
          status: 'ok',
        });

        const ready = await app.request('GET', '/ready').send();
        expect(ready.status).toBe(200);
        expect(ready.body).toEqual({ status: 'ready' });
      },
    );
  });

  it('returns 503 with diagnostics on /health and removes the instance from rotation on /ready', async () => {
    class DegradedAppModule {}

    await withApp(
      defineModule(DegradedAppModule, {
        imports: [
          TerminusModule.forRoot({
            indicators: [upIndicator('cache'), downIndicator('database', 'connection refused')],
          }),
        ],
      }),
      async (app) => {
        const health = await app.request('GET', '/health').send();
        const report = health.body as HealthCheckReport;
        expect(health.status).toBe(503);
        expect(report).toMatchObject({
          contributors: { down: ['database'], up: ['cache'] },
          status: 'error',
        });
        expect(report.error.database).toMatchObject({ message: 'connection refused', status: 'down' });

        const ready = await app.request('GET', '/ready').send();
        expect(ready.status).toBe(503);
        expect(ready.body).toEqual({ status: 'unavailable' });
      },
    );
  });

  it('keeps readiness: false indicators visible in /health without blocking /ready', async () => {
    class NonGatingAppModule {}

    await withApp(
      defineModule(NonGatingAppModule, {
        imports: [
          TerminusModule.forRoot({
            indicators: [
              { ...downIndicator('search', 'search cluster unreachable'), readiness: false },
              upIndicator('app-state'),
            ],
          }),
        ],
      }),
      async (app) => {
        const health = await app.request('GET', '/health').send();
        const report = health.body as HealthCheckReport;
        expect(health.status).toBe(503);
        expect(report.contributors.down).toContain('search');

        const ready = await app.request('GET', '/ready').send();
        expect(ready.status).toBe(200);
        expect(ready.body).toEqual({ status: 'ready' });
      },
    );
  });

  it('marks a probe that exceeds execution.indicatorTimeoutMs as down instead of hanging', async () => {
    const gated = gatedIndicator('slow-dependency');

    class TimeoutAppModule {}

    await withApp(
      defineModule(TimeoutAppModule, {
        imports: [
          TerminusModule.forRoot({
            execution: { indicatorTimeoutMs: 20 },
            indicators: [gated.indicator],
          }),
        ],
      }),
      async (app) => {
        try {
          const health = await app.request('GET', '/health').send();
          const report = health.body as HealthCheckReport;

          expect(health.status).toBe(503);
          expect(report.contributors.down).toContain('slow-dependency');
        } finally {
          gated.settle('up');
        }
      },
    );
  });

  it('reports a still-running probe as down for concurrent requests instead of overlapping', async () => {
    const gated = gatedIndicator('slow-dependency');

    class OverlapAppModule {}

    await withApp(
      defineModule(OverlapAppModule, {
        imports: [TerminusModule.forRoot({ indicators: [gated.indicator] })],
      }),
      async (app) => {
        const first = app.request('GET', '/health').send();
        // Event barrier: the first probe is observably in flight before the
        // second request arrives.
        await gated.started;
        const second = app.request('GET', '/health').send();

        // The first request holds the in-flight probe; the second must not
        // start an overlapping one against the same dependency.
        const secondResponse = await second;
        const secondReport = secondResponse.body as HealthCheckReport;
        expect(secondResponse.status).toBe(503);
        expect(secondReport.contributors.down).toContain('slow-dependency');

        gated.settle('up');
        const firstResponse = await first;
        const firstReport = firstResponse.body as HealthCheckReport;
        expect(firstResponse.status).toBe(200);
        expect(firstReport.contributors.up).toContain('slow-dependency');
      },
    );
  });

  it('exposes the aggregated report through TerminusHealthService for direct callers', async () => {
    class DirectAppModule {}

    const context = await FluoFactory.createApplicationContext(
      defineModule(DirectAppModule, {
        imports: [TerminusModule.forRoot({ indicators: [upIndicator('app-state')] })],
      }),
    );
    try {
      const healthService = await context.get(TerminusHealthService);

      const report = await healthService.check();
      expect(report.status).toBe('ok');
      expect(report.details['app-state']).toEqual({ status: 'up' });
      expect(report.info['app-state']).toEqual({ status: 'up' });
      expect(await healthService.isHealthy()).toBe(true);
      expect(await healthService.isReady()).toBe(true);
    } finally {
      await context.close();
    }
  });
});
