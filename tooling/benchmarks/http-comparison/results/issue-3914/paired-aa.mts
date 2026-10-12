import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { histogramPercentile } from '../../src/traffic';

export const CONDITION = {
  platform: 'bun', os: 'linux', runtimeVersion: '1.4.2', scenario: 'stage-minimal',
  configuration: 'equivalent', connections: 64, warmupSeconds: 30, measureSeconds: 60,
  minimumCompletedRequests: 20_000,
} as const;
// Private shared helpers accept only these declared subjects, never arbitrary conditions.
export type NodeSubject = {
  readonly platform: 'nodejs' | 'fastify' | 'express';
  readonly mode: 'calibration' | 'candidate';
  readonly schema?: 'paired-node-v1' | 'paired-node-180-v1';
};
export function pairedCondition(subject?: NodeSubject) {
  return subject ? { ...CONDITION, platform: subject.platform, runtimeVersion: '24.21.0',
    measureSeconds: subject.schema === 'paired-node-180-v1' ? 180 : 60 } as const : CONDITION;
}
export const BLOCKS = [['N', 'X', 'Y', 'N'], ['N', 'Y', 'X', 'N'], ['N', 'X', 'Y', 'N']] as const;
export const CV = { throughputRps: 0.03, serverCpuMicrosPerRequest: 0.03, p95Ms: 0.05, p99Ms: 0.075, rssBytes: 0.05 } as const;
export const LIMITS = {
  throughputRps: { minimum: 0.95 }, serverCpuMicrosPerRequest: { maximum: 1.05 },
  p95Ms: { maximum: 1.10 }, p99Ms: { maximum: 1.15 }, rssBytes: { maximum: 1.10 },
} as const;
type Metric = keyof typeof CV;
type Metrics = Record<Metric, number>;
const METRICS = Object.keys(CV) as Metric[];
const COLLECTOR = fileURLToPath(import.meta.url);

export class AAInputFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AAInputFailure';
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AAInputFailure('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new AAInputFailure('Expected a nonempty string');
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new AAInputFailure('Expected a finite positive metric');
  return value;
}
function integer(value: unknown): number {
  const result = positive(value);
  if (!Number.isSafeInteger(result)) throw new AAInputFailure('Expected a positive integer');
  return result;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new AAInputFailure('Expected an array');
  return value;
}
function hash(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new AAInputFailure('Expected SHA256');
  return result;
}
function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new AAInputFailure(`${label} mismatch`);
}
function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function precision(value: unknown) {
  const item = object(value);
  equal(item.verified, true, 'CPU precision verification');
  return { method: text(item.method), resolutionSeconds: positive(item.resolutionSeconds), verified: true };
}
function absolute(value: unknown): string {
  const path = text(value);
  if (!isAbsolute(path) || resolve(path) !== path) throw new AAInputFailure('Expected a canonical absolute path');
  return path;
}

export function describePlan(input: unknown) {
  const plan = object(input);
  equal(plan.condition, CONDITION, 'condition');
  equal(plan.blocks, BLOCKS, 'order');
  equal(plan.maxCv, CV, 'CV policy');
  equal(plan.ratioLimits, LIMITS, 'budget policy');
  equal(plan.automaticAdditionalRepeats, 0, 'repeats');
  equal(plan.outlierDeletionAllowed, false, 'outlier deletion');
  equal(plan.freshServerPerRun, true, 'fresh server');
  equal(plan.maximumCpuQuantizationFraction, 0.01, 'CPU quantization bound');
  equal(plan.generatorLifetime, 'one-local-session-per-server-run', 'generator lifetime');
  equal(plan.subjects, {
    N: 'native-bun', X: 'fluo-bun at the same BEFORE source', Y: 'fluo-bun at the same BEFORE source',
  }, 'subjects');
  if (!/^[a-f0-9]{40}$/.test(text(plan.frameworkSource))) throw new AAInputFailure('Expected full BEFORE source SHA');
  text(plan.orderSeed);
  hash(plan.previousPolicySha256);
  return { status: text(plan.status), condition: CONDITION, blocks: BLOCKS, frameworkSource: plan.frameworkSource };
}

