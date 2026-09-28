export const METRICS = [
  'coldTtfbMs', 'warmTtfbMs', 'shellArrivalMs', 'lcpMs', 'hydrationMainThreadMs',
  'interactionPendingP50Ms', 'interactionPendingP95Ms',
  'interactionApprovedP50Ms', 'interactionApprovedP95Ms',
  'transferredJsBytes', 'compressedJsBytes', 'transferredCssBytes', 'compressedCssBytes',
  'requestCount', 'throughputRequestsPerSecond', 'errorRate', 'cpuPercent', 'rssBytes',
  'devColdReadyMs', 'devReactEditVisibleMs', 'devCssEditVisibleMs', 'devServerEditVisibleMs',
] as const;
export type Metric = typeof METRICS[number];
export type Verdict = 'pass' | 'fail' | 'inconclusive';
export type Framework = 'fluo' | 'next' | 'react-router' | 'tanstack-start';
export type Mode = 'native' | 'matched-cache';
const FRAMEWORKS = ['fluo', 'next', 'react-router', 'tanstack-start'] as const;

export interface Baseline {
  readonly profiles: Readonly<Record<string, {
    readonly mode: Mode;
    readonly absoluteBudgets: Readonly<Record<Metric, number>>;
    readonly relativeBands: Readonly<Record<Metric, number>>;
  }>>;
  readonly policy: {
    readonly minimumRuns: number;
    readonly warmupRuns: number;
    readonly maximumRelativeSpread: number;
    readonly outlierMadMultiplier: number;
  };
}

export interface MeasurementRun {
  readonly profile: string;
  readonly mode: Mode;
  readonly framework: Framework;
  readonly runId: string;
  readonly trace: string | null;
  readonly warmupRuns: number;
  readonly correctness: 'pass' | 'fail';
  readonly metrics: Readonly<Partial<Record<Metric, number>>>;
}

export interface EvaluationCheck {
  readonly profile: string;
  readonly mode: Mode;
  readonly framework: Framework;
  readonly metric?: Metric;
  readonly verdict: Verdict;
  readonly reason: 'absolute-budget' | 'relative-band' | 'within-budget' | 'missing-metric'
    | 'missing-trace' | 'correctness-failure' | 'insufficient-runs' | 'missing-framework'
    | 'noise' | 'outlier' | 'invalid-value' | 'insufficient-warmup';
  readonly observed?: number;
  readonly limit?: number;
}

export interface Evaluation {
  readonly verdict: Verdict;
  readonly checks: readonly EvaluationCheck[];
}

export class InvalidBaselineError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`Invalid numeric benchmark baseline: ${field}`);
    this.name = 'InvalidBaselineError';
    this.field = field;
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new InvalidBaselineError('empty samples');
  if (sorted.length % 2 !== 0) return upper;
  const lower = sorted[middle - 1];
  if (lower === undefined) throw new InvalidBaselineError('empty samples');
  return (lower + upper) / 2;
}

