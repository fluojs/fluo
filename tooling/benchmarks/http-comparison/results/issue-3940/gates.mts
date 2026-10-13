import { object, sha256 } from '../../src/profile-report.js';
import { histogramPercentile } from '../../src/traffic.js';
import { design, equal, ExperimentInputFailure, frozenManifest, hash, positive, schedule, text, type Manifest } from './plan.mjs';

export function traffic(input: unknown) {
  const raw = object(input);
  const result = object(raw.result);
  for (const key of ['errors', 'timeouts', 'non2xx', 'mismatches']) equal(result[key], 0, `traffic ${key}`);
  equal(raw.statusMismatches, 0, 'status mismatches');
  const completed = positive(object(result.requests).total);
  if (!Number.isSafeInteger(completed)) throw new ExperimentInputFailure('Invalid completion count');
  if (!Array.isArray(raw.latencyHistogramMicros)) throw new ExperimentInputFailure('Missing raw histogram');
  const histogram: [number, number][] = raw.latencyHistogramMicros.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'number' || row[0] < 0 || !Number.isFinite(row[0])) {
      throw new ExperimentInputFailure('Invalid raw histogram bucket');
    }
    const count = positive(row[1]);
    if (!Number.isSafeInteger(count)) throw new ExperimentInputFailure('Invalid histogram count');
    return [row[0], count];
  });
  equal(new Set(histogram.map(([bucket]) => bucket)).size, histogram.length, 'unique buckets');
  equal(histogram.reduce((sum, [, count]) => sum + count, 0), completed, 'histogram count');
  if ('driftDiagnostic' in raw) throw new ExperimentInputFailure('Ordinary timing contains instrumentation');
  return { completed, throughput: positive(object(result.requests).average),
    p95: histogramPercentile(histogram, 95), p99: histogramPercentile(histogram, 99), raw, result };
}
export function generatorIdentity(input: unknown, manifest: Manifest) {
  const generator = object(input);
  const expected = manifest.identities.generator;
  for (const field of ['hostname', 'runtime', 'executable', 'executableSha256', 'clientSha256', 'lockfileSha256'] as const) {
    equal(generator[field], expected[field], `generator ${field}`);
  }
  const pid = positive(generator.pid);
  if (!Number.isSafeInteger(pid)) throw new ExperimentInputFailure('Invalid generator PID');
  return text(generator.nonce);
}
export function metrics(input: unknown) {
  const measured = traffic(input);
  const server = object(measured.raw.server);
  const pid = positive(server.rootPid);
  const quantum = positive(server.cpuTimeResolutionSeconds);
  if (!Array.isArray(server.samples) || server.samples.length < 2) throw new ExperimentInputFailure('Missing CPU/RSS samples');
  const initial = new Map<number, number>();
  const last = new Map<number, number>();
  const deltas = new Map<number, number>();
  let previousWall = -1;
  let firstWall = 0;
  let rss = 0;
  for (const [index, entry] of server.samples.entries()) {
    const sample = object(entry);
    if ('driftDiagnostic' in sample) throw new ExperimentInputFailure('Instrumented resource sample');
    const wall = positive(sample.wallMs);
    if (wall <= previousWall) throw new ExperimentInputFailure('Resource samples not ordered');
    if (index === 0) firstWall = wall;
    previousWall = wall;
    equal(sample.cpuTimeResolutionSeconds, quantum, 'CPU resolution');
    if (!Array.isArray(sample.processes)) throw new ExperimentInputFailure('Missing sampled process tree');
    const seen = new Set<number>();
    let sampledRss = 0;
    for (const item of sample.processes) {
      const process = object(item);
      const sampledPid = positive(process.pid);
      if (seen.has(sampledPid) || !Number.isSafeInteger(sampledPid)) throw new ExperimentInputFailure('Invalid sampled PID');
      seen.add(sampledPid);
      const counter = process.cpuSeconds;
      if (typeof counter !== 'number' || counter < 0 || !Number.isFinite(counter) || counter < (last.get(sampledPid) ?? 0)) {
        throw new ExperimentInputFailure('Invalid CPU counter');
      }
      if (index === 0) initial.set(sampledPid, counter);
      last.set(sampledPid, counter);
      deltas.set(sampledPid, counter - (initial.get(sampledPid) ?? 0));
      sampledRss += positive(process.rssKiB) * 1024;
    }
    if (!seen.has(pid)) throw new ExperimentInputFailure('Serving PID absent from samples');
    rss = Math.max(rss, sampledRss);
  }
  const cpu = [...deltas.values()].reduce((sum, value) => sum + value, 0);
  equal(server.cpuSeconds, cpu, 'raw CPU total');
  equal(server.wallSeconds, (previousWall - firstWall) / 1000, 'raw interval');
  equal(server.peakRssBytes, rss, 'raw sampled peak RSS');
  if (measured.completed < design.minimumCompletedRequests || cpu < quantum * design.minimumCpuResolutionMultiple) {
    throw new ExperimentInputFailure('Insufficient requests or CPU counter precision');
  }
  return { throughput: measured.throughput, cpuPerRequest: cpu / measured.completed,
    p95: measured.p95, p99: measured.p99, rss };
}
type Metrics = ReturnType<typeof metrics>;
const keys: readonly (keyof Metrics)[] = ['throughput', 'cpuPerRequest', 'p95', 'p99', 'rss'];
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const deviation = (values: readonly number[]) => Math.sqrt(values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / (values.length - 1));