export function frozenPlan(input: unknown) {
  const description = describePlan(input);
  equal(description.status, 'FROZEN', 'plan freeze');
  const plan = object(input);
  const freeze = object(plan.freeze);
  const head = text(freeze.head);
  if (!/^[a-f0-9]{40}$/.test(head)) throw new AAInputFailure('Expected full collector head SHA');
  const artifacts = Object.fromEntries(Object.entries(object(freeze.artifacts)).map(([path, digest]) => [absolute(path), hash(digest)]));
  if (Object.keys(artifacts).length === 0) throw new AAInputFailure('Frozen artifacts are missing');
  const targets = object(freeze.targetArtifactsSha256);
  equal(targets.X, targets.Y, 'same BEFORE build');
  const receipt = object(freeze.buildReceipt);
  const generator = object(freeze.generator);
  equal(generator.protocol, 'local-session-v1', 'generator protocol');
  return {
    ...description, head, collectorSha256: hash(freeze.collectorSha256),
    harnessSha256: hash(freeze.harnessSha256), runtimeExecutableSha256: hash(freeze.runtimeExecutableSha256),
    containerIdentity: text(freeze.containerIdentity), cpuPrecision: precision(freeze.cpuPrecision),
    planPath: absolute(freeze.planPath), outputRoot: absolute(freeze.outputRoot),
    buildReceipt: { path: absolute(receipt.path), sha256: hash(receipt.sha256) },
    artifacts, targetArtifactsSha256: { N: hash(targets.N), X: hash(targets.X), Y: hash(targets.Y) },
    generator: { protocol: 'local-session-v1', node: text(generator.node),
      executable: absolute(generator.executable), hostname: text(generator.hostname) },
  };
}
export type FrozenPlan = Omit<ReturnType<typeof frozenPlan>, 'condition'> & {
  condition: ReturnType<typeof pairedCondition>;
};
export { absolute, array, equal, hash, integer, object, positive, precision, sha256, text };

function cv(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) / mean;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function traffic(value: unknown) {
  const measurement = object(value);
  if ('driftDiagnostic' in measurement) {
    throw new AAInputFailure('Unexpected driftDiagnostic in acceptance traffic');
  }
  const result = object(measurement.result);
  for (const key of ['errors', 'timeouts', 'non2xx', 'mismatches']) equal(result[key], 0, `traffic ${key}`);
  equal(measurement.statusMismatches, 0, 'traffic status');
  const requests = object(result.requests);
  const completed = integer(requests.total);
  const histogram: [number, number][] = array(measurement.latencyHistogramMicros).map((entry) => {
    const pair = array(entry);
    equal(pair.length, 2, 'histogram pair');
    const micros = pair[0];
    if (typeof micros !== 'number' || !Number.isFinite(micros) || micros < 0) throw new AAInputFailure('Invalid histogram latency');
    return [micros, integer(pair[1])];
  });
  if (new Set(histogram.map(([micros]) => micros)).size !== histogram.length) throw new AAInputFailure('Duplicate histogram bucket');
  equal(histogram.reduce((sum, [, count]) => sum + count, 0), completed, 'histogram completions');
  return { completed, rps: positive(requests.average), p95: positive(histogramPercentile(histogram, 95)), p99: positive(histogramPercentile(histogram, 99)), result };
}

function observedDuration(value: unknown, requested: number): void {
  // autocannon reports elapsed time rounded to 10ms, not the requested duration.
  if (positive(value) < requested - 0.01) throw new AAInputFailure('Traffic ended before the requested duration');
}

