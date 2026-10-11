import { execFile, spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { EvidenceJournal } from '../../src/evidence';
import type { FrozenPlan } from './paired-aa.mjs';
import {
  AAInputFailure, absolute, array, BLOCKS, CONDITION, CV, equal, evaluatePaired,
  hash, integer, LIMITS, object, precision, readRecord, sha256, text,
} from './paired-aa.mjs';

const execute = promisify(execFile);
const COLLECTOR = fileURLToPath(import.meta.url);
const VALIDATOR = fileURLToPath(new URL('./paired-aa.mts', import.meta.url));
const ORDER = BLOCKS.flat();
type Arm = (typeof ORDER)[number];
const FIXED_ENV = {
  BENCH_CONFIGURATION: 'equivalent', BENCH_WARMUP_SEC: '30', BENCH_MEASURE_SEC: '60',
  BENCH_CONNECTIONS: '64', BENCH_CONCURRENCY_SWEEP: '64', BENCH_LOAD_PROCESS: '1',
} as const;

function gitSha(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{40}$/.test(result)) throw new AAInputFailure('Expected full Git SHA');
  return result;
}

function artifactMap(value: unknown): Record<string, string> {
  const result = Object.fromEntries(Object.entries(object(value)).map(([path, digest]) => [absolute(path), hash(digest)]));
  if (Object.keys(result).length === 0) throw new AAInputFailure('Missing artifact map');
  return result;
}

/**
 * Frozen paired-ab-v1 schema. N/X share a baseline packages tree; Y has a distinct
 * candidate tree. All three descriptors retain their actual checkout and build identities.
 * Paths are canonical absolute paths. Artifacts include prepared inputs and lockfiles.
 */
export function frozenABPlan(input: unknown) {
  const plan = object(input);
  equal(plan.schema, 'paired-ab-v1', 'schema');
  equal(plan.status, 'FROZEN', 'plan freeze');
  equal(plan.condition, CONDITION, 'condition');
  equal(plan.blocks, BLOCKS, 'order');
  equal(plan.maxCv, CV, 'CV policy');
  equal(plan.ratioLimits, LIMITS, 'budget policy');
  equal(plan.automaticAdditionalRepeats, 0, 'repeats');
  equal(plan.outlierDeletionAllowed, false, 'outlier deletion');
  equal(plan.freshServerPerRun, true, 'fresh server');
  equal(plan.maximumCpuQuantizationFraction, 0.01, 'CPU precision bound');
  equal(plan.generatorLifetime, 'one-local-session-per-server-run', 'generator lifetime');
  const freeze = object(plan.freeze);
  const generator = object(freeze.generator);
  equal(generator.protocol, 'local-session-v1', 'generator protocol');
  const protocol = object(plan.protocol);
  const shared = {
    planPath: absolute(freeze.planPath), outputRoot: absolute(freeze.outputRoot),
    collectorSha256: hash(freeze.collectorSha256), validatorSha256: hash(freeze.validatorSha256),
    harnessSha256: hash(freeze.harnessSha256), runtimeExecutable: absolute(freeze.runtimeExecutable),
    runtimeExecutableSha256: hash(freeze.runtimeExecutableSha256),
    containerIdentity: text(freeze.containerIdentity), cpuPrecision: precision(freeze.cpuPrecision),
    generator: { protocol: 'local-session-v1', node: text(generator.node),
      executable: absolute(generator.executable), hostname: text(generator.hostname) },
    generatorExecutableSha256: hash(freeze.generatorExecutableSha256),
  };
  const inputs = object(plan.arms);
  equal(Object.keys(inputs).sort(), ['N', 'X', 'Y'], 'arm descriptors');
  const parseArm = (arm: Arm) => {
    const item = object(inputs[arm]);
    const receipt = object(item.buildReceipt);
    const cwd = absolute(item.cwd);
    const workspace = resolve(cwd, '../../..');
    equal(cwd, join(workspace, 'tooling/benchmarks/http-comparison'), 'arm cwd');
    const artifacts = artifactMap(item.artifacts);
    for (const path of Object.keys(artifacts)) {
      if (!path.startsWith(`${workspace}/`)) throw new AAInputFailure('Artifact outside arm workspace');
    }
    for (const path of [join(workspace, 'pnpm-lock.yaml'), join(cwd, 'pnpm-lock.yaml')]) {
      if (!(path in artifacts)) throw new AAInputFailure('Frozen lockfiles are missing');
    }
    const targetDigest = hash(item.targetArtifactsSha256);
    return {
      ...shared, status: 'FROZEN', condition: CONDITION, blocks: BLOCKS,
      cwd, workspace, head: gitSha(item.head), frameworkSource: gitSha(item.frameworkSource),
      packagesTree: gitSha(item.packagesTree), artifacts,
      targetArtifactsSha256: { N: targetDigest, X: targetDigest, Y: targetDigest },
      buildReceipt: { path: absolute(receipt.path), sha256: hash(receipt.sha256) },
    } satisfies FrozenPlan & { cwd: string; workspace: string; packagesTree: string };
  };
  const arms = { N: parseArm('N'), X: parseArm('X'), Y: parseArm('Y') };
  equal(arms.N.frameworkSource, arms.X.frameworkSource, 'baseline source');
  equal(arms.N.packagesTree, arms.X.packagesTree, 'baseline packages tree');
  if (arms.Y.packagesTree === arms.X.packagesTree || arms.Y.frameworkSource === arms.X.frameworkSource
    || arms.Y.head === arms.X.head || arms.Y.cwd === arms.X.cwd) {
    throw new AAInputFailure('Candidate must have a distinct source, packages tree and checkout');
  }
  return {
    schema: 'paired-ab-v1', status: 'FROZEN', orderSeed: text(plan.orderSeed),
    previousPolicySha256: hash(plan.previousPolicySha256), calibrationPlanSha256: hash(plan.calibrationPlanSha256),
    protocol: { path: absolute(protocol.path), sha256: hash(protocol.sha256) }, ...shared, arms,
  };
}
export type ABPlan = ReturnType<typeof frozenABPlan>;

