import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceJournal } from '../evidence.js';
import { load } from '../load.js';
import { runProfiles } from '../profile.js';
import { object, sha256 } from '../profile-report.js';
import { monitorServer } from '../resources.js';
import type { AppShape } from '../scenarios.js';
import { authenticateTimingIdentity, prepareTimingIdentity, TimingIdentityFailure } from '../timing-identity.js';
import { startTargets, stopTargets, type TargetConfig, waitForTarget, WDIR } from '../targets.js';
import { fixture, FIXTURES } from './fixtures.js';
import { evaluate, headroomGate, type Metrics, type Pair, POLICY } from './gates.js';
import { assertFrozen, type Binding, type Hosts, frozenPlan, localBinding, parseHosts } from './manifest.js';

export const RESULTS = join(WDIR, 'results/issue-3942');

export function ownedPath(path: string) {
  const result = isAbsolute(path) ? path : join(WDIR, path);
  const within = relative(RESULTS, result);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new TypeError('Output/input evidence must be inside results/issue-3942');
  return result;
}

export function fixtureTarget(name: string, port: number, executable = process.execPath): TargetConfig {
  fixture(name);
  return {
    name: 'fluo-express', platform: 'express', product: 'fluo', label: `issue-3942/${name}`,
    port, command: executable, args: [`dist/issue-3942/${name}/server.mjs`],
  };
}