export function readRecord(input: unknown, index: number, plan: FrozenPlan, subject?: NodeSubject) {
  const record = object(input);
  const block = Math.floor(index / 4);
  const slot = index % 4;
  const arm = BLOCKS[block][slot];
  equal(record.ordinal, index, 'ordinal');
  equal(record.block, block, 'block');
  equal(record.slot, slot, 'slot');
  equal(record.arm, arm, 'arm order');
  const condition = pairedCondition(subject);
  equal(record.condition, condition, 'record condition');
  equal(record.identity, {
    head: plan.head, frameworkSource: plan.frameworkSource, collectorSha256: plan.collectorSha256,
    harnessSha256: plan.harnessSha256, buildReceiptSha256: plan.buildReceipt.sha256,
    containerIdentity: plan.containerIdentity,
  }, 'record identity');
  const startedMs = positive(record.startedMs);
  const endedMs = positive(record.endedMs);
  if (endedMs <= startedMs) throw new AAInputFailure('Invalid run interval');
  const raw = object(record.raw);
  equal(raw.label, `${arm === 'N' ? 'native' : 'fluo'}-${condition.platform}`, 'target');
  const identity = object(raw.servingIdentity);
  equal(identity.status, 'authenticated', 'serving authentication');
  equal(identity.instrumentation, 'none', 'instrumentation');
  const runtime = object(identity.runtime);
  equal(runtime[subject ? 'node' : 'bun'], condition.runtimeVersion, 'serving runtime');
  if (subject && (runtime.bun !== undefined || runtime.deno !== undefined)) throw new AAInputFailure('Non-Node serving runtime');
  equal(identity.executableSha256, plan.runtimeExecutableSha256, 'serving executable');
  equal(identity.target, raw.label, 'serving target');
  equal(identity.artifactsSha256, plan.targetArtifactsSha256[arm], 'serving build');
  const artifacts = object(identity.artifacts);
  equal(sha256(JSON.stringify(artifacts)), identity.artifactsSha256, 'artifact digest');
  for (const [path, digest] of Object.entries(artifacts)) equal(plan.artifacts[path], digest, 'frozen serving artifact');
  const source = object(identity.source);
  equal(source.gitHead, plan.head, 'serving head');
  equal(source.gitStatus, '', 'clean serving source');
  equal(source.benchmarkSourceSha256, plan.harnessSha256, 'serving harness');
  const pid = integer(identity.pid);
  equal(identity.launcherPid, pid, 'launcher PID');
  const nonce = text(identity.nonce);
  const generator = object(raw.generator);
  const generatorPid = integer(generator.pid);
  const generatorNonce = text(generator.nonce);
  equal(generator, { ...plan.generator, pid: generatorPid, nonce: generatorNonce }, 'generator identity');
  if (generatorPid === pid) throw new AAInputFailure('Generator and server share a process');
  const cold = object(raw.coldStart);
  equal(object(cold.firstRequest).generator, generator, 'cold generator continuity');
  equal(object(raw.warmup).generator, generator, 'warmup generator continuity');
  positive(cold.processToReadyMs);
  const first = traffic(cold.firstRequest);
  equal(first.completed, 1, 'cold completions');
  equal(first.result.connections, 1, 'cold concurrency');
  const warmup = traffic(raw.warmup);
  equal(warmup.result.connections, 64, 'warmup concurrency');
  observedDuration(warmup.result.duration, condition.warmupSeconds);
  const measured = traffic(raw);
  equal(measured.result.connections, 64, 'measurement concurrency');
  observedDuration(measured.result.duration, condition.measureSeconds);
  const server = object(raw.server);
  equal(server.subject, 'server-process-tree', 'resource subject');
  equal(server.rootPid, pid, 'resource root');
  text(server.method);
  positive(server.wallSeconds);
  const cpuSeconds = positive(server.cpuSeconds);
  const samples = array(server.samples).map((entry) => {
    const sample = object(entry);
    if ('driftDiagnostic' in sample) {
      throw new AAInputFailure('Unexpected driftDiagnostic in acceptance resource samples');
    }
    const processes = array(sample.processes).map(object);
    const pids = processes.map((process) => integer(process.pid));
    if (!pids.includes(pid) || new Set(pids).size !== pids.length) throw new AAInputFailure('Invalid sampled tree');
    if (pids.includes(generatorPid)) throw new AAInputFailure('Generator included in server resource tree');
    const rss = processes.reduce((sum, process) => sum + positive(process.rssKiB) * 1_024, 0);
    const counters = processes.map((process) => {
      const seconds = process.cpuSeconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new AAInputFailure('Invalid raw CPU counter');
      return { pid: integer(process.pid), seconds };
    });
    return { wallMs: positive(sample.wallMs), rss, counters };
  });
  if (samples.length < 2 || samples.some((sample, i) => i > 0 && sample.wallMs <= samples[i - 1].wallMs)) throw new AAInputFailure('Missing or misordered resource samples');
  const initialCpu = new Map(samples[0].counters.map(({ pid, seconds }) => [pid, seconds]));
  const lastCpu = new Map(initialCpu);
  const cpuDeltas = new Map<number, number>();
  for (const sample of samples) for (const counter of sample.counters) {
    if (counter.seconds < (lastCpu.get(counter.pid) ?? 0)) throw new AAInputFailure('CPU counter decreased');
    lastCpu.set(counter.pid, counter.seconds);
    cpuDeltas.set(counter.pid, counter.seconds - (initialCpu.get(counter.pid) ?? 0));
  }
  equal(cpuSeconds, [...cpuDeltas.values()].reduce((sum, seconds) => sum + seconds, 0), 'raw CPU total');
  equal(server.wallSeconds, (samples[samples.length - 1].wallMs - samples[0].wallMs) / 1000, 'resource interval');
  const rssBytes = Math.max(...samples.map((sample) => sample.rss));
  equal(server.peakRssBytes, rssBytes, 'simultaneous sampled RSS');
  let precisionResolved = false;
  if (server.cpuTimeResolutionSeconds !== undefined && server.cpuTimeResolutionSeconds !== null) {
    const quantum = positive(server.cpuTimeResolutionSeconds);
    precisionResolved = quantum === plan.cpuPrecision.resolutionSeconds
      && server.method === plan.cpuPrecision.method
      && cpuSeconds > quantum && quantum / (cpuSeconds - quantum) <= 0.01;
  }
  const metrics: Metrics = {
    throughputRps: measured.rps, serverCpuMicrosPerRequest: 1e6 * cpuSeconds / measured.completed,
    p95Ms: measured.p95, p99Ms: measured.p99, rssBytes,
  };
  for (const value of Object.values(metrics)) positive(value);
  return { arm, block, pid, nonce, generatorPid, generatorNonce, startedMs, endedMs, metrics, completed: measured.completed, precisionResolved };
}

