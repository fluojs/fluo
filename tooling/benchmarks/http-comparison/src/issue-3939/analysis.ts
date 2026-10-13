import { isDeepStrictEqual } from 'node:util';
import { array, object } from '../profile-report';
import { histogramPercentile } from '../traffic';
import { DESIGN, ExperimentInputFailure, evaluatePairs, type Metrics } from './plan';

function positive(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ExperimentInputFailure(`Missing finite positive metric: ${field}`);
  }
  return value;
}

export function deriveMetrics(value: unknown, serverValue: unknown, duration: number, connections: number): Metrics {
  const measurement = object(value);
  const result = object(measurement.result);
  if ('driftDiagnostic' in measurement || measurement.statusMismatches !== 0
    || ['errors', 'timeouts', 'non2xx', 'mismatches'].some((field) => result[field] !== 0)
    || result.connections !== connections || positive(result, 'duration') < duration) {
    throw new ExperimentInputFailure('Invalid or diagnostically instrumented traffic');
  }
  const completed = positive(object(result.requests), 'total');
  const histogram = array(measurement.latencyHistogramMicros).map((row): readonly [number, number] => {
    const fields = array(row);
    if (fields.length !== 2 || typeof fields[0] !== 'number' || !Number.isFinite(fields[0]) || fields[0] < 0
      || typeof fields[1] !== 'number' || !Number.isSafeInteger(fields[1]) || fields[1] <= 0) {
      throw new ExperimentInputFailure('Invalid response histogram');
    }
    return [fields[0], fields[1]];
  });
  if (!Number.isSafeInteger(completed) || histogram.reduce((sum, [, count]) => sum + count, 0) !== completed) {
    throw new ExperimentInputFailure('Completed count differs from validated response histogram');
  }
  const server = object(serverValue);
  const samples = array(server.samples).map(object);
  if (samples.length < 2 || samples.some((sample) => 'driftDiagnostic' in sample)) {
    throw new ExperimentInputFailure('Missing ordinary resource endpoints');
  }
  const first = new Map(array(samples[0].processes).map((value) => {
    const process = object(value);
    return [process.pid, process.cpuSeconds] as const;
  }));
  const accumulated = new Map<unknown, number>();
  let peakRss = 0;
  for (const sample of samples) {
    let rss = 0;
    for (const value of array(sample.processes)) {
      const process = object(value);
      const initial = first.get(process.pid) ?? 0;
      if (typeof process.cpuSeconds !== 'number' || !Number.isFinite(process.cpuSeconds)
        || typeof initial !== 'number' || process.cpuSeconds < initial
        || typeof process.rssKiB !== 'number' || !Number.isFinite(process.rssKiB) || process.rssKiB < 0) {
        throw new ExperimentInputFailure('Invalid cumulative CPU/RSS counter');
      }
      accumulated.set(process.pid, Math.max(accumulated.get(process.pid) ?? 0, process.cpuSeconds - initial));
      rss += process.rssKiB * 1_024;
    }
    peakRss = Math.max(peakRss, rss);
  }
  const cpuSeconds = positive(server, 'cpuSeconds');
  if (Math.abs([...accumulated.values()].reduce((sum, value) => sum + value, 0) - cpuSeconds) > 1e-9
    || peakRss !== server.peakRssBytes) {
    throw new ExperimentInputFailure('CPU/RSS summary contradicts retained counters');
  }
  if (completed < DESIGN.minimumCompletedRequests
    || positive(server, 'cpuTimeResolutionSeconds') / cpuSeconds > DESIGN.maximumCpuQuantizationFraction) {
    throw new RangeError('INCONCLUSIVE: insufficient completions or CPU counter resolution');
  }
  return {
    throughput: positive(object(result.requests), 'average'),
    cpuPerRequest: cpuSeconds * 1_000_000 / completed,
    p95: histogramPercentile(histogram, 95),
    p99: histogramPercentile(histogram, 99),
    rss: positive(server, 'peakRssBytes'),
  };
}

