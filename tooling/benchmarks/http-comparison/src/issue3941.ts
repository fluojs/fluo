import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { object, sha256 } from './profile-report';
import { environmentSummary, sourceSnapshot, WORKSPACE_ROOT } from './provenance';
import { summarize } from './report';
import { SCENARIOS } from './scenarios';
import { TARGETS, WDIR } from './targets';
import { prepareTimingIdentity } from './timing-identity';

const policy = Object.freeze({
  version: 1, issue: 3941, target: 'fluo-fastify', pairs: 5,
  preflightSha256: 'b60b5ea4ddd154a0b233f328ef4ef88df584e9cddaef036e9e05c217fc5bece5',
  workloads: Object.freeze(['read-search-local', 'json-command-local', 'rest-route-mix-local']),
  configurations: Object.freeze(['default', 'equivalent']), connections: Object.freeze([1, 64]),
  warmupSeconds: 10, measurementSeconds: 40, freshProcessPerSample: true,
  aaCv: 0.03, aaThroughputCpuDrift: 0.03, aaLatencyRssDrift: 0.05,
  headroom: Object.freeze({ workers: Object.freeze([1, 4]), connections: 64, repeats: 3, warmupSeconds: 3, measurementSeconds: 10, meanScaling: 0.03, eachRepeatScaling: 0.05 }),
  profiles: Object.freeze({ modes: Object.freeze(['cpu', 'allocation']), connections: 64, repeats: 1, warmupSeconds: 10, captureSeconds: 40, controlSeconds: 40 }),
  primary: 'read-search-local/equivalent/64', minimumGain: 0.03,
  comparison: Object.freeze({ measurements: 120, pairsPerCondition: 5, order: Object.freeze(['BEFORE/AFTER', 'AFTER/BEFORE', 'BEFORE/AFTER', 'AFTER/BEFORE', 'BEFORE/AFTER']) }),
  regression: Object.freeze({ throughput: 0.03, cpu: 0.03, p95: 0.05, p99: 0.05, rss: 0.05 }),
  interval: Object.freeze({ method: 'paired-mean-relative-change-percentile-bootstrap', confidence: 0.95, seed: 3941, resamples: 10000 }),
  automaticAdditionalRepeats: 0, outlierDeletionAllowed: false, maximumCandidates: 1,
  candidateSelection: 'only-after-lead-calibration-and-real-request-profiles',
  diagnosticCounters: 'separate-from-ordinary-timing; native-hit/full/fallback/declined/headers-getter',
  adoption: 'primary gain > max(minimumGain, calibrated noise envelope), lower CI > 0; every regression upper CI within budget; all behavioral gates pass',
});
type Pair = { readonly left: number; readonly right: number };
type Metric = keyof typeof policy.regression;
type Run = { readonly phase: 'aa' | 'headroom' | 'profile'; readonly scenario: string; readonly configuration: string; readonly connections: number; readonly pair: number; readonly arm: string };
const fields = {
  server: ['physicalHost', 'osCpu', 'runtime', 'executable', 'executableSha256', 'affinityPower'],
  generator: ['physicalHost', 'osCpu', 'runtime', 'executable', 'executableSha256', 'affinityPower'],
  source: ['head', 'packagesSha256', 'benchmarkSha256', 'buildSha256', 'workspaceLockSha256', 'benchmarkLockSha256', 'generatorLockSha256', 'generatorInstalledLockSha256', 'generatorClientSha256', 'generatorDependenciesSha256', 'preparedSha256'],
  transport: ['BENCH_SSH_HOST', 'BENCH_REMOTE_DIR', 'BENCH_SERVER_HOST', 'BENCH_BIND_HOST', 'networkPath'],
} as const;
type Identities = { readonly [K in keyof typeof fields]: Readonly<Record<string, string>> };
type Plan = ReturnType<typeof Issue3941.freeze>;
const outputRoot = join(WDIR, 'results/issue3941');