/** Persist completed phase data before a later phase can be interrupted or force-killed. */
export function flushJournalPhases(journal: EvidenceJournal): void {
  let current = journal.current;
  Object.defineProperty(journal, 'current', {
    get: () => current,
    set: (value: unknown) => { current = value; journal.flush(); },
  });
}

export function evaluateAB(planInput: unknown, evidenceInput: unknown) {
  // Parsing happens inside the shared evaluator's evidence-error boundary.
  return evaluatePaired((index) => {
    const plan = frozenABPlan(planInput);
    const evidence = object(evidenceInput);
    equal(evidence.planSha256, sha256(JSON.stringify(planInput)), 'evidence plan binding');
    const records = array(evidence.records).map(object);
    const collectorPids = records.map((item) => integer(object(item.child).pid));
    if (new Set(collectorPids).size !== records.length) throw new AAInputFailure('Reused collector process');
    const record = object(records[index]);
    const child = object(record.child);
    equal(child.exitCode, 0, 'collector exit');
    equal(child.signal, null, 'collector signal');
    equal(child.timedOut, false, 'collector deadline');
    equal(child.error, null, 'collector error');
    const collectorPid = integer(child.pid);
    const raw = object(record.raw);
    const generator = object(raw.generator);
    const serving = object(raw.servingIdentity);
    const arm = ORDER[index];
    equal(record.cwd, plan.arms[arm].cwd, 'run cwd');
    if (collectorPid === generator.pid || collectorPid === serving.pid) throw new AAInputFailure('Collector process alias');
    for (const sample of array(object(raw.server).samples)) {
      if (array(object(sample).processes).some((process) => object(process).pid === collectorPid)) {
        throw new AAInputFailure('Collector included in server process tree');
      }
    }
    return plan.arms[arm];
  }, evidenceInput);
}

export async function digestFile(path: string, expected: string, label: string) {
  equal(sha256(await readFile(path)), expected, label);
}

async function verifyPackageOutput(directory: string, artifacts: Record<string, string>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await verifyPackageOutput(path, artifacts);
    else if (entry.isFile()) {
      if (!(path in artifacts)) throw new AAInputFailure(`Unfrozen framework build output ${path}`);
    } else throw new AAInputFailure(`Unsupported framework output ${path}`);
  }
}

