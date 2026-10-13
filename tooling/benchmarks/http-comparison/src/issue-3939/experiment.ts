import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EvidenceJournal, failureEvidence } from '../evidence';
import { load } from '../load';
import { runProfiles } from '../profile';
import { object, sha256 } from '../profile-report';
import { environmentSummary } from '../provenance';
import { monitorServer } from '../resources';
import { startTargets, stopTargets, type TargetConfig, WDIR, waitForTarget } from '../targets';
import { authenticateTimingIdentity, prepareTimingIdentity } from '../timing-identity';
import { fixtureRequest } from './fixtures';
import { assertFrozenDesign, DESIGN, DESIGN_SHA256, ExperimentInputFailure, parseHostIdentities } from './plan';
import { evaluateRawIndex, type ShardReference, writeRawShard } from './storage';

const ROOT = join(WDIR, 'results/issue-3939');
const ENTRY = 'dist/issue-3939/server.mjs';

function contained(path: string): string {
  const absolute = resolve(path);
  const inside = relative(ROOT, absolute);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
    throw new ExperimentInputFailure('Output must be a new child of results/issue-3939');
  }
  return absolute;
}

async function packageArtifacts(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') files.push(...await packageArtifacts(path));
    else if (entry.isFile() && /\.(ts|js|mjs|cjs|json)$/.test(path)) files.push(path);
  }
  return files;
}