export async function correctnessProbe(name: string, origin: string) {
  const observations = [];
  for (const request of fixture(name).scenario.requests) {
    const response = await fetch(`${origin}${request.path}`, {
      method: request.method, headers: request.headers, body: request.body,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    if (response.status !== request.expectedStatus || body !== request.expectedBody) {
      throw new TypeError(`${name}: status/body mismatch: ${response.status} ${body}`);
    }
    if (name === 'native-header-json'
      && (response.headers.get('x-native-number') !== '7'
        || response.headers.get('x-native-array') !== 'first, second'
        || response.headers.get('__proto__') !== 'own-header'
        || response.headers.getSetCookie().join('|') !== 'native=one; Path=/|native=two; Path=/')) {
      throw new TypeError('Native header fixture mismatch');
    }
    observations.push({ path: request.path, status: response.status, body, headers: [...response.headers] });
  }
  return observations;
}

export async function smoke(name: string, port: number) {
  const target = fixtureTarget(name, port);
  let stdout = '';
  const servers = startTargets(fixture(name).scenario.appShape, [target], {
    quiet: true, env: { BENCH_BIND_HOST: '127.0.0.1', ISSUE_3942_CORRECTNESS: '1' },
    onOutput: (_target, stream, bytes) => { if (stream === 'stdout') stdout += bytes.toString(); },
  });
  try {
    await waitForTarget(servers[0]);
    const actualPort = /listening on :(\d+)/.exec(stdout)?.[1];
    if (!actualPort) throw new TypeError('Missing correctness listener readiness');
    return await correctnessProbe(name, `http://127.0.0.1:${actualPort}`);
  } finally { await stopTargets(servers); }
}

type Sample = Awaited<ReturnType<typeof ordinary>>;
export function assertGenerator(value: unknown, hosts: Hosts) {
  const generator = object(Reflect.get(object(value), 'generator'));
  if (generator.hostname !== hosts.generator.hostname || generator.node !== hosts.generator.nodeVersion
    || generator.osRelease !== hosts.generator.kernel || !Array.isArray(generator.cpus)
    || generator.cpus.length === 0 || generator.cpus.some((cpu) => cpu !== hosts.generator.cpu)
    || generator.executable !== hosts.generator.nodeExecutable
    || generator.entrySha256 !== hosts.generatorEntrySha256
    || generator.nodeExecutableSha256 !== hosts.generator.nodeExecutableSha256
    || generator.lockfileSha256 !== hosts.generatorLockfileSha256) {
    throw new TypeError('Measured generator identity differs from frozen host');
  }
}
export async function retainWarmup(value: unknown, hosts: Hosts, path: string) {
  // Retain even an identity-mismatched warmup before refusing the capture.
  await writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx' });
  assertGenerator(value, hosts);
}
export async function prepareOrdinaryIdentity(target: TargetConfig, binding: Pick<Binding, 'builds'>,
  appShape: AppShape = 'read-search-local') {
  const prepared = await prepareTimingIdentity(target, appShape);
  // Include linked serving dependencies, not just the bundled fixture entry.
  const files = [...new Set([...Object.keys(prepared.artifacts),
    ...Object.keys(binding.builds).map((path) => join(WDIR, '../../..', path))])].sort();
  const hashes = Object.fromEntries(await Promise.all(files.map(async (path) => [path, sha256(await readFile(path))])));
  const frozen = Object.fromEntries(Object.entries(binding.builds).map(([path, hash]) => [join(WDIR, '../../..', path), hash]));
  // Each condition must use the original freeze, never a replacement build's new attestation.
  for (const path of new Set([prepared.entry, ...Object.keys(frozen)])) {
    if (hashes[path] !== frozen[path]) {
      throw new TimingIdentityFailure('Frozen serving build drift', { path, expected: frozen[path], actual: hashes[path] });
    }
  }
  return {
    ...prepared, artifacts: hashes, artifactsSha256: sha256(JSON.stringify(hashes)),
    env: { ...prepared.env, BENCH_TIMING_FILES: JSON.stringify(files) },
  };
}

async function ordinary(name: string, connections: number, workers: number, duration: number,
  warmup: number, hosts: Hosts, binding: Binding, logDirectory: string) {
  const url = new URL(hosts.serverOrigin);
  const target = fixtureTarget(name, Number(url.port || 80), hosts.server.nodeExecutable);
  const attestation = await prepareOrdinaryIdentity(target, binding, fixture(name).scenario.appShape);
  let stdout = '';
  const logs = { stdout: '', stderr: '' };
  const servers = startTargets(fixture(name).scenario.appShape, [target], {
    timingIdentity: true, quiet: true,
    env: { ...attestation.env, BENCH_TIMING_NONCE: attestation.nonce, BENCH_BIND_HOST: hosts.bindHost },
    onOutput: (_target, stream, bytes) => {
      if (stream === 'stdout') stdout += bytes.toString();
      // Output is appended below after teardown; buffers are preserved on failure.
      logs[stream] += bytes.toString();
    },
  });
  try {
    await waitForTarget(servers[0]);
    const pid = servers[0].pid;
    if (pid === undefined) throw new TypeError('Missing serving PID');
    const identity = await authenticateTimingIdentity(attestation, stdout, pid, target.port, url.hostname);
    await correctnessProbe(name, hosts.serverOrigin);
    const options = { url: hosts.serverOrigin, connections, requests: fixture(name).scenario.requests };
    const warmupResponse = await load({ ...options, duration: warmup }, `issue-3942/${name}/warmup`);
    await retainWarmup(warmupResponse, hosts, join(logDirectory, 'warmup.json'));
    const measured = await monitorServer(pid, () => Promise.all(Array.from({ length: workers }, (_, worker) =>
      load({ ...options, connections: connections / workers, duration }, `issue-3942/${name}/worker-${worker}`))));
    // A remote load response includes its actual hostname/Node/kernel/CPU.
    for (const value of measured.value) assertGenerator(value, hosts);
    await authenticateTimingIdentity(attestation, stdout, pid, target.port, url.hostname);
    const completed = measured.value.reduce((sum, value) => sum + value.result.requests.total, 0);
    const metrics: Metrics = {
      throughput: measured.value.reduce((sum, value) => sum + value.result.requests.average, 0),
      cpuPerRequest: measured.server.cpuSeconds / completed,
      p95: measured.value.reduce((sum, value) => sum + value.latencyPercentilesMs.p95, 0) / workers,
      p99: measured.value.reduce((sum, value) => sum + value.latencyPercentilesMs.p99, 0) / workers,
      rss: measured.server.peakRssBytes,
    };
    return { name, connections, workers, duration, warmup, warmupResponse, measured, metrics, identity,
      percentileMeaning: 'mean-of-worker-run-percentiles; raw histograms retained, not pooled percentiles' };
  } finally {
    await stopTargets(servers);
    await writeFile(join(logDirectory, 'stdout.log'), logs.stdout, { flag: 'wx' });
    await writeFile(join(logDirectory, 'stderr.log'), logs.stderr, { flag: 'wx' });
  }
}

function assertTransport(hosts: Hosts) {
  if (process.env.ISSUE_3942_LEASE !== hosts.lease || process.env.BENCH_BIND_HOST !== hosts.bindHost
    || process.env.BENCH_SERVER_HOST !== new URL(hosts.serverOrigin).hostname
    || process.env.BENCH_SSH_HOST !== hosts.generatorSshTarget || !process.env.BENCH_REMOTE_DIR) {
    throw new TypeError('Lead-owned lease, bind/server address and preconfigured generator transport are required');
  }
}

async function readOwned(path: string) {
  const bytes = await readFile(ownedPath(path));
  return { bytes, value: object(JSON.parse(bytes.toString())) };
}

// Recompute headroom from raw runs. A lead assessment must bind those exact bytes.
export async function requireHeadroom(path: string, assessmentPath: string, planSha256: string) {
  const raw = await readOwned(path);
  const assessment = await readOwned(assessmentPath);
  if (raw.value.planSha256 !== planSha256 || raw.value.kind !== 'headroom'
    || !Array.isArray(raw.value.samples) || !Array.isArray(raw.value.invalidAttempts)
    || JSON.stringify(raw.value.policy) !== JSON.stringify(POLICY)
    || raw.value.invalidAttempts.length !== 0 || raw.value.samples.length !== 30
    || assessment.value.rawSha256 !== sha256(raw.bytes)
    || assessment.value.bottleneckExcluded !== true || typeof assessment.value.evidencePath !== 'string') {
    throw new TypeError('Fresh complete headroom and raw-bound lead bottleneck assessment required');
  }
  await readOwned(assessment.value.evidencePath);
  for (const name of POLICY.fixtures) {
    const ratios = [];
    for (let pair = 0; pair < POLICY.headroom.pairs; pair++) {
      const rows = raw.value.samples.map(object).filter((row) => row.name === name && row.pair === pair);
      const one = rows.find((row) => row.workers === 1);
      const four = rows.find((row) => row.workers === 4);
      if (rows.length !== 2 || !one || !four) throw new TypeError('Missing or duplicate headroom condition');
      if (rows.some((row) => row.connections !== 64 || row.duration !== POLICY.headroom.captureSeconds
        || row.warmup !== POLICY.headroom.warmupSeconds)) throw new TypeError('Headroom workload drift');
      const a = object(one.metrics).throughput;
      const b = object(four.metrics).throughput;
      if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('Invalid headroom metrics');
      ratios.push(b / a);
    }
    if (headroomGate(ratios, true) !== 'PASS') throw new TypeError(`INCONCLUSIVE headroom: ${name}`);
  }
}

export function calibrationVerdicts(value: unknown, planSha256: string) {
  const raw = object(value);
  if (raw.kind !== 'aa' || raw.planSha256 !== planSha256 || JSON.stringify(raw.policy) !== JSON.stringify(POLICY)
    || !Array.isArray(raw.invalidAttempts) || raw.invalidAttempts.length !== 0
    || !Array.isArray(raw.samples) || raw.samples.length !== 160) {
    throw new TypeError('Complete fresh fixed-policy A/A raw samples required');
  }
  const samples = raw.samples.map(object);
  return POLICY.fixtures.flatMap((name) => POLICY.timing.connections.map((connections) => {
    const pairs: Pair[] = [];
    for (let pair = 0; pair < POLICY.timing.pairs; pair++) {
      const rows = samples.filter((row) => row.name === name && row.connections === connections && row.pair === pair);
      if (rows.length !== 2 || rows[0].side !== (pair % 2 === 0 ? 'a' : 'b')
        || rows[1].side !== (pair % 2 === 0 ? 'b' : 'a')
        || rows.some((row) => row.workers !== 1 || row.duration !== 40 || row.warmup !== 10)) {
        throw new TypeError('A/A condition, duration, repeat or alternating-order drift');
      }
      const a = object(rows.find((row) => row.side === 'a')?.metrics);
      const b = object(rows.find((row) => row.side === 'b')?.metrics);
      function metrics(record: Record<string, unknown>): Metrics {
        const { throughput, cpuPerRequest, p95, p99, rss } = record;
        if ([throughput, cpuPerRequest, p95, p99, rss].some((item) => typeof item !== 'number' || !Number.isFinite(item) || item <= 0)
          || typeof throughput !== 'number' || typeof cpuPerRequest !== 'number'
          || typeof p95 !== 'number' || typeof p99 !== 'number' || typeof rss !== 'number') {
          throw new TypeError('Invalid A/A metrics');
        }
        return { throughput, cpuPerRequest, p95, p99, rss };
      }
      pairs.push({ a: metrics(a), b: metrics(b) });
    }
    return { name, connections, ...evaluate(pairs, 'aa') };
  }));
}

export async function runCalibration(kind: 'headroom' | 'aa', hosts: Hosts, binding: Binding,
  planSha256: string, directory: string) {
  assertTransport(hosts);
  await mkdir(directory); // Never overwrite or repeat-until-pass in an existing evidence directory.
  const samples: (Sample & { readonly pair: number; readonly side: 'a' | 'b' })[] = [];
  const journal = new EvidenceJournal(join(directory, 'raw.json'), () => ({
    kind, policy: POLICY, planSha256, samples, status: 'NOT_ESTABLISHED',
  }));
  try {
    for (const name of POLICY.fixtures) {
      for (const connections of kind === 'aa' ? POLICY.timing.connections : [64]) {
        for (let pair = 0; pair < (kind === 'aa' ? POLICY.timing.pairs : POLICY.headroom.pairs); pair++) {
          for (const side of pair % 2 === 0 ? ['a', 'b'] as const : ['b', 'a'] as const) {
            const workers = kind === 'headroom' && side === 'b' ? 4 : 1;
            const condition = { name, connections, pair, side, workers };
            const logs = join(directory, `${name}-${connections}-${pair}-${side}`);
            await mkdir(logs);
            await journal.record(condition, samples, async (complete) => {
              const sample = await ordinary(name, connections, workers,
                kind === 'aa' ? POLICY.timing.captureSeconds : POLICY.headroom.captureSeconds,
                kind === 'aa' ? POLICY.timing.warmupSeconds : POLICY.headroom.warmupSeconds,
                hosts, binding, logs);
              complete({ ...sample, pair, side });
            });
            journal.flush();
          }
        }
      }
    }
    if (kind === 'aa') {
      const rawPath = join(directory, 'raw.json');
      const raw = await readFile(rawPath);
      const verdicts = calibrationVerdicts(JSON.parse(raw.toString()), planSha256);
      await writeFile(join(directory, 'verdict.json'), JSON.stringify({
        planSha256, rawPath: relative(WDIR, rawPath), rawSha256: sha256(raw), verdicts,
      }, null, 2), { flag: 'wx' });
      if (verdicts.some((verdict) => verdict.status !== 'PASS')) throw new TypeError('INCONCLUSIVE calibration; candidate timing prohibited');
    }
  } finally { journal.finish(); }
}

async function main() {
  const [command, first, second, third, fourth] = process.argv.slice(2);
  if (command === 'prepare') {
    if (!first) throw new TypeError('prepare requires an issue-owned output file');
    const binding = await localBinding();
    await writeFile(ownedPath(first), JSON.stringify({
      kind: 'measurement-preparation', status: 'AWAITING_LEAD_MEASUREMENT',
      policy: POLICY, binding, missing: ['lead host/lease/control manifest', 'fresh headroom', 'fresh A/A', 'real-request profiles'],
    }, null, 2), { flag: 'wx' });
    return;
  }
  if (command === 'smoke') {
    const port = Number(first);
    if (!Number.isSafeInteger(port) || port < 0) throw new TypeError('Smoke requires a nonnegative port (0 selects an ephemeral listener)');
    const probes = [];
    for (const item of FIXTURES) probes.push({ name: item.name, responses: await smoke(item.name, port) });
    await writeFile(join(RESULTS, 'correctness-smoke.json'), JSON.stringify({
      kind: 'correctness-only', performanceEvidence: false, probes,
    }, null, 2), { flag: 'wx' });
    return;
  }
  if (!first || !second) throw new TypeError('Expected freeze HOSTS PLAN, headroom PLAN DIR, aa PLAN DIR HEADROOM ASSESSMENT, profile PLAN DIR AA_VERDICT');
  const binding = await localBinding();
  if (command === 'freeze') {
    const hosts = parseHosts((await readOwned(first)).value);
    await writeFile(ownedPath(second), JSON.stringify(frozenPlan(hosts, binding), null, 2), { flag: 'wx' });
    return;
  }
  const plan = await readOwned(first);
  const hosts = assertFrozen(plan.value, binding);
  const planSha256 = sha256(plan.bytes);
  assertTransport(hosts);
  if (command === 'headroom' || command === 'aa') {
    if (command === 'aa') {
      if (!third || !fourth) throw new TypeError('A/A requires HEADROOM raw.json and ASSESSMENT');
      await requireHeadroom(third, fourth, planSha256);
    }
    await runCalibration(command, hosts, binding, planSha256, ownedPath(second));
    return;
  }
  if (command === 'profile') {
    if (!third) throw new TypeError('Profile requires calibrated A/A verdict');
    const aa = (await readOwned(third)).value;
    if (aa.planSha256 !== planSha256 || typeof aa.rawPath !== 'string' || typeof aa.rawSha256 !== 'string') {
      throw new TypeError('Successful fresh A/A required before profiling');
    }
    const rawAa = await readOwned(aa.rawPath);
    if (sha256(rawAa.bytes) !== aa.rawSha256
      || calibrationVerdicts(rawAa.value, planSha256).some((verdict) => verdict.status !== 'PASS')) {
      throw new TypeError('Successful raw-bound fresh A/A required before profiling');
    }
    // Profile output remains under the established profiler root; no shared UUID outputs.
    if (!/^[a-zA-Z0-9_-]+$/.test(second)) throw new TypeError('Profile run name must be a simple unique label');
    const directory = join(WDIR, 'results/profiling/issue-3942', second);
    await mkdir(join(WDIR, 'results/profiling/issue-3942'), { recursive: true });
    await mkdir(directory, { recursive: false });
    const profileResults = [];
    for (const name of POLICY.fixtures) {
      const target = fixtureTarget(name, Number(new URL(hosts.serverOrigin).port), hosts.server.nodeExecutable);
      const result = await runProfiles({
        targets: [target], scenarios: [fixture(name).scenario], modes: POLICY.profile.modes,
        configuration: 'default', connections: POLICY.profile.connections, repeats: POLICY.profile.repeats,
        warmupSeconds: POLICY.profile.warmupSeconds, durationSeconds: POLICY.profile.captureSeconds,
        controlSeconds: POLICY.profile.controlSeconds, portBase: target.port - 4, inspectorPortBase: target.port + 100,
        outputDirectory: join(directory, name),
      });
      profileResults.push(result);
      for (const capture of result.captures) {
        for (const run of capture.runs) assertGenerator(run.value, hosts);
        if (capture.subject?.runtime.node !== hosts.server.nodeVersion.slice(1)) {
          throw new TypeError('Profile serving runtime differs from frozen server');
        }
      }
      assertFrozen(plan.value, await localBinding());
    }
    await writeFile(join(directory, 'issue-manifest.json'), JSON.stringify({
      planSha256, status: 'PROFILE_CAPTURED_NOT_CANDIDATE_SELECTED', profileResults,
    }, null, 2), { flag: 'wx' });
    if (profileResults.some((result) => result.coverage.status !== 'complete')) {
      throw new TypeError('INCONCLUSIVE profile validity; no candidate selection');
    }
    return;
  }
  throw new TypeError(`Unknown command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