export function pairedInterval(values: readonly number[]) {
  if (values.length !== 5 || values.some((value) => !Number.isFinite(value))) throw new ExperimentInputFailure('Five finite paired samples required');
  const center = mean(values);
  const radius = 2.7764451051977987 * deviation(values) / Math.sqrt(5);
  return { mean: center, lower: center - radius, upper: center + radius };
}
export function assessPairs(arms: { readonly A: readonly Metrics[]; readonly B: readonly Metrics[] }, hit: boolean) {
  if (arms.A.length !== 5 || arms.B.length !== 5) throw new ExperimentInputFailure('Five pairs required');
  const failures: string[] = [];
  const intervals = Object.fromEntries(keys.map((key) => {
    const interval = pairedInterval(arms.A.map((value, pair) =>
      (key === 'throughput' ? 1 : -1) * (arms.B[pair][key] / value[key] - 1)));
    if (interval.mean < -design.regressionMaximum[key]) failures.push(`regression ${key}`);
    if (hit && (key === 'throughput' || key === 'cpuPerRequest')
      && (interval.mean < design.minimumHitImprovement[key] || interval.lower <= 0)) failures.push(`unproven gain ${key}`);
    return [key, interval];
  }));
  return { status: failures.length ? 'FAIL' : 'PASS', failures, intervals };
}
export function evaluate(input: { readonly manifest: unknown; readonly evidence: unknown }) {
  const manifest = frozenManifest(input.manifest);
  const evidence = object(input.evidence);
  equal(evidence.manifestSha256, sha256(JSON.stringify(input.manifest)), 'run manifest');
  equal(evidence.phase, 'AA', 'experiment phase');
  equal(evidence.invalidAttempts, [], 'invalid attempts');
  if (!Array.isArray(evidence.records)) throw new ExperimentInputFailure('Missing records');
  const records = evidence.records;
  const expected = schedule();
  equal(records.length, expected.length, 'finite run count');
  const nonces = new Set<string>();
  const generatorNonces = new Set<string>();
  const groups = new Map<string, { A: Metrics[]; B: Metrics[] }>();
  for (const [index, entry] of records.entries()) {
    const record = object(entry);
    const condition = expected[index];
    equal(record.condition, condition, 'condition/order');
    const serving = object(record.servingIdentity);
    equal(serving.status, 'authenticated', 'serving proof');
    equal(serving.instrumentation, 'none', 'ordinary timing');
    equal(serving.target, 'fluo-bun', 'target');
    equal(object(serving.runtime).bun, manifest.identities.server.runtime, 'actual Bun');
    equal(serving.executable, manifest.identities.server.executable, 'serving executable');
    equal(serving.executableSha256, manifest.identities.server.executableSha256, 'serving executable digest');
    equal(serving.launcherPid, serving.pid, 'serving PID');
    equal(serving.source, manifest.prepared.source, 'source identity');
    equal(serving.artifacts, manifest.prepared.artifacts, 'build identity');
    const nonce = text(serving.nonce);
    if (nonces.has(nonce)) throw new ExperimentInputFailure('Reused serving process');
    nonces.add(nonce);
    const raw = object(record.raw);
    const generatorNonce = generatorIdentity(raw.generator, manifest);
    if (generatorNonces.has(generatorNonce)) throw new ExperimentInputFailure('Reused generator invocation');
    generatorNonces.add(generatorNonce);
    equal(object(raw.server).rootPid, serving.pid, 'serving resource subject');
    equal(object(raw.server).method, manifest.identities.server.cpuCounterMethod, 'counter method');
    equal(object(raw.server).cpuTimeResolutionSeconds, manifest.identities.server.cpuCounterResolutionSeconds, 'counter precision');
    equal(object(raw.result).connections, condition.connections, 'concurrency');
    if (positive(object(raw.result).duration) < design.measurementSeconds - 0.01) throw new ExperimentInputFailure('Early timing stop');
    const warmup = traffic(record.warmup);
    generatorIdentity(warmup.raw.generator, manifest);
    equal(warmup.result.connections, condition.connections, 'warmup concurrency');
    if (positive(warmup.result.duration) < design.warmupSeconds - 0.01) throw new ExperimentInputFailure('Early warmup stop');
    const key = JSON.stringify([condition.workload, condition.configuration, condition.connections]);
    const group = groups.get(key) ?? { A: [], B: [] };
    switch (condition.arm) {
      case 'A': group.A.push(metrics(raw)); break;
      case 'B': group.B.push(metrics(raw)); break;
      default: throw new ExperimentInputFailure('Unknown arm');
    }
    groups.set(key, group);
  }
  const failures: string[] = [];
  const summary = [...groups].map(([condition, arms]) => {
    for (const arm of [arms.A, arms.B]) {
      if (deviation(arm.map((item) => item.throughput)) / mean(arm.map((item) => item.throughput)) > design.throughputCvMaximum) failures.push(`${condition}: unstable throughput`);
    }
    const intervals = Object.fromEntries(keys.map((key) => {
      const a = arms.A.map((item) => item[key]);
      const b = arms.B.map((item) => item[key]);
      const interval = pairedInterval(a.map((value, pair) => (key === 'throughput' ? 1 : -1) * (b[pair] / value - 1)));
      if (Math.abs(mean(b) / mean(a) - 1) > design.aaMeanDifferenceMaximum[key]) failures.push(`${condition}: AA ${key}`);
      return [key, interval];
    }));
    return { condition, intervals };
  });
  return { status: failures.length ? 'INCONCLUSIVE' : 'PASS', phase: 'AA', failures, summary };
}

