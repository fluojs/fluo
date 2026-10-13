import { isDeepStrictEqual } from 'node:util';
import { object, sha256 } from '../profile-report';
import { FIXTURE_MANIFEST } from './fixtures';

export const DESIGN = {
  version: 1,
  issue: 3939,
  preflightSha256: '59bd0578c5701d29210ee000812732034981284b578d0b4abee296d89c9ad6ba',
  fixtures: FIXTURE_MANIFEST,
  configurations: ['default', 'equivalent'],
  connections: [1, 64],
  primary: { fixture: 'json-large', configuration: 'default', connections: 64 },
  warmupSeconds: 10,
  measurementSeconds: 40,
  pairedRepeats: 5,
  pairOrder: [['A1', 'A2'], ['A2', 'A1'], ['A1', 'A2'], ['A2', 'A1'], ['A1', 'A2']],
  profile: { modes: ['cpu', 'allocation'], repeats: 3, warmupSeconds: 10, captureSeconds: 30, controlSeconds: 30 },
  headroom: { workers: [1, 4], connections: 64, repeats: 3, warmupSeconds: 3, durationSeconds: 10, maxThroughputGain: 0.03 },
  calibration: { maxMeanDifference: { throughput: 0.03, cpuPerRequest: 0.03, p95: 0.05, p99: 0.05, rss: 0.05 }, maxArmCv: 0.03 },
  adoption: { minimumPrimaryCpuReduction: 0.05, confidence: 0.95, pairedStudentT4: 2.7764451051977987 },
  regression: { throughput: 0.03, cpuPerRequest: 0.03, p95: 0.05, p99: 0.05, rss: 0.05 },
  minimumCompletedRequests: 20_000,
  maximumCpuQuantizationFraction: 0.01,
  automaticAdditionalRepeats: 0,
  outlierDeletionAllowed: false,
  candidates: 1,
} as const;

export const DESIGN_SHA256 = sha256(JSON.stringify(DESIGN));

export class ExperimentInputFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentInputFailure';
  }
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim() || /^(unknown|unobserved|placeholder)$/i.test(value)) {
    throw new ExperimentInputFailure(`Observed identity required: ${field}`);
  }
  return value;
}

export function parseHostIdentities(value: unknown) {
  const input = object(value);
  const parseHost = (value: unknown): Record<string, string> => {
    const host = object(value);
    return Object.fromEntries([
      'hostname', 'os', 'arch', 'nodeExecutable', 'nodeVersion', 'nodeExecutableSha256',
      'power', 'network', 'resourceLimits', 'backgroundWorkload',
    ].map((field) => [field, requiredString(host, field)]));
  };
  const server = parseHost(input.server);
  const generator: Record<string, string> = { ...parseHost(input.generator),
    lockfileSha256: requiredString(object(input.generator), 'lockfileSha256'),
    clientEntrySha256: requiredString(object(input.generator), 'clientEntrySha256') };
  for (const host of [server, generator]) {
    if (!/^v?24\.\d+\.\d+$/.test(host.nodeVersion) || !/^[a-f0-9]{64}$/.test(host.nodeExecutableSha256)) {
      throw new ExperimentInputFailure('Node 24 runtime identity and executable hash required');
    }
  }
  if (server.hostname === generator.hostname || !/^[a-f0-9]{64}$/.test(generator.lockfileSha256)
    || !/^[a-f0-9]{64}$/.test(generator.clientEntrySha256)) {
    throw new ExperimentInputFailure('Independent generator and observed generator lockfile required');
  }
  return {
    server, generator,
    bindHost: requiredString(input, 'bindHost'),
    serverHost: requiredString(input, 'serverHost'),
    sshHost: requiredString(input, 'sshHost'),
    remoteDirectory: requiredString(input, 'remoteDirectory'),
  };
}

export function assertFrozenDesign(value: unknown): void {
  const input = object(value);
  if (input.designSha256 !== DESIGN_SHA256 || !isDeepStrictEqual(input.design, DESIGN)) {
    throw new ExperimentInputFailure('Frozen experiment design or fixture identity changed');
  }
}

export type Metrics = {
  readonly throughput: number;
  readonly cpuPerRequest: number;
  readonly p95: number;
  readonly p99: number;
  readonly rss: number;
};
const METRICS = ['throughput', 'cpuPerRequest', 'p95', 'p99', 'rss'] as const;
const mean = (samples: readonly number[]) => samples.reduce((sum, value) => sum + value, 0) / samples.length;
const deviation = (samples: readonly number[]) => Math.sqrt(samples.reduce((sum, value) => sum + (value - mean(samples)) ** 2, 0) / (samples.length - 1));

export function evaluatePairs(before: readonly Metrics[], after: readonly Metrics[], phase: 'aa' | 'ab', primary = false) {
  if (before.length !== DESIGN.pairedRepeats || after.length !== DESIGN.pairedRepeats
    || [...before, ...after].some((sample) => METRICS.some((metric) => !Number.isFinite(sample[metric]) || sample[metric] <= 0))) {
    throw new ExperimentInputFailure('Exactly five complete finite pairs required; no sample deletion or extra repeats');
  }
  const observations = METRICS.map((metric) => {
    const left = before.map((sample) => sample[metric]);
    const right = after.map((sample) => sample[metric]);
    const changes = right.map((sample, index) => (sample / left[index] - 1) * (metric === 'throughput' ? -1 : 1));
    const average = mean(changes);
    const margin = DESIGN.adoption.pairedStudentT4 * deviation(changes) / Math.sqrt(changes.length);
    return { metric, meanChange: average, lower: average - margin, upper: average + margin,
      beforeCv: deviation(left) / mean(left), afterCv: deviation(right) / mean(right) };
  });
  if (phase === 'aa') {
    const stable = observations.every((row) => Math.abs(row.meanChange) <= DESIGN.calibration.maxMeanDifference[row.metric]
      && (row.metric !== 'throughput' && row.metric !== 'cpuPerRequest'
        || Math.max(row.beforeCv, row.afterCv) <= DESIGN.calibration.maxArmCv));
    return { verdict: stable ? 'CALIBRATED' : 'INCONCLUSIVE', observations };
  }
  if (observations.some((row) => row.meanChange > DESIGN.regression[row.metric])) {
    return { verdict: 'REJECT', observations };
  }
  if (observations.some((row) => row.upper > DESIGN.regression[row.metric])) {
    return { verdict: 'INCONCLUSIVE', observations };
  }
  const cpu = observations.find((row) => row.metric === 'cpuPerRequest');
  if (primary && (!cpu || cpu.meanChange > -DESIGN.adoption.minimumPrimaryCpuReduction || cpu.upper >= 0)) {
    return { verdict: cpu && cpu.lower >= 0 ? 'REJECT' : 'INCONCLUSIVE', observations };
  }
  return { verdict: 'WITHIN_DECLARED_GATE', observations };
}