export function evaluateAA(planInput: unknown, evidenceInput: unknown) {
  return evaluatePaired(() => {
    const plan = frozenPlan(planInput);
    equal(plan.targetArtifactsSha256.X, plan.targetArtifactsSha256.Y, 'same BEFORE build');
    return plan;
  }, evidenceInput);
}

// Source-specific comparisons supply authentic per-run descriptors; raw records are never rewritten.
export function evaluatePaired(planAt: (index: number) => FrozenPlan, evidenceInput: unknown, subject?: NodeSubject) {
  const evidenceErrors: string[] = [];
  const inconclusive: string[] = [];
  const budgetBreaches: { metric: Metric; observation: string; ratio: number }[] = [];
  const observations: {
    metric: Metric; nativeBlockCv: number[]; globalNativeCv: number; xCv: number; yCv: number;
    ratios: number[]; ratioCv: number; medianRatio: number;
  }[] = [];
  try {
    const firstPlan = planAt(0);
    const evidence = object(evidenceInput);
    equal(evidence.invalidAttempts, [], 'invalid attempts');
    const rawRecords = array(evidence.records);
    equal(rawRecords.length, 12, 'exact run count');
    const records = rawRecords.map((record, index) => readRecord(record, index, index === 0 ? firstPlan : planAt(index), subject));
    if (new Set(records.map((record) => record.pid)).size !== 12 || new Set(records.map((record) => record.nonce)).size !== 12) throw new AAInputFailure('Duplicate serving process identity');
    if (new Set(records.map((record) => record.generatorPid)).size !== 12
      || new Set(records.map((record) => record.generatorNonce)).size !== 12) throw new AAInputFailure('Reused generator across server runs');
    if (records.some((record, i) => i > 0 && record.startedMs < records[i - 1].endedMs)) throw new AAInputFailure('Overlapping runs');
    for (const record of records) {
      if (record.completed < 20_000) inconclusive.push(`run ${records.indexOf(record)}: insufficient completed requests`);
      if (!record.precisionResolved) inconclusive.push(`run ${records.indexOf(record)}: unresolved CPU precision`);
    }
    for (const metric of METRICS) {
      const x = records.filter((record) => record.arm === 'X').map((record) => record.metrics[metric]);
      const y = records.filter((record) => record.arm === 'Y').map((record) => record.metrics[metric]);
      const n = records.filter((record) => record.arm === 'N').map((record) => record.metrics[metric]);
      const ratios = y.map((value, i) => positive(value / x[i]));
      const nativeBlockCv = [0, 1, 2].map((block) => cv(records.filter((record) => record.block === block && record.arm === 'N').map((record) => record.metrics[metric])));
      const ratioCv = cv(ratios);
      const medianRatio = positive(median(y) / median(x));
      observations.push({ metric, nativeBlockCv, globalNativeCv: cv(n), xCv: cv(x), yCv: cv(y), ratios, ratioCv, medianRatio });
      if (nativeBlockCv.some((value) => value > CV[metric])) inconclusive.push(`${metric}: native block drift`);
      if (ratioCv > CV[metric]) inconclusive.push(`${metric}: paired ratio instability`);
      for (const [observation, ratio] of [['median', medianRatio], ...ratios.map((value, i) => [`pair-${i}`, value] as const)] as const) {
        const limit = LIMITS[metric];
        if (('minimum' in limit && ratio < limit.minimum) || ('maximum' in limit && ratio > limit.maximum)) {
          budgetBreaches.push({ metric, observation: String(observation), ratio: Number(ratio) });
        }
      }
    }
  } catch (error) {
    if (!(error instanceof AAInputFailure)) throw error;
    evidenceErrors.push(error.message);
  }
  const verdict = evidenceErrors.length ? 'FAIL_EVIDENCE' : inconclusive.length ? 'INCONCLUSIVE'
    : budgetBreaches.length ? 'FAIL_BUDGET' : 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE';
  return { verdict, evidenceErrors, inconclusive, observations, budgetBreaches };
}