function pairsChecked(pairs: readonly Pair[], count: number): void {
  if (pairs.length !== count || pairs.some(({ left, right }) => !Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0)) {
    throw new TypeError(`Expected exactly ${count} positive finite pairs; no missing samples or outlier deletion`);
  }
}

/** Issue-owned preparation; numeric gates alone never establish adoption. */
export class Issue3941 {
  static readonly policy = policy;

  static freeze(input: unknown) {
    const raw = object(input);
    const identities = Object.fromEntries(Object.entries(fields).map(([section, keys]) => {
      if (typeof raw[section] !== 'object' || raw[section] === null || Array.isArray(raw[section])) throw new TypeError(`Missing identity section: ${section}`);
      const record = object(raw[section]);
      const entries: (readonly [string, string])[] = keys.map((key) => {
        const value = record[key];
        if (typeof value !== 'string' || value.trim().length === 0 || value === 'unknown') throw new TypeError(`Missing real identity: ${section}.${key}`);
        if (key.endsWith('Sha256') && !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`Invalid digest: ${section}.${key}`);
        if (key === 'head' && !/^[a-f0-9]{40}$/.test(value)) throw new TypeError('Invalid source head');
        return [key, value] as const;
      });
      const control = section === 'transport' ? record.BENCH_SSH_CONTROL : undefined;
      if (control !== undefined) {
        if (typeof control !== 'string' || control.length === 0) throw new TypeError('Invalid BENCH_SSH_CONTROL');
        entries.push(['BENCH_SSH_CONTROL', control]);
      }
      if (Object.keys(record).length !== entries.length) throw new TypeError(`Unexpected identity fields: ${section}`);
      return [section, Object.freeze(Object.fromEntries(entries))] as const;
    }));
    if (Object.keys(raw).length !== 4) throw new TypeError('Unexpected identity sections');
    // Each section was constructed from the exact field inventory above.
    const bound: Identities = { server: identities.server, generator: identities.generator, source: identities.source, transport: identities.transport };
    const runs: Run[] = [];
    for (const scenario of policy.workloads) for (const configuration of policy.configurations) {
      for (const connections of policy.connections) for (let pair = 0; pair < policy.pairs; pair++) {
        for (const arm of pair % 2 === 0 ? ['A1', 'A2'] : ['A2', 'A1']) runs.push(Object.freeze({ phase: 'aa', scenario, configuration, connections, pair, arm }));
      }
      runs.push(Object.freeze({ phase: 'headroom', scenario, configuration, connections: 64, pair: 0, arm: 'diagnostic-only' }));
    }
    for (const configuration of policy.configurations) runs.push(Object.freeze({ phase: 'profile', scenario: policy.workloads.join(','), configuration, connections: 64, pair: 0, arm: 'diagnostic-only' }));
    const body = { policy, identities: Object.freeze(bound), runs: Object.freeze(runs) };
    return Object.freeze({ ...body, sha256: sha256(JSON.stringify(body)) });
  }

  static parse(input: unknown): Plan {
    const raw = object(input);
    const expected = Issue3941.freeze(raw.identities);
    if (!isDeepStrictEqual(raw, expected)) throw new TypeError('Changed frozen policy, identities, schedule or digest');
    return expected;
  }

