import type { monitorServer } from '../resources';
import { type Arm, DESIGN } from './design';
import type { RemoteMeasurement } from './generator-identity';

export interface Observation {
  readonly arm: Arm;
  readonly measurement: Awaited<ReturnType<typeof monitorServer<readonly RemoteMeasurement[]>>>;
}

export function armMetrics(observation: Observation) {
  const { value, server } = observation.measurement;
  const completions = value.reduce((sum, sample) => sum + sample.result.requests.total, 0);
  const throughput = value.reduce((sum, sample) => sum + sample.result.requests.average, 0);
  const cpuPerRequest = server.cpuSeconds / completions;
  if (completions < DESIGN.gates.minimumCompletions || value.some((sample) => sample.statusMismatches !== 0)
    || !(server.cpuSeconds > 0)
    || server.cpuTimeResolutionSeconds / server.cpuSeconds > DESIGN.gates.cpuQuantumFraction) {
    throw new Error('Ordinary completion/status/process-CPU-quantum prerequisite failed');
  }
  const metrics = {
    throughput, cpuPerRequest, p95: Math.max(...value.map((sample) => sample.latencyPercentilesMs.p95)),
    p99: Math.max(...value.map((sample) => sample.latencyPercentilesMs.p99)), rss: server.peakRssBytes,
  };
  if (Object.values(metrics).some((metric) => !Number.isFinite(metric) || metric <= 0)) {
    throw new Error('Missing or nonpositive ordinary metrics');
  }
  return metrics;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cv(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)) / average;
}

export function pairedInterval(ratios: readonly number[]) {
  if (ratios.length < 3 || ratios.some((ratio) => !Number.isFinite(ratio) || ratio <= 0)) {
    throw new Error('Invalid independent pair ratios');
  }
  let seed: number = DESIGN.analysis.seed;
  const bootstrap: number[] = [];
  for (let iteration = 0; iteration < DESIGN.analysis.resamples; iteration += 1) {
    let sum = 0;
    for (let draw = 0; draw < ratios.length; draw += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      sum += ratios[Math.floor((seed >>> 0) / 0x1_0000_0000 * ratios.length)];
    }
    bootstrap.push(sum / ratios.length);
  }
  bootstrap.sort((left, right) => left - right);
  return {
    ratios, mean: mean(ratios), confidence: DESIGN.analysis.confidence,
    low: bootstrap[249], high: bootstrap[9749], resamples: DESIGN.analysis.resamples, seed: DESIGN.analysis.seed,
  };
}

export function phaseVerdict(observations: readonly Observation[], phase: Arm['phase']) {
  const metrics = ['throughput', 'cpuPerRequest', 'p95', 'p99', 'rss'] as const;
  const summaries: unknown[] = [];
  for (const workload of DESIGN.workloads) {
    for (const connections of phase === 'aa' ? DESIGN.aa.connections : [64]) {
      const selected = observations.filter((row) => row.arm.phase === phase
        && row.arm.workload === workload && row.arm.connections === connections);
      const pairs = phase === 'aa' ? DESIGN.aa.pairs : DESIGN.headroom.pairs;
      if (selected.length !== pairs * 2) throw new Error('Incomplete frozen diagnostic phase');
      const left = Array.from({ length: pairs }, (_, pair) => selected.find((row) =>
        row.arm.pair === pair && row.arm.label === (phase === 'aa' ? 'A1' : 'one')));
      const right = Array.from({ length: pairs }, (_, pair) => selected.find((row) =>
        row.arm.pair === pair && row.arm.label === (phase === 'aa' ? 'A2' : 'four')));
      if (left.some((row) => row === undefined) || right.some((row) => row === undefined)) {
        throw new Error('Missing or duplicate frozen pair');
      }
      const first = left.map((row) => { if (!row) throw new Error('Missing pair'); return armMetrics(row); });
      const second = right.map((row) => { if (!row) throw new Error('Missing pair'); return armMetrics(row); });
      const paired = Object.fromEntries(metrics.map((key) =>
        [key, pairedInterval(first.map((row, pair) => second[pair][key] / row[key]))]));
      for (const group of [first, second]) {
        for (const key of ['throughput', 'cpuPerRequest'] as const) {
          if (cv(group.map((row) => row[key])) > DESIGN.gates.cv) throw new Error(`${phase}/${workload}/${key} CV exceeds3%`);
        }
      }
      if (phase === 'headroom') {
        if (paired.throughput.mean - 1 > DESIGN.gates.headroomMeanGain) throw new Error('Generator headroom gain exceeds3%');
      } else {
        for (const key of metrics) {
          const limit = key === 'throughput' || key === 'cpuPerRequest'
            ? DESIGN.gates.pairedMeanDrift : DESIGN.gates.tailRssDrift;
          if (Math.abs(paired[key].mean - 1) > limit) throw new Error(`A/A ${key} paired drift exceeds frozen limit`);
        }
      }
      summaries.push({ workload, connections, paired });
    }
  }
  return { status: 'LOCAL_DIAGNOSTIC_ONLY', phase, summaries, capacity: 'PARENT_REVIEW_REQUIRED' };
}