export async function collectAA(planPath: string, outputPath: string, planOnly = false) {
  const bytes = await readFile(planPath);
  const input: unknown = JSON.parse(bytes.toString());
  if (planOnly) return describePlan(input);
  if (process.env.BENCH_DIAGNOSTIC_DRIFT !== undefined) {
    throw new AAInputFailure('Unsupported collection environment BENCH_DIAGNOSTIC_DRIFT');
  }
  const plan = frozenPlan(input);
  equal(resolve(planPath), plan.planPath, 'frozen plan path');
  equal(resolve(outputPath), plan.outputRoot, 'frozen output path');
  equal(process.platform, 'linux', 'collector OS');
  equal(process.version, plan.generator.node, 'generator runtime');
  equal(process.execPath, plan.generator.executable, 'generator executable');
  equal(hostname(), plan.generator.hostname, 'generator host');
  equal(plan.targetArtifactsSha256.X, plan.targetArtifactsSha256.Y, 'same BEFORE build');
  equal(sha256(await readFile(COLLECTOR)), plan.collectorSha256, 'collector source');
  // Never rebuild frozen inputs. The prepared environment supplies the receipt and artifacts.
  equal(sha256(await readFile(plan.buildReceipt.path)), plan.buildReceipt.sha256, 'build receipt hash');
  const receipt = object(JSON.parse(await readFile(plan.buildReceipt.path, 'utf8')));
  equal(receipt.head, plan.head, 'build head');
  equal(receipt.frameworkSource, plan.frameworkSource, 'BEFORE build source');
  equal(receipt.configuration, 'equivalent', 'build configuration');
  equal(receipt.artifacts, plan.artifacts, 'build artifact mapping');
  for (const [path, digest] of Object.entries(plan.artifacts)) equal(sha256(await readFile(path)), digest, `artifact ${path}`);
  if (process.env.BENCH_SSH_HOST !== undefined || process.env.BENCH_REMOTE_DIR !== undefined) {
    throw new AAInputFailure('A/A collection requires a local load process');
  }
  // Set configuration before importing run.ts: its options are captured at module initialization.
  for (const [key, value] of Object.entries({
    BENCH_CONFIGURATION: 'equivalent', BENCH_WARMUP_SEC: '30', BENCH_MEASURE_SEC: '60', BENCH_CONNECTIONS: '64',
    BENCH_CONCURRENCY_SWEEP: '64', BENCH_LOAD_PROCESS: '1',
  })) {
    if (process.env[key] !== undefined) equal(process.env[key], value, key);
    process.env[key] = value;
  }
  equal(process.env.BENCH_CONTAINER_IDENTITY, plan.containerIdentity, 'prepared container identity');
  const { environmentSummary } = await import('../../src/provenance');
  const { prepareTimingIdentity } = await import('../../src/timing-identity');
  const { EvidenceJournal } = await import('../../src/evidence');
  const { AVAILABLE_TARGETS } = await import('../../src/targets');
  const { selectSuite } = await import('../../src/suites');
  const environment = await environmentSummary();
  equal(environment.git.sha, plan.head, 'collector head');
  equal(environment.git.dirty, false, 'clean collector');
  equal(environment.bun, '1.4.2', 'installed Bun');
  equal(environment.benchmarkSource.sha256, plan.harnessSha256, 'harness');
  const scenario = selectSuite('stages').find((item) => item.name === 'stage-minimal');
  if (!scenario) throw new AAInputFailure('Missing stage-minimal suite');
  const targets = Object.fromEntries(await Promise.all((['N', 'X', 'Y'] as const).map(async (arm) => {
    const target = AVAILABLE_TARGETS.find((item) => item.name === (arm === 'N' ? 'native-bun' : 'fluo-bun'));
    if (!target) throw new AAInputFailure('Missing Bun target');
    const prepared = await prepareTimingIdentity(target, scenario.appShape);
    equal(prepared.artifactsSha256, plan.targetArtifactsSha256[arm], 'prepared build');
    for (const [path, digest] of Object.entries(prepared.artifacts)) equal(plan.artifacts[path], digest, 'frozen serving input');
    return [arm, target] as const;
  })));
  await mkdir(plan.outputRoot, { recursive: false });
  await writeFile(join(plan.outputRoot, 'plan.json'), bytes, { flag: 'wx' });
  const records: unknown[] = [];
  let active: unknown = null;
  let decision: ReturnType<typeof evaluateAA> | null = null;
  const journal: import('../../src/evidence').EvidenceJournal = new EvidenceJournal(join(plan.outputRoot, 'journal.json'), () => ({
    planSha256: sha256(bytes), environment, records, active, current: journal.current, decision,
  }));
  journal.flush();
  try {
    const { runScenario } = await import('../../src/run');
    for (const [block, arms] of BLOCKS.entries()) {
      for (const [slot, arm] of arms.entries()) {
        const ordinal = block * 4 + slot;
        const samples: import('../../src/report').TargetResult[] = [];
        const startedMs = performance.now();
        active = { ordinal, block, slot, arm, samples };
        try {
          await runScenario(scenario, { index: 0, repeat: ordinal, targets: [targets[arm]], connections: 64, samples, journal });
        } finally {
          await writeFile(join(plan.outputRoot, `run-${ordinal}-${arm}.json`), JSON.stringify({ active, current: journal.current, invalidAttempts: journal.failures }), { flag: 'wx' });
        }
        if (samples.length !== 1) throw new AAInputFailure('Expected exactly one result from runScenario');
        records.push({
          ordinal, block, slot, arm, condition: CONDITION, startedMs, endedMs: performance.now(),
          identity: {
            head: plan.head, frameworkSource: plan.frameworkSource, collectorSha256: plan.collectorSha256,
            harnessSha256: plan.harnessSha256, buildReceiptSha256: plan.buildReceipt.sha256, containerIdentity: plan.containerIdentity,
          }, raw: samples[0],
        });
        active = null;
        journal.flush();
        const check = readRecord(records[ordinal], ordinal, plan);
        if (check.generatorPid === process.pid) throw new AAInputFailure('Generator shares the resource sampler process');
        if (!check.precisionResolved) throw new AAInputFailure('CPU precision metadata is unavailable or differs from freeze; collection stopped');
      }
    }
    decision = evaluateAA(input, { records, invalidAttempts: journal.failures });
    await writeFile(join(plan.outputRoot, 'decision.json'), JSON.stringify(decision, null, 2), { flag: 'wx' });
    return decision;
  } catch (error) {
    if (journal.failures.length === 0) journal.fail(error);
    throw error;
  } finally {
    journal.finish();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, planPath, outputPath] = process.argv.slice(2);
  if ((mode !== '--plan-only' && mode !== '--collect') || !planPath || (mode === '--collect' && !outputPath)) {
    process.stderr.write('Usage: paired-aa.mts --plan-only PLAN | --collect PLAN OUTPUT\n');
    process.exitCode = 1;
  } else {
    collectAA(planPath, outputPath ?? '', mode === '--plan-only').then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if ('verdict' in result && result.verdict !== 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE') process.exitCode = 1;
    }).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