function aaAccumulator(manifestSha256: string, artifactsSha256: string) {
  const expected = DESIGN.fixtures.flatMap((fixture) => DESIGN.configurations.flatMap((configuration) =>
    DESIGN.connections.flatMap((connections) => DESIGN.pairOrder.flatMap((arms, repeat) =>
      arms.map((arm) => ({ fixture: fixture.name, configuration, connections, repeat, arm }))))));
  const nonces = new Set<string>();
  const observations: (ReturnType<typeof evaluatePairs> & {
    readonly fixture: string; readonly configuration: string; readonly connections: number;
  })[] = [];
  let ordinal = 0;
  let arms: Record<string, Metrics[]> = { A1: [], A2: [] };
  const consume = (record: Record<string, unknown>) => {
    const condition = expected[ordinal];
    if (!condition || !isDeepStrictEqual(record.condition, condition)) {
      throw new ExperimentInputFailure('Missing, reordered, duplicated or extra finite-matrix records');
    }
    const identity = object(record.identity);
    const after = object(record.identityAfter);
    if (identity.status !== 'authenticated' || identity.instrumentation !== 'none'
      || identity.artifactsSha256 !== artifactsSha256
      || ['nonce', 'pid', 'runtime', 'source', 'artifacts', 'artifactsSha256', 'status', 'instrumentation']
        .some((field) => !isDeepStrictEqual(identity[field], after[field]))
      || typeof identity.nonce !== 'string' || nonces.has(identity.nonce)) {
      throw new ExperimentInputFailure('Unauthenticated, reused or drifting serving identity');
    }
    nonces.add(identity.nonce);
    const values = array(record.value);
    if (values.length !== 1) throw new ExperimentInputFailure('A/A requires one independent generator invocation per arm');
    const warmup = object(record.warmup);
    const warmResult = object(warmup.result);
    if (warmup.statusMismatches !== 0 || ['errors', 'timeouts', 'non2xx', 'mismatches'].some((field) => warmResult[field] !== 0)
      || warmResult.connections !== condition.connections || positive(warmResult, 'duration') < DESIGN.warmupSeconds
      || positive(object(warmResult.requests), 'total') <= 0) throw new ExperimentInputFailure('Invalid warmup traffic');
    arms[condition.arm].push(deriveMetrics(values[0], record.server, DESIGN.measurementSeconds, condition.connections));
    ordinal += 1;
    if (ordinal % (DESIGN.pairedRepeats * 2) === 0) {
      observations.push({ fixture: condition.fixture, configuration: condition.configuration, connections: condition.connections,
        ...evaluatePairs(arms.A1, arms.A2, 'aa') });
      arms = { A1: [], A2: [] };
    }
  };
  return {
    consume,
    finish() {
      if (ordinal !== expected.length) throw new ExperimentInputFailure('Missing, reordered, duplicated or extra finite-matrix records');
      return { aa: observations.every((row) => row.verdict === 'CALIBRATED') ? 'CALIBRATED' : 'INCONCLUSIVE',
        headroom: 'NOT_ESTABLISHED', manifestSha256, observations };
    },
  };
}

export function evaluateAA(rawValue: unknown, manifestSha256: string, artifactsSha256: string) {
  const raw = object(rawValue);
  if (raw.phase !== 'aa' || raw.manifestSha256 !== manifestSha256 || array(raw.invalidAttempts).length > 0) {
    throw new ExperimentInputFailure('Invalid attempts or different manifest: calibration not established');
  }
  const accumulator = aaAccumulator(manifestSha256, artifactsSha256);
  for (const record of array(raw.records)) accumulator.consume(object(record));
  return accumulator.finish();
}

export async function evaluateAAIncrementally(
  records: AsyncIterable<Record<string, unknown>>,
  manifestSha256: string,
  artifactsSha256: string,
) {
  const accumulator = aaAccumulator(manifestSha256, artifactsSha256);
  for await (const record of records) accumulator.consume(record);
  return accumulator.finish();
}