  static command(plan: Plan, slot: number, planPath = join(outputRoot, 'frozen-plan.json'), preparedPath = join(outputRoot, 'prepared-build.json'), aaReceipt?: unknown) {
    const run = plan.runs[slot];
    if (!Number.isSafeInteger(slot) || !run) throw new TypeError('Unknown finite schedule slot');
    if (run.phase === 'profile') throw new TypeError('Profiles require lead calibration receipt; use profile command');
    if (run.phase === 'headroom') {
      if (aaReceipt === undefined) throw new TypeError('Headroom requires complete source-bound A/A evaluation');
      const receipt = object(aaReceipt);
      if (receipt.status !== 'PASS_NUMERIC_GATE_ONLY' || receipt.planSha256 !== plan.sha256
        || !Array.isArray(receipt.artifacts) || receipt.artifacts.length !== 120) throw new TypeError('Headroom requires complete source-bound A/A evaluation');
    }
    const name = `${slot}-${run.phase}-${run.scenario}-${run.configuration}-${run.connections}-${run.pair}-${run.arm}.json`;
    return {
      command: plan.identities.server.executable,
      args: run.phase === 'aa' ? ['--import', 'tsx', 'results/issue3941/collector.ts', 'arm', planPath, preparedPath, String(slot)] : ['--import', 'tsx', 'src/headroom.ts'],
      cwd: WDIR,
      env: {
        BENCH_TARGETS: policy.target, BENCH_SUITE: 'business', BENCH_SCENARIOS: run.scenario,
        BENCH_CONFIGURATION: run.configuration, BENCH_CONNECTIONS: String(run.connections),
        BENCH_WARMUP_SEC: String(policy.warmupSeconds), BENCH_MEASURE_SEC: String(policy.measurementSeconds),
        BENCH_RUNS: '1', BENCH_LOAD_PROCESS: '1', BENCH_OUTPUT_JSON: join(outputRoot, plan.sha256, name),
        BENCH_SSH_HOST: plan.identities.transport.BENCH_SSH_HOST, BENCH_REMOTE_DIR: plan.identities.transport.BENCH_REMOTE_DIR,
        BENCH_SERVER_HOST: plan.identities.transport.BENCH_SERVER_HOST, BENCH_BIND_HOST: plan.identities.transport.BENCH_BIND_HOST,
        ...(plan.identities.transport.BENCH_SSH_CONTROL ? { BENCH_SSH_CONTROL: plan.identities.transport.BENCH_SSH_CONTROL } : {}),
      } satisfies Record<string, string>,
      prerequisites: ['lead serial host reservation', 'one clean prepared dependency/server build before cohort freeze; before/after arm hash authentication', 'reject existing output; preserve stdout/stderr and invalidAttempts', 'clear inherited BENCH_* variables, NODE_OPTIONS and profiling/preload instrumentation', 'deploy issue-owned generator as load-client.mjs and freeze its actual executable/hash/version/lock/client identity'],
    };
  }

  static pairedInterval(pairs: readonly Pair[]) {
    pairsChecked(pairs, policy.pairs);
    const changes = pairs.map(({ left, right }) => right / left - 1);
    let state = policy.interval.seed;
    const draws = Array.from({ length: policy.interval.resamples }, () => {
      let sum = 0;
      for (let index = 0; index < pairs.length; index++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        sum += changes[(state >>> 0) % pairs.length];
      }
      return sum / pairs.length;
    }).sort((a, b) => a - b);
    return { count: pairs.length, mean: summarize(changes).mean, lower: draws[249], upper: draws[9749] };
  }

  static calibration(pairs: readonly Pair[], limit: 0.03 | 0.05) {
    pairsChecked(pairs, policy.pairs);
    if (limit !== policy.aaThroughputCpuDrift && limit !== policy.aaLatencyRssDrift) throw new TypeError('Frozen drift limit required');
    const left = summarize(pairs.map((pair) => pair.left));
    const right = summarize(pairs.map((pair) => pair.right));
    const leftCv = (left.standardDeviation ?? 0) / left.mean;
    const rightCv = (right.standardDeviation ?? 0) / right.mean;
    const drift = Math.abs(right.mean / left.mean - 1);
    const stable = limit === policy.aaLatencyRssDrift || (leftCv <= policy.aaCv && rightCv <= policy.aaCv);
    return { status: stable && drift <= limit ? 'PASS_NUMERIC_GATE_ONLY' : 'FAIL', leftCv, rightCv, drift, interval: Issue3941.pairedInterval(pairs) };
  }

