import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Baseline, evaluatePerformance, type MeasurementRun, type Metric } from '../src/evaluate.ts';

const values = {
  coldTtfbMs: 80,
  warmTtfbMs: 80,
  shellArrivalMs: 80,
  lcpMs: 80,
  hydrationMainThreadMs: 80,
  interactionPendingP50Ms: 80,
  interactionPendingP95Ms: 80,
  interactionApprovedP50Ms: 80,
  interactionApprovedP95Ms: 80,
  transferredJsBytes: 80,
  compressedJsBytes: 80,
  transferredCssBytes: 80,
  compressedCssBytes: 80,
  requestCount: 80,
  throughputRequestsPerSecond: 120,
  errorRate: 0,
  cpuPercent: 80,
  rssBytes: 80,
  devColdReadyMs: 80,
  devReactEditVisibleMs: 80,
  devCssEditVisibleMs: 80,
  devServerEditVisibleMs: 80,
} satisfies Record<Metric, number>;

const absoluteBudgets = {
  ...Object.fromEntries(Object.keys(values).map((key) => [key, 100])),
  errorRate: 0,
} as Record<Metric, number>;
const relativeBands = Object.fromEntries(Object.keys(values).map((key) => [key, 1.25])) as Record<Metric, number>;
const baseline: Baseline = {
  profiles: { desktop: { mode: 'matched-cache', absoluteBudgets, relativeBands } },
  policy: { minimumRuns: 3, warmupRuns: 1, maximumRelativeSpread: 0.1, outlierMadMultiplier: 3 },
};
const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'] as const;

function runs(): MeasurementRun[] {
  return frameworks.flatMap((framework) =>
    [1, 2, 3].map((index) => ({
      profile: 'desktop',
      mode: 'matched-cache' as const,
      framework,
      runId: `${framework}-${index}`,
      trace: `/traces/${framework}-${index}.json`,
      warmupRuns: 1,
      correctness: 'pass' as const,
      metrics: { ...values },
    })),
  );
}

test('passes when every required metric is complete and within both budgets', () => {
  // Given: three independently identified complete runs for every framework.
  const samples = runs();
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'pass');
  assert.equal(result.checks.filter((check) => check.verdict !== 'pass').length, 0);
});

test('fails an intentional absolute over-budget fixture without ignoring other metrics', () => {
  // Given: stable runs with a cold TTFB above the absolute limit.
  const samples = runs().map((run) => run.framework === 'fluo'
    ? { ...run, metrics: { ...run.metrics, coldTtfbMs: 130 } }
    : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'fail');
  assert.ok(result.checks.some((check) =>
    check.metric === 'coldTtfbMs' && check.reason === 'absolute-budget' && check.verdict === 'fail'));
});

test('fails a stable relative regression even below its absolute budget', () => {
  // Given: the Fluo sample is below 100 but more than 1.25x slower than peers.
  const samples = runs().map((run) => run.framework === 'fluo'
    ? { ...run, metrics: { ...run.metrics, warmTtfbMs: 99 } }
    : { ...run, metrics: { ...run.metrics, warmTtfbMs: 60 } });
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'fail');
  assert.ok(result.checks.some((check) =>
    check.metric === 'warmTtfbMs' && check.reason === 'relative-band' && check.verdict === 'fail'));
});

test('accepts the exact decimal relative boundary without multiplication rounding failure', () => {
  // Given: the observed Linux CPU boundary is 0.9 against 0.6 with a 1.5 band.
  const configured: Baseline = { ...baseline, profiles: { desktop: {
    mode: 'matched-cache', absoluteBudgets, relativeBands: { ...relativeBands, cpuPercent: 1.5 },
  } } };
  const samples = runs().map((run) => ({
    ...run, metrics: { ...run.metrics, cpuPercent: run.framework === 'fluo' ? 0.9 : 0.6 },
  }));
  // When / Then: equality passes; the configured band is not widened.
  assert.equal(evaluatePerformance(configured, samples).verdict, 'pass');
});

test('rejects an actual decimal relative breach immediately above the boundary', () => {
  const configured: Baseline = { ...baseline, profiles: { desktop: {
    mode: 'matched-cache', absoluteBudgets, relativeBands: { ...relativeBands, cpuPercent: 1.5 },
  } } };
  const samples = runs().map((run) => ({
    ...run, metrics: { ...run.metrics, cpuPercent: run.framework === 'fluo' ? 0.9000001 : 0.6 },
  }));
  assert.ok(evaluatePerformance(configured, samples).checks.some((check) =>
    check.metric === 'cpuPercent' && check.reason === 'relative-band' && check.verdict === 'fail'));
});