/** Verify immutable inputs before and after each run, without build or install commands. */
export async function verifyArm(plan: ABPlan, arm: Arm) {
  const descriptor = plan.arms[arm];
  const git = async (...args: string[]) => (await execute('git', args, { cwd: descriptor.workspace, timeout: 10_000 })).stdout.trim();
  equal(await realpath(descriptor.cwd), descriptor.cwd, 'canonical arm cwd');
  equal(await git('rev-parse', 'HEAD'), descriptor.head, 'clean arm head');
  equal(await git('status', '--porcelain', '--untracked-files=normal'), '', 'clean arm source');
  equal(await git('rev-parse', 'HEAD:packages'), descriptor.packagesTree, 'checkout packages tree');
  equal(await git('rev-parse', `${descriptor.frameworkSource}:packages`), descriptor.packagesTree, 'framework packages tree');
  await digestFile(join(descriptor.cwd, 'results/issue-3914/paired-ab.mts'), plan.collectorSha256, 'arm collector');
  await digestFile(join(descriptor.cwd, 'results/issue-3914/paired-aa.mts'), plan.validatorSha256, 'arm validator');
  await digestFile(plan.runtimeExecutable, plan.runtimeExecutableSha256, 'Bun executable');
  await digestFile(plan.generator.executable, plan.generatorExecutableSha256, 'generator executable');
  equal((await execute(plan.runtimeExecutable, ['--version'], { timeout: 10_000 })).stdout.trim(), CONDITION.runtimeVersion, 'Bun runtime');
  await digestFile(descriptor.buildReceipt.path, descriptor.buildReceipt.sha256, 'build receipt');
  const receipt = object(JSON.parse(await readFile(descriptor.buildReceipt.path, 'utf8')));
  equal(receipt.head, descriptor.head, 'build head');
  equal(receipt.frameworkSource, descriptor.frameworkSource, 'build framework source');
  equal(receipt.packagesTree, descriptor.packagesTree, 'build packages tree');
  equal(receipt.configuration, 'equivalent', 'build configuration');
  equal(receipt.artifacts, descriptor.artifacts, 'build artifact mapping');
  for (const [path, digest] of Object.entries(descriptor.artifacts)) await digestFile(path, digest, `artifact ${path}`);
  const manifest = object(JSON.parse(await readFile(join(descriptor.cwd, 'package.json'), 'utf8')));
  for (const name of Object.keys(object(manifest.dependencies)).filter((name) => name.startsWith('@fluojs/'))) {
    const packagePath = join(descriptor.workspace, 'packages', name.slice('@fluojs/'.length));
    equal(await realpath(join(descriptor.cwd, 'node_modules', name)), packagePath, 'arm linked framework package');
    if (!(join(packagePath, 'package.json') in descriptor.artifacts)) throw new AAInputFailure(`Unfrozen package manifest ${name}`);
    await verifyPackageOutput(join(packagePath, 'dist'), descriptor.artifacts);
  }
}

function fixedEnvironment(plan: ABPlan) {
  equal(process.platform, CONDITION.os, 'collector OS');
  equal(process.version, plan.generator.node, 'collector Node');
  equal(process.execPath, plan.generator.executable, 'collector executable');
  equal(hostname(), plan.generator.hostname, 'collector hostname');
  equal(process.env.BENCH_CONTAINER_IDENTITY, plan.containerIdentity, 'container identity');
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('BENCH_') || key === 'BENCH_CONTAINER_IDENTITY') continue;
    if (!(key in FIXED_ENV)) throw new AAInputFailure(`Unsupported collection environment ${key}`);
    equal(value, Reflect.get(FIXED_ENV, key), key);
  }
  return { ...process.env, ...FIXED_ENV };
}

export type ChildOutcome = {
  readonly pid: number; readonly exitCode: number | null; readonly signal: string | null;
  readonly timedOut: boolean; readonly error: string | null;
};