  static headroom(plan: Plan, pairs: readonly Pair[]) {
    pairsChecked(pairs, policy.headroom.repeats);
    const scaling = pairs.map(({ left, right }) => right / left - 1);
    const mean = summarize(scaling).mean;
    const status = plan.identities.server.physicalHost === plan.identities.generator.physicalHost ? 'INCONCLUSIVE'
      : mean <= policy.headroom.meanScaling && scaling.every((value) => value <= policy.headroom.eachRepeatScaling) ? 'PASS_NUMERIC_GATE_ONLY' : 'FAIL';
    return { status, mean, scaling, requiredAdditionalEvidence: ['concurrency-1 generator capacity/burst', 'server utilization', 'absence of generator saturation/contention'] };
  }

  static comparison(rows: readonly { readonly condition: string; readonly metrics: Readonly<Record<Metric, readonly Pair[]>> }[], noiseEnvelope: number) {
    const expected = policy.workloads.flatMap((scenario) => policy.configurations.flatMap((configuration) => policy.connections.map((connections) => `${scenario}/${configuration}/${connections}`)));
    if (!Number.isFinite(noiseEnvelope) || noiseEnvelope < 0 || rows.length !== expected.length
      || new Set(rows.map((row) => row.condition)).size !== expected.length || rows.some((row) => !expected.includes(row.condition))) throw new TypeError('Complete frozen comparison matrix and calibrated noise envelope required');
    const observations = rows.map((row) => ({
      condition: row.condition,
      metrics: (['throughput', 'cpu', 'p95', 'p99', 'rss'] as const).map((metric) => {
        const budget = policy.regression[metric];
        const pairs = row.metrics[metric];
        const interval = Issue3941.pairedInterval(pairs);
        const regressionUpper = metric === 'throughput' ? -interval.lower : interval.upper;
        return { metric, budget, interval, regressionUpper, passes: regressionUpper <= budget };
      }),
    }));
    const primary = observations.find((row) => row.condition === policy.primary)?.metrics.find((metric) => metric.metric === 'throughput');
    if (!primary) throw new TypeError('Missing primary condition');
    const gains = primary.interval.mean > Math.max(policy.minimumGain, noiseEnvelope) && primary.interval.lower > 0;
    return { status: observations.every((row) => row.metrics.every((metric) => metric.passes)) && gains ? 'PASS_NUMERIC_GATE_ONLY' : 'INCONCLUSIVE_OR_REJECT',
      observations, primaryGain: primary.interval, requiredGain: Math.max(policy.minimumGain, noiseEnvelope),
      requires: ['raw schema-3 authentication', 'source-bound A/A and independent headroom', 'real-request profiles and separate route counters', 'all behavioral gates'] };
  }

  static async assertCurrent(plan: Plan): Promise<void> {
    const source = plan.identities.source;
    const environment = await environmentSummary();
    const observed = {
      head: environment.git.sha,
      packagesSha256: sha256(JSON.stringify(await sourceSnapshot(join(WORKSPACE_ROOT, 'packages')))),
      benchmarkSha256: environment.benchmarkSource.sha256,
      workspaceLockSha256: sha256(await readFile(join(WORKSPACE_ROOT, 'pnpm-lock.yaml'))),
      benchmarkLockSha256: sha256(await readFile(join(WDIR, 'pnpm-lock.yaml'))),
    };
    for (const [key, value] of Object.entries(observed)) if (source[key] !== value) throw new TypeError(`Calibration identity drift: ${key}`);
    if (process.execPath !== plan.identities.server.executable || process.version !== plan.identities.server.runtime
      || sha256(await readFile(process.execPath)) !== plan.identities.server.executableSha256) throw new TypeError('Server runtime identity drift');
    const target = TARGETS.find((item) => item.name === policy.target);
    if (!target) throw new TypeError('Missing Fastify target');
    const build = await prepareTimingIdentity(target);
    if (build.artifactsSha256 !== source.buildSha256) throw new TypeError('Serving build identity drift');
  }

