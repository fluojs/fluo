import { summarize } from '../report.js';

export const POLICY = {
  version: 1,
  issue: 3942,
  preflightSha256: '2db06833eb72bb88b7943ccc7bc8a234c9a95c0c9e6e226111cb50eceef20b1b',
  configuration: 'default',
  fixtures: ['plain-json', 'native-header-json', 'native-metadata-json', 'json-body-command', 'rest-route-mix'],
  timing: { connections: [16, 64], pairs: 8, warmupSeconds: 10, captureSeconds: 40, order: 'AB/BA' },
  headroom: { connections: 64, pairs: 3, workers: [1, 4], warmupSeconds: 3, captureSeconds: 10, maximumRatio: 1.02 },
  profile: { connections: 64, repeats: 2, modes: ['cpu', 'allocation'], warmupSeconds: 10, captureSeconds: 30, controlSeconds: 30 },
  stability: { maximumCv: 0.03, primaryRatio: [0.98, 1.02], secondaryRatio: [0.95, 1.05] },
  adoption: { minimumGain: 0.03, noiseMultiplier: 2, throughputLower: 0.98, cpuUpper: 1.02, latencyRssUpper: 1.05 },
  confidence: { level: 0.95, method: 'paired-log-ratio-student-t', tCriticalDf7: 2.364624251 },
  historical: { verdicts: ['NOT_ESTABLISHED', 'FAIL', 'INCONCLUSIVE'], rejectedStreamOnlyCpuRatio: 1.0508237154627784 },
} as const;

export const METRICS = ['throughput', 'cpuPerRequest', 'p95', 'p99', 'rss'] as const;
export type Metric = typeof METRICS[number];
export type Metrics = Readonly<Record<Metric, number>>;
export interface Pair {
  readonly a: Metrics;
  readonly b: Metrics;
}

export function interval(values: readonly number[], critical: number = POLICY.confidence.tCriticalDf7) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError('Paired ratios need finite positive samples');
  }
  const log = summarize(values.map(Math.log));
  const half = critical * (log.standardDeviation ?? 0) / Math.sqrt(values.length);
  return { ratio: Math.exp(log.mean), lower: Math.exp(log.mean - half), upper: Math.exp(log.mean + half) };
}

export function evaluate(pairs: readonly Pair[], mode: 'aa' | 'candidate', primary?: Metric, noiseBound?: number) {
  if (pairs.length !== POLICY.timing.pairs || pairs.some((pair) =>
    METRICS.some((metric) => !Number.isFinite(pair.a[metric]) || pair.a[metric] <= 0
      || !Number.isFinite(pair.b[metric]) || pair.b[metric] <= 0))) {
    return { status: 'INCONCLUSIVE' as const, reason: 'incomplete-or-invalid-pairs' };
  }
  const ratios = Object.fromEntries(METRICS.map((metric) =>
    [metric, interval(pairs.map((pair) => pair.b[metric] / pair.a[metric]))]));
  let noise = 0;
  for (const metric of METRICS) {
    const ratio = interval(pairs.map((pair) => pair.b[metric] / pair.a[metric]));
    if (mode === 'aa') {
      const limits = metric === 'throughput' || metric === 'cpuPerRequest'
        ? POLICY.stability.primaryRatio : POLICY.stability.secondaryRatio;
      if (ratio.lower < limits[0] || ratio.upper > limits[1]) {
        return { status: 'INCONCLUSIVE' as const, reason: `aa-ci:${metric}`, ratios };
      }
      if (metric === 'throughput' || metric === 'cpuPerRequest') {
        for (const side of ['a', 'b'] as const) {
          const stats = summarize(pairs.map((pair) => pair[side][metric]));
          if ((stats.standardDeviation ?? 0) / stats.mean > POLICY.stability.maximumCv) {
            return { status: 'INCONCLUSIVE' as const, reason: `aa-cv:${metric}:${side}`, ratios };
          }
        }
        noise = Math.max(noise, Math.abs(1 - ratio.lower), Math.abs(1 - ratio.upper));
      }
    } else if (metric === 'throughput' ? ratio.lower < POLICY.adoption.throughputLower
      : ratio.upper > (metric === 'cpuPerRequest' ? POLICY.adoption.cpuUpper : POLICY.adoption.latencyRssUpper)) {
      return { status: 'INCONCLUSIVE' as const, reason: `nonregression-not-proven:${metric}`, ratios };
    }
  }
  if (mode === 'aa') return { status: 'PASS' as const, ratios, noiseBound: noise };
  if (!primary || noiseBound === undefined || !Number.isFinite(noiseBound) || noiseBound < 0 || noiseBound > 0.02) {
    return { status: 'INCONCLUSIVE' as const, reason: 'missing-calibrated-primary', ratios };
  }
  const main = interval(pairs.map((pair) => pair.b[primary] / pair.a[primary]));
  const minimum = Math.max(POLICY.adoption.minimumGain, POLICY.adoption.noiseMultiplier * noiseBound);
  const gain = primary === 'throughput' ? main.ratio - 1 : 1 - main.ratio;
  const proven = primary === 'throughput' ? main.lower > 1 : main.upper < 1;
  return { status: gain >= minimum && proven ? 'PASS' as const : 'REJECT' as const, gain, minimum, ratios };
}

export function headroomGate(ratios: readonly number[], bottleneckExcluded: boolean) {
  if (!bottleneckExcluded || ratios.length !== POLICY.headroom.pairs) return 'INCONCLUSIVE';
  // df=2; a wide interval is not evidence of spare generator capacity.
  const result = interval(ratios, 4.30265273);
  return result.upper <= POLICY.headroom.maximumRatio ? 'PASS' : 'INCONCLUSIVE';
}