/** Subscribe before running; one detached, owned process group and bounded forced teardown. */
export async function launchCollector(
  executable: string, args: readonly string[], cwd: string, outputPrefix: string,
  env: NodeJS.ProcessEnv, deadlineMs: number | AbortSignal = 180_000, teardownMs = 5_000,
): Promise<ChildOutcome> {
  const stdout = createWriteStream(`${outputPrefix}.stdout.log`, { flags: 'wx' });
  const stderr = createWriteStream(`${outputPrefix}.stderr.log`, { flags: 'wx' });
  const child = spawn(executable, [...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let timedOut = false;
  let error: string | null = null;
  let force: ReturnType<typeof setTimeout> | undefined;
  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); }
    catch (failure) {
      if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH')) throw failure;
    }
  };
  const interrupt = () => {
    error ??= 'Parent interrupted';
    signalGroup('SIGTERM');
    force ??= setTimeout(() => signalGroup('SIGKILL'), teardownMs);
  };
  const closed = new Promise<ChildOutcome>((resolveChild) => {
    child.once('error', (failure) => { error = failure.message; });
    child.once('close', (exitCode, signal) => {
      // A completed collector must not leave any owned descendant alive.
      signalGroup('SIGKILL');
      resolveChild({ pid: child.pid ?? 0, exitCode, signal, timedOut, error });
    });
  });
  child.once('exit', () => signalGroup('SIGKILL'));
  const streamsDone = [stdout, stderr].map((stream) => new Promise<void>((resolveStream) => {
    stream.once('finish', resolveStream);
    stream.once('error', (failure) => { error = failure.message; interrupt(); resolveStream(); });
  }));
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const expire = () => { timedOut = true; interrupt(); };
  const deadline = typeof deadlineMs === 'number' ? setTimeout(expire, deadlineMs) : undefined;
  if (typeof deadlineMs !== 'number') {
    deadlineMs.addEventListener('abort', expire, { once: true });
    if (deadlineMs.aborted) expire();
  }
  try {
    const outcome = await closed;
    await Promise.all(streamsDone);
    const result = { ...outcome, error };
    await writeFile(`${outputPrefix}.exit.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
    return result;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (typeof deadlineMs !== 'number') deadlineMs.removeEventListener('abort', expire);
    if (force) clearTimeout(force);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

export async function sequenceRuns(
  outputRoot: string,
  run: (ordinal: number, arm: Arm, prefix: string) => Promise<{ child: ChildOutcome; payload: unknown; cwd: string }>,
) {
  const records: unknown[] = [];
  const attempts: unknown[] = [];
  const invalidAttempts: unknown[] = [];
  let active: unknown = null;
  // EvidenceJournal imports the serving harness's process-exiting signal handlers.
  // Keep those in the child; the parent must own bounded group teardown itself.
  const flush = () => writeFileSync(join(outputRoot, 'parent-journal.json'),
    JSON.stringify({ records, attempts, active, invalidAttempts }, null, 2));
  const onExit = (exitCode: number) => {
    invalidAttempts.push({ phase: 'interrupted', active, exitCode });
    flush();
  };
  process.once('exit', onExit);
  flush();
  try {
    for (const [ordinal, arm] of ORDER.entries()) {
      const prefix = join(outputRoot, `run-${ordinal}-${arm}`);
      const startedMs = performance.now();
      active = { ordinal, arm, startedMs };
      flush();
      const result = await run(ordinal, arm, prefix);
      const endedMs = performance.now();
      const attempt = { ordinal, arm, startedMs, endedMs, ...result };
      attempts.push(attempt);
      await writeFile(`${prefix}.parent.json`, JSON.stringify(attempt, null, 2), { flag: 'wx' });
      flush();
      const child = result.child;
      if (child.exitCode !== 0 || child.signal !== null || child.timedOut || child.error !== null) {
        throw new AAInputFailure(`Collector ${ordinal} failed: ${JSON.stringify(child)}`);
      }
      const payload = object(result.payload);
      equal(payload.invalidAttempts, [], 'child invalid attempts');
      equal(payload.ordinal, ordinal, 'child ordinal');
      equal(payload.arm, arm, 'child arm');
      records.push({
        ordinal, block: Math.floor(ordinal / 4), slot: ordinal % 4, arm, condition: CONDITION,
        startedMs, endedMs, child, cwd: result.cwd, identity: payload.identity, raw: payload.raw,
      });
      active = null;
      flush();
    }
    return { records, invalidAttempts };
  } catch (error) {
    invalidAttempts.push({ active, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
    throw error;
  } finally {
    flush();
    process.removeListener('exit', onExit);
  }
}

async function loadPlan(path: string, expectedHash?: string) {
  const bytes = await readFile(path);
  if (expectedHash !== undefined) equal(sha256(bytes), hash(expectedHash), 'unchanged plan bytes');
  const input: unknown = JSON.parse(bytes.toString());
  const plan = frozenABPlan(input);
  equal(resolve(path), plan.planPath, 'frozen plan path');
  return { bytes, input, plan };
}

async function verifyProtocol(plan: ABPlan) {
  await digestFile(plan.protocol.path, plan.protocol.sha256, 'prospective protocol');
  const protocol = object(JSON.parse(await readFile(plan.protocol.path, 'utf8')));
  equal(protocol.status, 'FROZEN', 'protocol freeze');
  equal(protocol.condition, CONDITION, 'protocol condition');
  equal(protocol.blocks, BLOCKS, 'protocol order');
  for (const [key, value] of Object.entries({
    maxCv: CV, ratioLimits: LIMITS, freshServerPerRun: true, automaticAdditionalRepeats: 0,
    outlierDeletionAllowed: false, maximumCpuQuantizationFraction: 0.01,
    generatorLifetime: 'one-local-session-per-server-run',
  })) equal(protocol[key], value, `protocol ${key}`);
  equal(protocol.baselineFrameworkSource, plan.arms.X.frameworkSource, 'protocol baseline');
  equal(protocol.candidateFrameworkSource, plan.arms.Y.frameworkSource, 'protocol candidate');
  equal(protocol.baselinePackagesTree, plan.arms.X.packagesTree, 'protocol baseline tree');
  equal(protocol.candidatePackagesTree, plan.arms.Y.packagesTree, 'protocol candidate tree');
  equal(object(protocol.calibration).planSha256, plan.calibrationPlanSha256, 'calibration binding');
  equal(object(protocol.calibration).verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE', 'calibration verdict');
}

async function singleRun(planPath: string, planHash: string, ordinalText: string, outputPath: string) {
  const { plan } = await loadPlan(planPath, planHash);
  const ordinal = Number(ordinalText);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= ORDER.length) throw new AAInputFailure('Invalid single-run ordinal');
  const arm = ORDER[ordinal];
  const descriptor = plan.arms[arm];
  equal(resolve(process.cwd()), descriptor.cwd, 'single-run cwd');
  equal(outputPath, join(plan.outputRoot, `run-${ordinal}-${arm}.child.json`), 'single-run output');
  fixedEnvironment(plan);
  for (const [key, value] of Object.entries(FIXED_ENV)) process.env[key] = value;
  await digestFile(COLLECTOR, plan.collectorSha256, 'collector content');
  await digestFile(VALIDATOR, plan.validatorSha256, 'validator content');
  await verifyProtocol(plan);
  await verifyArm(plan, arm);
  const { environmentSummary } = await import('../../src/provenance');
  const { EvidenceJournal } = await import('../../src/evidence');
  const { prepareTimingIdentity } = await import('../../src/timing-identity');
  const { AVAILABLE_TARGETS } = await import('../../src/targets');
  const { selectSuite } = await import('../../src/suites');
  const environment = await environmentSummary();
  equal(environment.git.sha, descriptor.head, 'collector head');
  equal(environment.git.dirty, false, 'collector clean');
  equal(environment.benchmarkSource.sha256, plan.harnessSha256, 'shared harness content');
  const scenario = selectSuite('stages').find((item) => item.name === CONDITION.scenario);
  const target = AVAILABLE_TARGETS.find((item) => item.name === (arm === 'N' ? 'native-bun' : 'fluo-bun'));
  if (!scenario || !target) throw new AAInputFailure('Missing fixed scenario or target');
  const prepared = await prepareTimingIdentity(target, scenario.appShape);
  equal(prepared.artifactsSha256, descriptor.targetArtifactsSha256[arm], 'prepared target build');
  for (const [path, digest] of Object.entries(prepared.artifacts)) equal(descriptor.artifacts[path], digest, 'prepared frozen artifact');
  const samples: import('../../src/report').TargetResult[] = [];
  let raw: unknown = null;
  const identity = {
    head: descriptor.head, frameworkSource: descriptor.frameworkSource, collectorSha256: plan.collectorSha256,
    harnessSha256: plan.harnessSha256, buildReceiptSha256: descriptor.buildReceipt.sha256, containerIdentity: plan.containerIdentity,
  };
  const journal: import('../../src/evidence').EvidenceJournal = new EvidenceJournal(outputPath, () => ({
    ordinal, arm, identity, raw, samples, current: journal.current, environment,
  }));
  flushJournalPhases(journal);
  journal.flush();
  try {
    const { runScenario } = await import('../../src/run');
    await runScenario(scenario, { index: 0, repeat: ordinal, targets: [target], connections: 64, samples, journal });
    equal(samples.length, 1, 'single result');
    raw = samples[0];
    await verifyArm(plan, arm);
    await loadPlan(planPath, planHash);
    await verifyProtocol(plan);
    const checked = readRecord({
      ordinal, block: Math.floor(ordinal / 4), slot: ordinal % 4, arm, condition: CONDITION,
      identity, raw, startedMs: 1, endedMs: 2,
    }, ordinal, descriptor);
    if (checked.generatorPid === process.pid || checked.pid === process.pid) throw new AAInputFailure('Sampler process alias');
    if (!checked.precisionResolved) throw new AAInputFailure('Unresolved CPU precision');
  } catch (error) {
    if (journal.failures.length === 0) journal.fail(error);
    throw error;
  } finally {
    journal.finish();
  }
}

export async function collectAB(planPath: string, outputPath: string, planOnly = false) {
  const { bytes, input, plan } = await loadPlan(planPath);
  if (planOnly) return plan;
  equal(resolve(outputPath), plan.outputRoot, 'frozen output path');
  equal(COLLECTOR, join(plan.arms.N.cwd, 'results/issue-3914/paired-ab.mts'), 'parent baseline checkout');
  const env = fixedEnvironment(plan);
  await digestFile(COLLECTOR, plan.collectorSha256, 'parent collector');
  await digestFile(VALIDATOR, plan.validatorSha256, 'parent validator');
  await verifyProtocol(plan);
  for (const arm of ['N', 'X', 'Y'] as const) await verifyArm(plan, arm);
  await mkdir(outputPath, { recursive: false });
  await writeFile(join(outputPath, 'plan.json'), bytes, { flag: 'wx' });
  let evidence: { records: unknown[]; invalidAttempts: unknown[] };
  try {
    evidence = await sequenceRuns(outputPath, async (ordinal, arm, prefix) => {
      await loadPlan(planPath, sha256(bytes));
      await verifyProtocol(plan);
      const descriptor = plan.arms[arm];
      const childPath = `${prefix}.child.json`;
      const child = await launchCollector(plan.generator.executable, [
        '--import', 'tsx', join(descriptor.cwd, 'results/issue-3914/paired-ab.mts'),
        '--single-run', planPath, sha256(bytes), String(ordinal), childPath,
      ], descriptor.cwd, prefix, env);
      let payload: unknown = null;
      try { payload = JSON.parse(await readFile(childPath, 'utf8')); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          payload = { readFailure: error instanceof Error ? error.message : String(error) };
        }
      }
      return { child, payload, cwd: descriptor.cwd };
    });
  } catch (error) {
    const partial = object(JSON.parse(await readFile(join(outputPath, 'parent-journal.json'), 'utf8')));
    evidence = { records: array(partial.records), invalidAttempts: array(partial.invalidAttempts) };
    if (evidence.invalidAttempts.length === 0) throw error;
  }
  const boundEvidence = { ...evidence, planSha256: sha256(JSON.stringify(input)), planFileSha256: sha256(bytes) };
  await writeFile(join(outputPath, 'evidence.json'), JSON.stringify(boundEvidence, null, 2), { flag: 'wx' });
  const decision = evaluateAB(input, boundEvidence);
  await writeFile(join(outputPath, 'decision.json'), JSON.stringify(decision, null, 2), { flag: 'wx' });
  return decision;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, planPath, outputOrHash, ordinal, childOutput, ...extra] = process.argv.slice(2);
  const operation = mode === '--single-run' && planPath && outputOrHash && ordinal !== undefined && childOutput && extra.length === 0
    ? singleRun(planPath, outputOrHash, ordinal, childOutput)
    : (mode === '--plan-only' || mode === '--collect') && planPath && ordinal === undefined && extra.length === 0
      && (mode === '--plan-only' ? outputOrHash === undefined : outputOrHash !== undefined)
      ? collectAB(planPath, outputOrHash ?? '', mode === '--plan-only')
      : Promise.reject(new AAInputFailure('Usage: paired-ab.mts --plan-only PLAN | --collect PLAN OUTPUT'));
  operation.then((result) => {
    if (result !== undefined) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if ('verdict' in result && result.verdict !== 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE') process.exitCode = 1;
    }
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