  static async profile(plan: Plan, slot: number, input: unknown) {
    const run = plan.runs[slot];
    if (!run || run.phase !== 'profile') throw new TypeError('Unknown profile slot');
    const receipt = object(input);
    if (receipt.verdict !== 'PASS' || receipt.planSha256 !== plan.sha256 || receipt.sourceSha256 !== plan.identities.source.packagesSha256) throw new TypeError('Successful source-bound lead calibration required');
    // Lead owns acceptance. Authenticate its immutable evidence references, not a boolean assertion.
    if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length < 128) throw new TypeError('120 A/A + 6 headroom + concurrency-1/utilization artifacts required');
    const paths = new Set<string>();
    for (const item of receipt.artifacts) {
      const artifact = object(item);
      if (typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string'
        || sha256(await readFile(artifact.path)) !== artifact.sha256) throw new TypeError('Missing or changed calibration artifact');
      const path = await realpath(artifact.path);
      if (relative(outputRoot, path).startsWith('..') || paths.has(path)) throw new TypeError('Calibration artifacts must be distinct issue-owned files');
      paths.add(path);
    }
    await Issue3941.assertCurrent(plan);
    for (const [key, value] of Object.entries(plan.identities.transport)) {
      if (key.startsWith('BENCH_') && process.env[key] !== value) throw new TypeError(`Profile transport identity drift: ${key}`);
    }
    const { runProfiles } = await import('./profile');
    const outputDirectory = join(WDIR, 'results/profiling/issue3941', plan.sha256, run.configuration);
    await mkdir(join(outputDirectory, '..'), { recursive: true });
    await mkdir(outputDirectory); // EEXIST prevents repeat-until-pass and raw artifact overwrites.
    return runProfiles({
      targets: TARGETS.filter((target) => target.name === policy.target), scenarios: SCENARIOS,
      modes: ['cpu', 'allocation'], configuration: run.configuration === 'default' ? 'default' : 'equivalent',
      connections: 64, repeats: 1, warmupSeconds: 10, durationSeconds: 40, controlSeconds: 40,
      portBase: 35141, inspectorPortBase: 35241,
      outputDirectory,
    });
  }
}

async function main(): Promise<void> {
  const [action, path, slot, receipt] = process.argv.slice(2);
  const input: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (action === 'freeze') {
    const plan = Issue3941.freeze(input);
    await Issue3941.assertCurrent(plan);
    const { Issue3941Collector } = await import('../results/issue3941/collector');
    await Issue3941Collector.assertPrepared(plan, JSON.parse(await readFile(slot, 'utf8')));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const plan = Issue3941.parse(input);
  if (action === 'command') {
    await Issue3941.assertCurrent(plan);
    const { Issue3941Collector } = await import('../results/issue3941/collector');
    await Issue3941Collector.assertPrepared(plan, JSON.parse(await readFile(receipt ?? join(outputRoot, 'prepared-build.json'), 'utf8')));
    const aa = plan.runs[Number(slot)]?.phase === 'headroom' ? await Issue3941Collector.evaluateFiles(plan) : undefined;
    process.stdout.write(`${JSON.stringify(Issue3941.command(plan, Number(slot), path, receipt, aa), null, 2)}\n`);
    return;
  }
  if (action === 'profile') {
    const result = await Issue3941.profile(plan, Number(slot), JSON.parse(await readFile(receipt, 'utf8')));
    process.stdout.write(`${JSON.stringify(result.coverage)}\n`);
    if (result.coverage.status !== 'complete') process.exitCode = 1;
    return;
  }
  throw new TypeError('Use freeze <identities.json>, command <plan.json> <slot>, or profile <plan.json> <slot> <lead-calibration.json>');
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
