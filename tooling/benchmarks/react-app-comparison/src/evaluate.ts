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
  readonly methodVersion?: string;
  readonly measurementPurpose?: string;
  readonly profile: string;
  readonly mode: Mode;
  readonly framework: Framework;
  readonly runId: string;
  readonly trace: string | null;
  readonly warmupRuns: number;
  readonly correctness: 'pass' | 'fail' | 'inconclusive';
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
     | 'noise' | 'outlier' | 'invalid-value' | 'insufficient-warmup' | 'measurement-quality';
  readonly observed?: number;
  readonly limit?: number;
  readonly range?: readonly [number, number];
  readonly peerRange?: readonly [number, number];
  readonly diagnostics?: { readonly median: number; readonly mad: number;
    readonly relativeSpread: number; readonly outlier: boolean };
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

export function evaluatePerformance(baseline: Baseline, runs: readonly MeasurementRun[],
  methodVersion: 'historical-v1' | 'FA-V2' | 'FA-V3' = 'historical-v1'): Evaluation {
  switch (methodVersion) {
    case 'FA-V2':
    case 'FA-V3': return evaluateObservedRanges(baseline, runs, methodVersion);
    case 'historical-v1': break;
    default: throw new InvalidBaselineError('unsupported method version');
  }
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
        if (sample.correctness === 'inconclusive') checks.push({ ...context, verdict: 'inconclusive', reason: 'measurement-quality' });
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
        const breach = metric === 'throughputRequestsPerSecond'
          ? comparison / measured > band : measured / comparison > band;
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

// Compare the canonical decimal observations exactly, including zero and
// decimal equality, without a floating multiplication or widened tolerance.
function compareProducts(left: readonly number[], right: readonly number[]): number {
  const product = (values: readonly number[]) => values.reduce((acc, value) => {
    const [digits = '', exponent = '0'] = String(value).split('e');
    const [whole = '', fraction = ''] = digits.split('.');
    return { coefficient: acc.coefficient * BigInt(whole + fraction),
      exponent: acc.exponent + Number(exponent) - fraction.length };
  }, { coefficient: 1n, exponent: 0 });
  const a = product(left);
  const b = product(right);
  const scale = Math.min(a.exponent, b.exponent);
  const delta = a.coefficient * 10n ** BigInt(a.exponent - scale)
    - b.coefficient * 10n ** BigInt(b.exponent - scale);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

/** FA-V2 decision stability over every observed sample; legacy replay is above. */
export function evaluateObservedRanges(baseline: Baseline, runs: readonly MeasurementRun[],
  methodVersion: 'FA-V2' | 'FA-V3' = 'FA-V2'): Evaluation {
  // Keep baseline validation identical to historical replay, without adopting
  // any of its median/noise verdicts.
  evaluatePerformance(baseline, []);
  const checks: EvaluationCheck[] = [];
  const { minimumRuns, warmupRuns, maximumRelativeSpread, outlierMadMultiplier } = baseline.policy;
  if (minimumRuns !== 5 || warmupRuns !== 2) throw new InvalidBaselineError('FA-V2 repetitions');
  for (const run of runs) {
    if (!Object.hasOwn(baseline.profiles, run.profile) || !FRAMEWORKS.includes(run.framework)) {
      checks.push({ profile: run.profile, mode: run.mode, framework: run.framework,
        verdict: 'inconclusive', reason: 'measurement-quality' });
    }
  }
  for (const [profile, config] of Object.entries(baseline.profiles)) {
    const ranges = new Map<Framework, Map<Metric, readonly [number, number]>>();
    for (const framework of FRAMEWORKS) {
      const context = { profile, mode: config.mode, framework };
      const samples = runs.filter((run) => run.profile === profile && run.framework === framework);
      const unique = new Set(samples.map((run) => run.runId)).size;
      let complete = samples.length === minimumRuns && unique === samples.length;
      if (!complete) checks.push({ ...context, verdict: 'inconclusive', reason: 'insufficient-runs' });
      for (const sample of samples) {
        if (sample.mode !== config.mode || sample.methodVersion !== methodVersion
          || sample.measurementPurpose !== (methodVersion === 'FA-V3' ? 'integrated' : 'timing')) {
          complete = false;
          checks.push({ ...context, verdict: 'inconclusive', reason: 'measurement-quality' });
        }
        if (!sample.trace?.trim()) {
          complete = false;
          checks.push({ ...context, verdict: 'inconclusive', reason: 'missing-trace' });
        }
        if (sample.correctness !== 'pass') {
          complete = false;
          checks.push({ ...context, verdict: sample.correctness === 'fail' ? 'fail' : 'inconclusive',
            reason: sample.correctness === 'fail' ? 'correctness-failure' : 'measurement-quality' });
        }
        if (sample.warmupRuns !== warmupRuns) {
          complete = false;
          checks.push({ ...context, verdict: 'inconclusive', reason: 'insufficient-warmup' });
        }
      }
      const summary = new Map<Metric, readonly [number, number]>();
      ranges.set(framework, summary);
      for (const metric of METRICS) {
        const values = samples.map((sample) => sample.metrics[metric]);
        if (values.some((value) => value === undefined || !Number.isFinite(value) || value < 0)) {
          checks.push({ ...context, metric, verdict: 'inconclusive',
            reason: values.includes(undefined) ? 'missing-metric' : 'invalid-value' });
          continue;
        }
        const numbers = values.filter((value): value is number => value !== undefined);
        if (!complete) continue;
        const lower = Math.min(...numbers);
        const upper = Math.max(...numbers);
        summary.set(metric, [lower, upper]);
        if (framework !== 'fluo') continue;
        const center = median(numbers);
        const mad = median(numbers.map((number) => Math.abs(number - center)));
        const relativeSpread = (upper - lower) / Math.max(1, center);
        const outlier = numbers.some((number) => Math.abs(number - center) > outlierMadMultiplier * mad
          && Math.abs(number - center) / Math.max(1, center) > maximumRelativeSpread);
        const limit = config.absoluteBudgets[metric];
        const throughput = metric === 'throughputRequestsPerSecond';
        const pass = throughput ? lower >= limit : upper <= limit;
        const fail = throughput ? upper < limit : lower > limit;
        checks.push({ ...context, metric, verdict: pass ? 'pass' : fail ? 'fail' : 'inconclusive',
          reason: pass ? 'within-budget' : 'absolute-budget', range: [lower, upper], limit,
          diagnostics: { median: center, mad, relativeSpread, outlier } });
      }
    }
    for (const framework of FRAMEWORKS) {
      if (framework === 'fluo') continue;
      for (const metric of METRICS) {
        const fluo = ranges.get('fluo')?.get(metric);
        const peer = ranges.get(framework)?.get(metric);
        const context = { profile, mode: config.mode, framework, metric };
        if (!fluo || !peer) {
          checks.push({ ...context, verdict: 'inconclusive', reason: 'missing-metric' });
          continue;
        }
        const band = config.relativeBands[metric];
        const throughput = metric === 'throughputRequestsPerSecond';
        const pass = throughput ? compareProducts([band, fluo[0]], [peer[1]]) >= 0
          : compareProducts([fluo[1]], [band, peer[0]]) <= 0;
        const fail = throughput ? compareProducts([band, fluo[1]], [peer[0]]) < 0
          : compareProducts([fluo[0]], [band, peer[1]]) > 0;
        checks.push({ ...context, verdict: pass ? 'pass' : fail ? 'fail' : 'inconclusive',
          reason: pass ? 'within-budget' : 'relative-band', range: fluo, peerRange: peer });
      }
    }
  }
  return { checks, verdict: checks.some((check) => check.verdict === 'fail') ? 'fail'
    : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass' };
}