export async function sourceBuildIdentity() {
  const environment = await environmentSummary();
  const prepared = await prepareTimingIdentity(target(35_711));
  const pending = [{ name: '@fluojs/platform-nodejs', path: join(WDIR, 'node_modules/@fluojs/platform-nodejs') }];
  const packages = new Set<string>();
  const linked: string[] = [];
  for (const { name, path } of pending) {
    if (packages.has(name)) continue;
    packages.add(name);
    const directory = await realpath(path);
    const manifest = object(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')));
    pending.push(...Object.keys(object(manifest.dependencies ?? {})).filter((dependency) => dependency.startsWith('@fluojs/'))
      .map((dependency) => ({ name: dependency, path: join(directory, 'node_modules', dependency) })));
    linked.push(...await packageArtifacts(join(directory, 'dist')));
    linked.push(...await packageArtifacts(join(directory, 'src')));
  }
  const files = [...new Set([...Object.keys(prepared.artifacts), ...linked])].sort();
  const artifacts = Object.fromEntries(await Promise.all(files.map(async (path) => [path, sha256(await readFile(path))] as const)));
  return { environment, prepared: {
    ...prepared, artifacts, artifactsSha256: sha256(JSON.stringify(artifacts)),
    env: { ...prepared.env, BENCH_TIMING_FILES: JSON.stringify(files) },
  } };
}

function target(port: number): TargetConfig {
  return { name: 'fluo-nodejs', platform: 'nodejs', product: 'fluo', label: 'issue-3939-node-response',
    port, command: process.execPath, args: [ENTRY] };
}

export async function freeze(identitiesPath: string, outputPath: string) {
  const identities = parseHostIdentities(JSON.parse(await readFile(identitiesPath, 'utf8')));
  if (identities.server.hostname !== hostname()
    || identities.server.nodeVersion !== process.version
    || identities.server.nodeExecutable !== await realpath(process.execPath)
    || identities.server.nodeExecutableSha256 !== sha256(await readFile(process.execPath))) {
    throw new ExperimentInputFailure('Declared server identity differs from the actual freeze process');
  }
  const source = await sourceBuildIdentity();
  if (identities.generator.clientEntrySha256 !== sha256(await readFile(join(WDIR, 'dist/issue-3939/load-client.mjs')))) {
    throw new ExperimentInputFailure('Generator entry differs from the issue-owned compiled client');
  }
  const output = contained(outputPath);
  await mkdir(dirname(output), { recursive: true });
  const manifest = { status: 'FROZEN', design: DESIGN, designSha256: DESIGN_SHA256, identities,
    source: { git: source.environment.git, lockfiles: source.environment.lockfiles,
      benchmarkSourceSha256: source.environment.benchmarkSource.sha256,
      artifacts: source.prepared.artifacts, artifactsSha256: source.prepared.artifactsSha256 },
    environment: source.environment };
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(output, bytes, { flag: 'wx' });
  return { manifest: output, sha256: sha256(bytes), status: 'FROZEN_NOT_MEASURED' };
}

async function readManifest(path: string) {
  const input = object(JSON.parse(await readFile(contained(path), 'utf8')));
  assertFrozenDesign(input);
  if (input.status !== 'FROZEN') throw new ExperimentInputFailure('Manifest is not frozen');
  const identities = parseHostIdentities(input.identities);
  const source = await sourceBuildIdentity();
  const declared = object(input.source);
  if (!isDeepStrictEqual(declared.git, source.environment.git)
    || !isDeepStrictEqual(declared.lockfiles, source.environment.lockfiles)
    || declared.benchmarkSourceSha256 !== source.environment.benchmarkSource.sha256
    || declared.artifactsSha256 !== source.prepared.artifactsSha256
    || !isDeepStrictEqual(declared.artifacts, source.prepared.artifacts)) {
    throw new ExperimentInputFailure('Frozen source/build/lockfile identity drift');
  }
  if (identities.server.hostname !== hostname() || identities.server.nodeVersion !== process.version
    || identities.server.nodeExecutableSha256 !== sha256(await readFile(process.execPath))) {
    throw new ExperimentInputFailure('Frozen server runtime drift');
  }
  if ('BENCH_DIAGNOSTIC_DRIFT' in process.env) throw new ExperimentInputFailure('Diagnostic instrumentation is forbidden in ordinary timing');
  return { identities, source };
}

function configureTransport(identities: ReturnType<typeof parseHostIdentities>) {
  process.env.BENCH_BIND_HOST = identities.bindHost;
  process.env.BENCH_SERVER_HOST = identities.serverHost;
  process.env.BENCH_SSH_HOST = identities.sshHost;
  process.env.BENCH_REMOTE_DIR = identities.remoteDirectory;
}

export function assertGenerator(value: unknown, expected: ReturnType<typeof parseHostIdentities>['generator']): void {
  const observed = object(object(value).generator);
  for (const field of ['hostname', 'nodeVersion', 'nodeExecutable', 'nodeExecutableSha256', 'lockfileSha256', 'clientEntrySha256']) {
    if (observed[field] !== expected[field]) throw new ExperimentInputFailure(`Generator identity drift: ${field}`);
  }
  if (!Number.isSafeInteger(observed.pid) || Number(observed.pid) <= 0) {
    throw new ExperimentInputFailure('Missing actual generator PID');
  }
}

export async function collect(manifestPath: string, outputPath: string, phase: 'aa' | 'headroom') {
  const frozen = await readManifest(manifestPath);
  configureTransport(frozen.identities);
  const output = contained(outputPath);
  await mkdir(output, { recursive: false });
  const records: ShardReference[] = [];
  let failureOrdinal = 0;
  const manifestSha256 = sha256(await readFile(manifestPath));
  const journal = new EvidenceJournal(join(output, 'raw.json'), () => ({
    kind: 'issue-3939-raw-shards-v1',
    issue: 3939, phase, manifestSha256, designSha256: DESIGN_SHA256, records, verdict: 'NOT_EVALUATED',
  }));
  try {
    for (const fixture of DESIGN.fixtures) {
      for (const configuration of DESIGN.configurations) {
        for (const connections of phase === 'aa' ? DESIGN.connections : [64]) {
          const repeats = phase === 'aa' ? DESIGN.pairedRepeats : DESIGN.headroom.repeats;
          for (let repeat = 0; repeat < repeats; repeat += 1) {
            const arms = phase === 'aa' ? DESIGN.pairOrder[repeat] : repeat % 2 === 0 ? ['1', '4'] : ['4', '1'];
            for (const arm of arms) {
              const condition = { fixture: fixture.name, configuration, connections, repeat, arm };
              await journal.record(condition, records, async (complete) => {
                try {
                const fresh = await readManifest(manifestPath);
                const selected = target(35_711);
                const prepared = fresh.source.prepared;
                let stdout = '';
                const children = startTargets('stage-minimal', [selected], {
                  timingIdentity: true, quiet: true,
                  env: { ...prepared.env, BENCH_TIMING_NONCE: prepared.nonce, BENCH_CONFIGURATION: configuration },
                  onOutput: (_target, stream, bytes) => {
                    if (stream === 'stdout') stdout += bytes.toString();
                  },
                });
                try {
                  await waitForTarget(children[0]);
                  const pid = children[0].pid;
                  if (pid === undefined) throw new ExperimentInputFailure('Missing serving PID');
                  const identity = await authenticateTimingIdentity(prepared, stdout, pid, selected.port, frozen.identities.serverHost);
                  const options = { url: `http://${frozen.identities.serverHost}:${selected.port}`, connections,
                    requests: [fixtureRequest(fixture.name)] };
                  const warmup = await load({ ...options, duration: phase === 'aa' ? DESIGN.warmupSeconds : DESIGN.headroom.warmupSeconds }, 'issue-3939-warmup');
                  assertGenerator(warmup, frozen.identities.generator);
                  const workers = phase === 'aa' ? 1 : Number(arm);
                  const measured = await monitorServer(pid, () => Promise.all(Array.from({ length: workers }, async (_, worker) => {
                    const measurement = await load({ ...options, connections: connections / workers,
                      duration: phase === 'aa' ? DESIGN.measurementSeconds : DESIGN.headroom.durationSeconds }, `issue-3939-${arm}-${worker}`);
                    assertGenerator(measurement, frozen.identities.generator);
                    return measurement;
                  })));
                  const identityAfter = await authenticateTimingIdentity(prepared, stdout, pid, selected.port, frozen.identities.serverHost);
                  complete(writeRawShard(output, `record-${records.length}.json`, { condition, warmup, identity, identityAfter, ...measured }));
                  journal.flush();
                } finally {
                  await stopTargets(children);
                }
                } catch (error) {
                  const reference = writeRawShard(output, `failure-${failureOrdinal++}.json`, { condition, error: failureEvidence(error) });
                  const failure = new Error('Collector failed; original diagnostics retained in immutable shard');
                  Object.assign(failure, { code: reference });
                  throw failure;
                }
              });
            }
          }
        }
      }
    }
  } finally {
    journal.finish();
  }
  return { output, status: 'RAW_NOT_EVALUATED' };
}

// This entry only prepares/calibrates/profiles BEFORE. No candidate or A/B run is
// reachable here until the lead resumes implementation with accepted evidence.
export async function profiles(manifestPath: string, calibrationPath: string, outputPath: string) {
  const frozen = await readManifest(manifestPath);
  const calibration = object(JSON.parse(await readFile(contained(calibrationPath), 'utf8')));
  if (calibration.manifestSha256 !== sha256(await readFile(manifestPath))
    || calibration.aa !== 'CALIBRATED' || calibration.headroom !== 'ESTABLISHED') {
    throw new ExperimentInputFailure('Lead-accepted same-manifest A/A and independent headroom required');
  }
  configureTransport(frozen.identities);
  const output = resolve(outputPath);
  const inside = relative(join(WDIR, 'results/profiling/issue-3939'), output);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new ExperimentInputFailure('Issue-owned profile output required');
  await mkdir(output, { recursive: false });
  const results = [];
  for (const configuration of DESIGN.configurations) {
    for (const connections of DESIGN.connections) {
      const result = await runProfiles({
        targets: [target(35_711)],
        // appShape is launch bookkeeping only; the issue-owned server registers
        // ResponseModule, never the shared stage fixture.
        scenarios: DESIGN.fixtures.map((fixture) => ({
          appShape: 'stage-minimal', name: fixture.name, description: '#3939 frozen response fixture',
          requests: [fixtureRequest(fixture.name)],
        })),
        modes: ['cpu', 'allocation'], configuration, connections,
        repeats: DESIGN.profile.repeats, warmupSeconds: DESIGN.profile.warmupSeconds,
        durationSeconds: DESIGN.profile.captureSeconds, controlSeconds: DESIGN.profile.controlSeconds,
        portBase: 35_800, inspectorPortBase: 35_900,
        outputDirectory: join(output, `${configuration}-${connections}`),
      });
      results.push(result);
      for (const capture of result.captures) {
        for (const run of capture.runs) assertGenerator(run.value, frozen.identities.generator);
      }
      await readManifest(manifestPath);
    }
  }
  return { status: results.every((result) => result.coverage.status === 'complete')
    ? 'PROFILES_REQUIRE_LEAD_INTERPRETATION' : 'PROFILES_INVALID', results };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  switch (mode) {
    case 'freeze':
      if (args.length !== 2) throw new ExperimentInputFailure('freeze IDENTITIES_JSON NEW_MANIFEST_JSON');
      return freeze(args[0], args[1]);
    case 'aa': case 'headroom':
      if (args.length !== 2) throw new ExperimentInputFailure(`${mode} MANIFEST_JSON NEW_OUTPUT_DIRECTORY`);
      return collect(args[0], args[1], mode);
    case 'profiles':
      if (args.length !== 3) throw new ExperimentInputFailure('profiles MANIFEST_JSON CALIBRATION_JSON NEW_PROFILE_DIRECTORY');
      return profiles(args[0], args[1], args[2]);
    case 'evaluate-aa': {
      if (args.length !== 3) throw new ExperimentInputFailure('evaluate-aa MANIFEST_JSON RAW_JSON NEW_REPORT_JSON');
      const manifest = object(JSON.parse(await readFile(contained(args[0]), 'utf8')));
      assertFrozenDesign(manifest);
      const artifacts = object(manifest.source).artifactsSha256;
      if (typeof artifacts !== 'string') throw new ExperimentInputFailure('Missing frozen build hash');
      let report: unknown;
      try {
        report = await evaluateRawIndex(contained(args[1]), sha256(await readFile(args[0])), artifacts);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        report = { aa: error instanceof RangeError ? 'INCONCLUSIVE' : 'FAIL_EVIDENCE', error: error.message };
      }
      await writeFile(contained(args[2]), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      if (object(report).aa !== 'CALIBRATED') process.exitCode = 1;
      return report;
    }
    default:
      throw new ExperimentInputFailure('Modes: freeze, aa, headroom, profiles; no implicit run or historical verdict reuse');
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`), (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