export function evaluatePerformance(baseline: Baseline, runs: readonly MeasurementRun[]): Evaluation {
  const { minimumRuns, warmupRuns, maximumRelativeSpread, outlierMadMultiplier } = baseline.policy;
  if (!Number.isInteger(minimumRuns) || minimumRuns < 3) throw new InvalidBaselineError('minimumRuns');
  if (!Number.isInteger(warmupRuns) || warmupRuns < 0) throw new InvalidBaselineError('warmupRuns');
  if (!Number.isFinite(maximumRelativeSpread) || maximumRelativeSpread <= 0) throw new InvalidBaselineError('maximumRelativeSpread');
  if (!Number.isFinite(outlierMadMultiplier) || outlierMadMultiplier <= 0) throw new InvalidBaselineError('outlierMadMultiplier');
  if (Object.keys(baseline.profiles).length === 0) throw new InvalidBaselineError('profiles');

  const checks: EvaluationCheck[] = [];
  for (const [profile, config] of Object.entries(baseline.profiles)) {
    for (const metric of METRICS) {
      const absolute = config.absoluteBudgets[metric];
      const relative = config.relativeBands[metric];
      if (!Number.isFinite(absolute) || absolute < 0) throw new InvalidBaselineError(`${profile}.absoluteBudgets.${metric}`);
      if (!Number.isFinite(relative) || relative < 1) throw new InvalidBaselineError(`${profile}.relativeBands.${metric}`);
    }
    const matching = runs.filter((run) => run.profile === profile && run.mode === config.mode);
    const byFramework = new Map<Framework, Map<Metric, number>>();
    for (const framework of FRAMEWORKS) {
      const samples = matching.filter((run) => run.framework === framework);
      const context = { profile, mode: config.mode, framework };
      if (samples.length === 0) {
        checks.push({ ...context, verdict: 'inconclusive', reason: 'missing-framework' });
        continue;
      }
      if (new Set(samples.map((sample) => sample.runId)).size < minimumRuns || samples.length < minimumRuns) {
        checks.push({ ...context, verdict: 'inconclusive', reason: 'insufficient-runs' });
      }
      for (const sample of samples) {
        if (!sample.trace?.trim()) checks.push({ ...context, verdict: 'inconclusive', reason: 'missing-trace' });
        if (sample.correctness === 'fail') checks.push({ ...context, verdict: 'fail', reason: 'correctness-failure' });
        if (!Number.isInteger(sample.warmupRuns) || sample.warmupRuns < warmupRuns) {
          checks.push({ ...context, verdict: 'inconclusive', reason: 'insufficient-warmup' });
        }
      }
      const summaries = new Map<Metric, number>();
      byFramework.set(framework, summaries);
      for (const metric of METRICS) {
        const numbers: number[] = [];
        for (const sample of samples) {
          const value = sample.metrics[metric];
          if (value === undefined) {
            checks.push({ ...context, metric, verdict: 'inconclusive', reason: 'missing-metric' });
          } else if (!Number.isFinite(value) || value < 0) {
            checks.push({ ...context, metric, verdict: 'inconclusive', reason: 'invalid-value' });
          } else {
            numbers.push(value);
          }
        }
        if (numbers.length !== samples.length
          || new Set(samples.map((sample) => sample.runId)).size < minimumRuns
          || samples.length < minimumRuns
          || samples.some((sample) =>
            !sample.trace?.trim() || sample.correctness !== 'pass'
            || !Number.isInteger(sample.warmupRuns) || sample.warmupRuns < warmupRuns)) continue;
        const center = median(numbers);
        const deviation = median(numbers.map((number) => Math.abs(number - center)));
        const outlier = numbers.some((number) =>
          Math.abs(number - center) > outlierMadMultiplier * deviation
          && Math.abs(number - center) / Math.max(1, center) > maximumRelativeSpread);
        const spread = (Math.max(...numbers) - Math.min(...numbers)) / Math.max(1, center);
        if (outlier || spread > maximumRelativeSpread) {
          checks.push({ ...context, metric, verdict: 'inconclusive', reason: outlier ? 'outlier' : 'noise', observed: center });
          continue;
        }
        summaries.set(metric, center);
        if (framework !== 'fluo') continue;
        const limit = config.absoluteBudgets[metric];
        const breach = metric === 'throughputRequestsPerSecond' ? center < limit : center > limit;
        checks.push({ ...context, metric, verdict: breach ? 'fail' : 'pass',
          reason: breach ? 'absolute-budget' : 'within-budget', observed: center, limit });
      }
    }
    const fluo = byFramework.get('fluo');
    for (const framework of FRAMEWORKS) {
      if (framework === 'fluo') continue;
      const competitor = byFramework.get(framework);
      for (const metric of METRICS) {
        const measured = fluo?.get(metric);
        const comparison = competitor?.get(metric);
        if (measured === undefined || comparison === undefined) {
          checks.push({ profile, mode: config.mode, framework, metric, verdict: 'inconclusive', reason: 'missing-metric' });
          continue;
        }
        const band = config.relativeBands[metric];
        const limit = metric === 'throughputRequestsPerSecond' ? comparison / band : comparison * band;
        const breach = metric === 'throughputRequestsPerSecond' ? measured < limit : measured > limit;
        checks.push({ profile, mode: config.mode, framework, metric, verdict: breach ? 'fail' : 'pass',
          reason: breach ? 'relative-band' : 'within-budget', observed: measured, limit });
      }
    }
  }
  return {
    verdict: checks.some((check) => check.verdict === 'fail') ? 'fail'
      : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass',
    checks,
  };
}
