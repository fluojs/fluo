import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluate, generatorIdentity, requireCalibration, traffic } from '../results/issue-3940/gates.mjs';
import { assertLocalServer, assertPriorLimits, design, designSha256, ExperimentInputFailure, equal, frozenManifest, identities, type Manifest, scenarios, schedule } from '../results/issue-3940/plan.mjs';
import { readEvidence, shardedJournal } from '../results/issue-3940/storage.mjs';
import { load } from './load';
import { runProfiles } from './profile';
import { object, sha256 } from './profile-report';
import { monitorServer } from './resources';
import { buildTarget, startTargets, stopTargets, TARGETS, type TargetConfig, WDIR, waitForTarget } from './targets';
import { authenticateTimingIdentity, prepareTimingIdentity } from './timing-identity';

const outputRoot = join(WDIR, 'results/issue-3940');
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
function owned(path: string): string {
  const result = isAbsolute(path) ? path : join(WDIR, path);
  const within = relative(outputRoot, result);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new ExperimentInputFailure('Output must be within results/issue-3940');
  return result;
}
function target(manifest?: Manifest): TargetConfig {
  const canonical = TARGETS.find((item) => item.name === 'fluo-bun');
  if (!canonical) throw new ExperimentInputFailure('Missing canonical Bun target');
  return manifest ? { ...canonical, port: manifest.identities.server.port, command: manifest.identities.server.executable } : canonical;
}
async function verifyManifest(manifest: Manifest): Promise<void> {
  assertLocalServer(manifest.identities);
  const current = await prepareTimingIdentity(target(manifest));
  equal(current.source, manifest.prepared.source, 'current source');
  for (const [path, digest] of Object.entries(object(manifest.prepared.artifacts))) {
    equal(sha256(await readFile(path)), digest, `artifact ${path}`);
  }
  for (const receipt of [manifest.identities.buildReceipt, manifest.identities.priorPolicy]) {
    equal(sha256(await readFile(receipt.path)), receipt.sha256, `receipt ${receipt.path}`);
  }
}
function transport(manifest: Manifest): void {
  process.env.BENCH_SSH_HOST = manifest.identities.generator.sshHost;
  process.env.BENCH_REMOTE_DIR = manifest.identities.generator.remoteDirectory;
  process.env.BENCH_SERVER_HOST = manifest.identities.server.address;
  process.env.BENCH_BIND_HOST = manifest.identities.server.bindHost;
  if (process.env.BENCH_DIAGNOSTIC_DRIFT === '1') throw new ExperimentInputFailure('Diagnostic instrumentation is excluded from ordinary timing');
}
export async function freeze(identityPath: string, output: string): Promise<void> {
  const identity = identities(await readJson(identityPath));
  assertLocalServer(identity);
  const prepared = await prepareTimingIdentity({ ...target(), port: identity.server.port, command: identity.server.executable });
  const artifacts = { ...prepared.artifacts };
  for (const receipt of [identity.buildReceipt, identity.priorPolicy]) equal(sha256(await readFile(receipt.path)), receipt.sha256, 'external receipt');
  assertPriorLimits(await readJson(identity.priorPolicy.path));
  const build = object(await readJson(identity.buildReceipt.path));
  equal(build.sourceHead, prepared.source.gitHead, 'build source');
  equal(build.sourceStatus, prepared.source.gitStatus, 'build dirty diff');
  const outputs = object(build.artifacts);
  if (Object.keys(outputs).length === 0) throw new ExperimentInputFailure('Build receipt must hash linked package outputs');
  for (const [path, digest] of Object.entries(outputs)) {
    equal(sha256(await readFile(path)), digest, `linked build ${path}`);
    artifacts[path] = String(digest);
  }
  const owners = new Set(['core', 'http', 'di', 'runtime', 'platform-bun', 'validation']);
  for (const owner of owners) {
    const directory = join(WDIR, '../../../packages', owner);
    const packageManifest = object(await readJson(join(directory, 'package.json')));
    for (const name of Object.keys(object(packageManifest.dependencies ?? {}))) {
      const match = name.match(/^@fluojs\/([a-z0-9-]+)$/);
      if (match) owners.add(match[1]);
    }
    // Reuse the existing output-tree hasher for every linked serving owner.
    const dependency = await prepareTimingIdentity({ ...target(), args: [join(directory, 'dist/index.js')] });
    for (const [path, digest] of Object.entries(dependency.artifacts)) artifacts[path] = digest;
  }
  for (const name of ['design-windows-server.json', 'plan.mts', 'gates.mts', 'generator.mts', 'storage.mts']) {
    const path = join(outputRoot, name);
    artifacts[path] = sha256(await readFile(path));
  }
  const manifest = { design, designSha256, identities: identity, prepared: { ...prepared, artifacts, artifactsSha256: sha256(JSON.stringify(artifacts)) } };
  frozenManifest(manifest);
  await writeFile(owned(output), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

export async function collectAA(manifestPath: string, output: string): Promise<void> {
  const rawManifest = await readJson(manifestPath);
  const manifest = frozenManifest(rawManifest);
  await verifyManifest(manifest);
  transport(manifest);
  const records: unknown[] = [];
  const path = owned(output);
  await writeFile(path, '', { flag: 'wx' });
  const journal = shardedJournal(path, {
    phase: 'AA', manifestSha256: sha256(JSON.stringify(rawManifest)),
  }, records, 'records');
  try {
    for (const condition of schedule()) {
      const scenario = scenarios().find((item) => item.name === condition.workload);
      if (!scenario) throw new ExperimentInputFailure('Missing workload');
      await journal.record(condition, records, async (complete) => {
        await verifyManifest(manifest);
        const serving = target(manifest);
        const prepared = await servingPreparation(manifest, scenario.appShape);
        let stdout = '';
        const children = startTargets(scenario.appShape, [serving], {
          timingIdentity: true, quiet: true,
          env: { ...prepared.env, BENCH_TIMING_NONCE: prepared.nonce, BENCH_CONFIGURATION: condition.configuration },
          onOutput: (_target, stream, bytes) => { if (stream === 'stdout') stdout += bytes.toString(); },
        });
        try {
          await waitForTarget(children[0]);
          const pid = children[0].pid;
          if (pid === undefined) throw new ExperimentInputFailure('Missing serving PID');
          const servingIdentity = await authenticateTimingIdentity(prepared, stdout, pid, serving.port);
          const options = { url: `http://${manifest.identities.server.address}:${serving.port}`, connections: condition.connections, requests: scenario.requests };
          const warmup = await load({ ...options, duration: design.warmupSeconds }, 'issue-3940 warmup');
          generatorIdentity(object(warmup).generator, manifest);
          const measured = await monitorServer(pid, () => load({ ...options, duration: design.measurementSeconds }, 'issue-3940 AA'));
          generatorIdentity(object(measured.value).generator, manifest);
          await verifyManifest(manifest);
          complete({ condition, servingIdentity, warmup, raw: { ...measured.value, server: measured.server } });
          journal.flush();
        } finally { await stopTargets(children); }
      });
    }
    const verdict = evaluate({ manifest: rawManifest, evidence: readEvidence(path) });
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    if (verdict.status !== 'PASS') process.exitCode = 1;
  } finally { journal.finish(); }
}

async function servingPreparation(manifest: Manifest, shape: Parameters<typeof prepareTimingIdentity>[1]) {
  const prepared = await prepareTimingIdentity(target(manifest), shape);
  const artifacts = Object.fromEntries(Object.entries(object(manifest.prepared.artifacts)).map(([path, digest]) => [path, String(digest)]));
  return { ...prepared, artifacts, artifactsSha256: sha256(JSON.stringify(artifacts)),
    env: { ...prepared.env, BENCH_TIMING_FILES: JSON.stringify(Object.keys(artifacts)) } };
}
export async function collectHeadroom(manifestPath: string, output: string, workload: string): Promise<void> {
  const rawManifest = await readJson(manifestPath);
  const manifest = frozenManifest(rawManifest);
  await verifyManifest(manifest);
  transport(manifest);
  const scenario = scenarios().find((item) => item.name === workload);
  if (!scenario) throw new ExperimentInputFailure('Missing selected maximum-load workload');
  equal(workload, manifest.identities.headroomWorkload, 'frozen headroom workload');
  const serving = target(manifest);
  const prepared = await servingPreparation(manifest, scenario.appShape);
  const path = owned(output);
  await writeFile(path, '', { flag: 'wx' });
  const observations: unknown[] = [];
  const journal = shardedJournal(path, {
    manifestSha256: sha256(JSON.stringify(rawManifest)), workload,
    // Only the lead can attach separately observed headroom/network evidence.
    independentGeneratorHeadroomEvidence: null, serverNetworkBottleneckEvidence: null,
  }, observations, 'observations');
  let stdout = '';
  const children = startTargets(scenario.appShape, [serving], {
    timingIdentity: true, quiet: true, env: { ...prepared.env, BENCH_TIMING_NONCE: prepared.nonce },
    onOutput: (_target, stream, bytes) => { if (stream === 'stdout') stdout += bytes.toString(); },
  });
  try {
    await waitForTarget(children[0]);
    const pid = children[0].pid;
    if (pid === undefined) throw new ExperimentInputFailure('Missing serving PID');
    const servingIdentity = await authenticateTimingIdentity(prepared, stdout, pid, serving.port);
    const options = { url: `http://${manifest.identities.server.address}:${serving.port}`, requests: scenario.requests };
    for (const [index, workers] of [[1, 4], [4, 1], [1, 4]].flat().entries()) {
      await journal.record({ index, workers }, observations, async (complete) => {
        const warmup = await load({ ...options, connections: 64, duration: 3 }, 'issue-3940 headroom warmup');
        generatorIdentity(object(warmup).generator, manifest);
        const measured = await monitorServer(pid, () => Promise.all(Array.from({ length: workers }, () =>
          load({ ...options, connections: 64 / workers, duration: 10 }, 'issue-3940 headroom worker'))));
        for (const sample of measured.value) { traffic(sample); generatorIdentity(object(sample).generator, manifest); }
        complete({ index, workers, totalConnections: 64, warmup, samples: measured.value, server: measured.server, servingIdentity });
        journal.flush();
      });
    }
    await verifyManifest(manifest);
  } catch (error) { journal.fail(error); throw error; }
  finally { try { await stopTargets(children); } finally { journal.finish(); } }
}

export async function correctnessProbe(): Promise<void> {
  await buildTarget(target());
  for (const scenario of scenarios()) {
    const children = startTargets(scenario.appShape, [target()], { quiet: true });
    try {
      await waitForTarget(children[0]);
      for (const request of scenario.requests) {
        const response = await fetch(`http://127.0.0.1:${target().port}${request.path}`, {
          method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(5000),
        });
        equal(response.status, request.expectedStatus, `${scenario.name} status`);
        equal(await response.text(), request.expectedBody, `${scenario.name} body`);
      }
    } finally { await stopTargets(children); }
  }
  process.stdout.write('CORRECTNESS_ONLY: six canonical Bun workloads passed; no timing verdict\n');
}

async function main(): Promise<void> {
  const [command, first, second, third] = process.argv.slice(2);
  switch (command) {
    case 'freeze':
      if (!first || !second) throw new ExperimentInputFailure('freeze <observed-identities.json> <new-manifest.json>');
      await freeze(first, second); break;
    case 'aa':
      if (!first || !second) throw new ExperimentInputFailure('aa <manifest.json> <new-raw.json>');
      await collectAA(first, second); break;
    case 'evaluate-aa':
      if (!first || !second) throw new ExperimentInputFailure('evaluate-aa <manifest.json> <raw.json>');
      {
        const result = evaluate({ manifest: await readJson(first), evidence: readEvidence(owned(second)) });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.status !== 'PASS') process.exitCode = 1;
      }
      break;
    case 'headroom':
      if (!first || !second || !third) throw new ExperimentInputFailure('headroom <manifest.json> <new-raw.json> <maximum-load-workload>');
      await collectHeadroom(first, second, third); break;
    case 'profiles':
      if (!first || !second || !third) throw new ExperimentInputFailure('profiles <manifest.json> <aa.json> <headroom.json>');
      {
        const rawManifest = await readJson(first);
        const manifest = frozenManifest(rawManifest);
        const independentReceipts = requireCalibration(rawManifest, readEvidence(owned(second)), readEvidence(owned(third)));
        for (const receipt of independentReceipts) equal(sha256(await readFile(receipt.path)), receipt.sha256, 'independent headroom receipt');
        await verifyManifest(manifest);
        transport(manifest);
        const result = await runProfiles({
          targets: [target(manifest)], scenarios: scenarios().slice(0, 3), modes: ['cpu', 'allocation'],
          configuration: 'default', connections: 64, repeats: 2, warmupSeconds: 10,
          durationSeconds: 40, controlSeconds: 40,
          portBase: manifest.identities.server.port - TARGETS.findIndex((item) => item.name === 'fluo-bun'),
          inspectorPortBase: manifest.identities.server.port + 100,
          outputDirectory: join(WDIR, 'results/profiling/issue-3940', randomUUID()),
        });
        process.stdout.write(`${JSON.stringify({ ...result, candidateStatus: 'NOT_ESTABLISHED',
          reason: 'Lead must establish real-request URL CPU and allocation attribution; JSC heap snapshot is not allocation rate.' })}\n`);
        if (result.coverage.status !== 'complete') process.exitCode = 1;
      }
      break;
    case 'probe': await correctnessProbe(); break;
    default: throw new ExperimentInputFailure('Expected freeze, aa, evaluate-aa, headroom, profiles, or probe');
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
}