test('fails a confirmed throughput shortfall with higher-is-better comparison', () => {
  // Given: three stable Fluo runs slower than the 100 req/s minimum.
  const samples = runs().map((run) => run.framework === 'fluo'
    ? { ...run, metrics: { ...run.metrics, throughputRequestsPerSecond: 70 } }
    : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'fail');
  assert.ok(result.checks.some((check) =>
    check.metric === 'throughputRequestsPerSecond' && check.reason === 'absolute-budget'));
});

test('never passes a missing metric or trace', () => {
  // Given: one Fluo run has neither a CSS metric nor its raw trace.
  const samples = runs();
  const first = samples[0];
  assert.ok(first);
  const { compressedCssBytes: _missing, ...metrics } = first.metrics;
  samples[0] = { ...first, trace: null, metrics };
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.reason === 'missing-trace'));
  assert.ok(result.checks.some((check) => check.metric === 'compressedCssBytes' && check.reason === 'missing-metric'));
});

test('does not confirm an over-budget timing without its raw trace', () => {
  // Given: an otherwise stable breach has no trace for one independent run.
  const samples = runs().map((run) => run.framework === 'fluo'
    ? { ...run, trace: run.runId.endsWith('-3') ? null : run.trace, metrics: { ...run.metrics, coldTtfbMs: 130 } }
    : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.reason === 'missing-trace'));
  assert.ok(!result.checks.some((check) => check.metric === 'coldTtfbMs' && check.verdict === 'fail'));
});

test('fails correctness even if all measured timings pass', () => {
  // Given: a benchmark run failed its application correctness assertion.
  const samples = runs();
  const first = samples[0];
  assert.ok(first);
  samples[0] = { ...first, correctness: 'fail' };
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'fail');
  assert.ok(result.checks.some((check) => check.reason === 'correctness-failure'));
});

test('classifies a captured response failure as inconclusive even when other metrics pass', () => {
  const samples = runs();
  const first = samples[0];
  assert.ok(first);
  samples[0] = { ...first, correctness: 'inconclusive' };
  const result = evaluatePerformance(baseline, samples);
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.reason === 'measurement-quality'));
});

test('reports single-run and noisy timing breaches as inconclusive, not pass or fail', () => {
  // Given: one high reading and two low readings exceed the noise threshold.
  const samples = runs().map((run) => run.framework === 'fluo'
    ? { ...run, metrics: { ...run.metrics, lcpMs: run.runId.endsWith('-3') ? 140 : 80 } }
    : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.metric === 'lcpMs' && check.reason === 'outlier'));
  assert.ok(!result.checks.some((check) => check.metric === 'lcpMs' && check.verdict === 'fail'));
});

test('requires independent run identities and all four comparison frameworks', () => {
  // Given: a duplicated run cannot substitute for a third independent run.
  const samples = runs().filter((run) => run.framework !== 'tanstack-start')
    .map((run) => run.runId === 'fluo-3' ? { ...run, runId: 'fluo-2' } : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.reason === 'insufficient-runs'));
  assert.ok(result.checks.some((check) => check.reason === 'missing-framework'));
});

test('requires configured warmup evidence before accepting measured runs', () => {
  // Given: one Fluo run reports fewer warmups than the machine baseline.
  const samples = runs().map((run) => run.runId === 'fluo-1' ? { ...run, warmupRuns: 0 } : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.reason === 'insufficient-warmup'));
});

test('small ordinary jitter inside the noise band remains a passing measurement', () => {
  // Given: a minor difference from two identical readings is not a meaningful outlier.
  const samples = runs().map((run) => run.runId === 'fluo-3'
    ? { ...run, metrics: { ...run.metrics, lcpMs: 81 } } : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'pass');
});

test('broad sample spread without an isolated outlier remains inconclusive', () => {
  // Given: spread exceeds the noise band without breaching the MAD outlier threshold.
  const samples = runs().map((run) => run.framework === 'fluo'
    ? { ...run, metrics: { ...run.metrics, lcpMs: run.runId.endsWith('-1') ? 80 : run.runId.endsWith('-2') ? 88 : 92 } }
    : run);
  // When
  const result = evaluatePerformance(baseline, samples);
  // Then
  assert.equal(result.verdict, 'inconclusive');
  assert.ok(result.checks.some((check) => check.metric === 'lcpMs' && check.reason === 'noise'));
});

test('rejects incomplete or nonnumeric machine budgets instead of silently passing', () => {
  // Given: a baseline lacks the required shell budget.
  const desktop = baseline.profiles.desktop;
  assert.ok(desktop);
  const invalid: Baseline = {
    ...baseline,
    profiles: { desktop: { ...desktop, absoluteBudgets: { ...absoluteBudgets, shellArrivalMs: Number.NaN } } },
  };
  // When / Then
  assert.throws(() => evaluatePerformance(invalid, runs()), /shellArrivalMs/);
});