export function requireCalibration(manifest: unknown, aa: unknown, headroom: unknown) {
  equal(evaluate({ manifest, evidence: aa }).status, 'PASS', 'fresh AA gate');
  const evidence = object(headroom);
  const declared = frozenManifest(manifest);
  equal(evidence.manifestSha256, sha256(JSON.stringify(manifest)), 'headroom binding');
  equal(evidence.workload, declared.identities.headroomWorkload, 'headroom workload');
  equal(evidence.invalidAttempts, [], 'headroom invalid attempts');
  if (!Array.isArray(evidence.observations) || evidence.observations.length !== 6) throw new ExperimentInputFailure('Six headroom observations required');
  const rps: number[] = [];
  const generatorNonces = new Set<string>();
  for (const [index, entry] of evidence.observations.entries()) {
    const sample = object(entry);
    const expectedWorkers = [[1, 4], [4, 1], [1, 4]].flat()[index];
    const serving = object(sample.servingIdentity);
    equal(serving.status, 'authenticated', 'headroom serving proof');
    equal(serving.instrumentation, 'none', 'headroom instrumentation');
    equal(serving.source, declared.prepared.source, 'headroom source');
    equal(serving.artifacts, declared.prepared.artifacts, 'headroom build');
    equal(object(sample.server).rootPid, serving.pid, 'headroom resource subject');
    equal(sample.workers, expectedWorkers, 'headroom order');
    equal(sample.totalConnections, 64, 'headroom connections');
    if (!Array.isArray(sample.samples) || sample.samples.length !== expectedWorkers) throw new ExperimentInputFailure('Missing worker originals');
    rps.push(sample.samples.reduce((sum: number, item: unknown) => {
      const measured = traffic(item);
      const nonce = generatorIdentity(measured.raw.generator, declared);
      if (generatorNonces.has(nonce)) throw new ExperimentInputFailure('Reused headroom worker');
      generatorNonces.add(nonce);
      equal(measured.result.connections, 64 / expectedWorkers, 'worker concurrency');
      if (positive(measured.result.duration) < 9.99) throw new ExperimentInputFailure('Early headroom stop');
      return sum + measured.throughput;
    }, 0));
  }
  const one = [rps[0], rps[3], rps[4]];
  const four = [rps[1], rps[2], rps[5]];
  if (mean(four) / mean(one) - 1 > 0.03) throw new ExperimentInputFailure('Generator scaling exceeds headroom gate');
  return ['independentGeneratorHeadroomEvidence', 'serverNetworkBottleneckEvidence'].map((name) => {
    const receipt = object(evidence[name]);
    return { path: text(receipt.path), sha256: hash(receipt.sha256) };
  });
}
