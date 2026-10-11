import { execFile, spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { EvidenceJournal } from '../../src/evidence';
import type { FrozenPlan, NodeSubject } from './paired-aa.mjs';
import {
  AAInputFailure, absolute, array, BLOCKS, CONDITION, CV, equal, evaluatePaired,
  hash, integer, LIMITS, object, pairedCondition, precision, readRecord, sha256, text,
} from './paired-aa.mjs';

const execute = promisify(execFile);
const COLLECTOR = fileURLToPath(import.meta.url);
const VALIDATOR = fileURLToPath(new URL('./paired-aa.mts', import.meta.url));
const ORDER = BLOCKS.flat();
function collectorPath(subject?: NodeSubject) {
  return subject ? fileURLToPath(new URL('./paired-node.mts', import.meta.url)) : COLLECTOR;
}
function collectorName(subject?: NodeSubject) {
  return subject ? 'paired-node.mts' : 'paired-ab.mts';
}
type Arm = (typeof ORDER)[number];
const FIXED_ENV = {
  BENCH_CONFIGURATION: 'equivalent', BENCH_WARMUP_SEC: '30', BENCH_MEASURE_SEC: '60',
  BENCH_CONNECTIONS: '64', BENCH_CONCURRENCY_SWEEP: '64', BENCH_LOAD_PROCESS: '1',
} as const;

export function pairedEnvironment(subject?: NodeSubject) {
  return { ...FIXED_ENV, BENCH_MEASURE_SEC: String(pairedCondition(subject).measureSeconds) };
}

export function collectorDeadline(subject?: NodeSubject) {
  const condition = pairedCondition(subject);
  // Retain the legacy 90s non-load allowance and the separate 5s forced teardown.
  return (condition.warmupSeconds + condition.measureSeconds + 90) * 1_000;
}

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
  return frozenSourcePlan(input);
}

export function frozenSourcePlan(input: unknown, subject?: NodeSubject) {
  const plan = object(input);
  const condition = pairedCondition(subject);
  equal(plan.schema, subject ? subject.schema ?? 'paired-node-v1' : 'paired-ab-v1', 'schema');
  if (subject) equal(plan.mode, subject.mode, 'explicit Node mode');
  equal(plan.status, 'FROZEN', 'plan freeze');
  equal(plan.condition, condition, 'condition');
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
    ...(subject ? { orchestratorSha256: hash(freeze.orchestratorSha256) } : {}),
  };
  if (subject) {
    equal(shared.generator.node, 'v24.21.0', 'Node generator runtime');
    equal(shared.generator.executable, shared.runtimeExecutable, 'Node generator executable');
    equal(shared.generatorExecutableSha256, shared.runtimeExecutableSha256, 'Node generator executable hash');
  }
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
      ...shared, status: 'FROZEN', condition, blocks: BLOCKS,
      cwd, workspace, head: gitSha(item.head), frameworkSource: gitSha(item.frameworkSource),
      packagesTree: gitSha(item.packagesTree), artifacts,
      targetArtifactsSha256: { N: targetDigest, X: targetDigest, Y: targetDigest },
      buildReceipt: { path: absolute(receipt.path), sha256: hash(receipt.sha256) },
    } satisfies FrozenPlan & { cwd: string; workspace: string; packagesTree: string };
  };
  const arms = { N: parseArm('N'), X: parseArm('X'), Y: parseArm('Y') };
  equal(arms.N.frameworkSource, arms.X.frameworkSource, 'baseline source');
  equal(arms.N.packagesTree, arms.X.packagesTree, 'baseline packages tree');
  if (subject?.mode === 'calibration') {
    for (const arm of [arms.N, arms.Y]) {
      equal(arm.frameworkSource, arms.X.frameworkSource, 'calibration framework source');
      equal(arm.packagesTree, arms.X.packagesTree, 'calibration packages tree');
      equal(arm.head, arms.X.head, 'calibration head');
      equal(arm.cwd, arms.X.cwd, 'calibration checkout');
    }
    equal(arms.X.targetArtifactsSha256, arms.Y.targetArtifactsSha256, 'calibration same build');
  } else if (arms.Y.packagesTree === arms.X.packagesTree || arms.Y.frameworkSource === arms.X.frameworkSource
    || arms.Y.head === arms.X.head || arms.Y.cwd === arms.X.cwd) {
    throw new AAInputFailure('Candidate must have a distinct source, packages tree and checkout');
  }
  return {
    schema: subject ? subject.schema ?? 'paired-node-v1' : 'paired-ab-v1', status: 'FROZEN', orderSeed: text(plan.orderSeed),
    ...(subject ? { mode: subject.mode, condition } : {}),
    previousPolicySha256: hash(plan.previousPolicySha256),
    calibrationPlanSha256: subject?.mode === 'calibration' ? null : hash(plan.calibrationPlanSha256),
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
  return evaluateSourcePaired(planInput, evidenceInput);
}

export function evaluateSourcePaired(planInput: unknown, evidenceInput: unknown, subject?: NodeSubject) {
  // Parsing happens inside the shared evaluator's evidence-error boundary.
  return evaluatePaired((index) => {
    const plan = frozenSourcePlan(planInput, subject);
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
  }, evidenceInput, subject);
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
export async function verifyArm(plan: ABPlan, arm: Arm, subject?: NodeSubject) {
  const descriptor = plan.arms[arm];
  const git = async (...args: string[]) => (await execute('git', args, { cwd: descriptor.workspace, timeout: 10_000 })).stdout.trim();
  equal(await realpath(descriptor.cwd), descriptor.cwd, 'canonical arm cwd');
  equal(await git('rev-parse', 'HEAD'), descriptor.head, 'clean arm head');
  equal(await git('status', '--porcelain', '--untracked-files=normal'), '', 'clean arm source');
  equal(await git('rev-parse', 'HEAD:packages'), descriptor.packagesTree, 'checkout packages tree');
  equal(await git('rev-parse', `${descriptor.frameworkSource}:packages`), descriptor.packagesTree, 'framework packages tree');
  await digestFile(join(descriptor.cwd, 'results/issue-3914', collectorName(subject)), plan.collectorSha256, 'arm collector');
  if (subject) await digestFile(join(descriptor.cwd, 'results/issue-3914/paired-ab.mts'), hash(plan.orchestratorSha256), 'arm orchestrator');
  await digestFile(join(descriptor.cwd, 'results/issue-3914/paired-aa.mts'), plan.validatorSha256, 'arm validator');
  await digestFile(plan.runtimeExecutable, plan.runtimeExecutableSha256, 'Bun executable');
  await digestFile(plan.generator.executable, plan.generatorExecutableSha256, 'generator executable');
  equal((await execute(plan.runtimeExecutable, ['--version'], { timeout: 10_000 })).stdout.trim(),
    subject ? 'v24.21.0' : CONDITION.runtimeVersion, 'serving runtime');
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

function fixedEnvironment(plan: ABPlan, subject?: NodeSubject) {
  const fixed = pairedEnvironment(subject);
  equal(process.platform, CONDITION.os, 'collector OS');
  equal(process.version, plan.generator.node, 'collector Node');
  equal(process.execPath, plan.generator.executable, 'collector executable');
  equal(hostname(), plan.generator.hostname, 'collector hostname');
  equal(process.env.BENCH_CONTAINER_IDENTITY, plan.containerIdentity, 'container identity');
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('BENCH_') || key === 'BENCH_CONTAINER_IDENTITY') continue;
    if (!(key in fixed)) throw new AAInputFailure(`Unsupported collection environment ${key}`);
    equal(value, Reflect.get(fixed, key), key);
  }
  return { ...process.env, ...fixed };
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
  subject?: NodeSubject,
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
        ordinal, block: Math.floor(ordinal / 4), slot: ordinal % 4, arm, condition: pairedCondition(subject),
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

async function loadPlan(path: string, expectedHash?: string, subject?: NodeSubject) {
  const bytes = await readFile(path);
  if (expectedHash !== undefined) equal(sha256(bytes), hash(expectedHash), 'unchanged plan bytes');
  const input: unknown = JSON.parse(bytes.toString());
  const plan = frozenSourcePlan(input, subject);
  equal(resolve(path), plan.planPath, 'frozen plan path');
  return { bytes, input, plan };
}

export async function verifyProtocol(plan: ABPlan, subject?: NodeSubject) {
  await digestFile(plan.protocol.path, plan.protocol.sha256, 'prospective protocol');
  validateProtocol(JSON.parse(await readFile(plan.protocol.path, 'utf8')), plan, subject);
}

export function validateProtocol(input: unknown, plan: ABPlan, subject?: NodeSubject) {
  const protocol = object(input);
  equal(protocol.status, 'FROZEN', 'protocol freeze');
  equal(protocol.condition, pairedCondition(subject), 'protocol condition');
  if (subject) {
    equal(protocol.schema, subject.schema ?? 'paired-node-v1', 'Node protocol schema');
    equal(protocol.mode, subject.mode, 'Node protocol mode');
  }
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
  if (subject?.mode !== 'calibration') {
    const calibration = object(protocol.calibration);
    equal(calibration.planSha256, plan.calibrationPlanSha256, 'calibration binding');
    equal(calibration.verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE', 'calibration verdict');
    if (subject) {
      equal(calibration.schema, subject.schema ?? 'paired-node-v1', 'Node calibration schema');
      equal(calibration.mode, 'calibration', 'Node calibration mode');
      equal(calibration.condition, pairedCondition(subject), 'Node calibration condition');
      equal(calibration.frameworkSource, plan.arms.X.frameworkSource, 'Node calibration source');
      equal(calibration.packagesTree, plan.arms.X.packagesTree, 'Node calibration packages tree');
    }
  }
}

export async function singleRun(planPath: string, planHash: string, ordinalText: string, outputPath: string, subject?: NodeSubject) {
  const { plan } = await loadPlan(planPath, planHash, subject);
  const ordinal = Number(ordinalText);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= ORDER.length) throw new AAInputFailure('Invalid single-run ordinal');
  const arm = ORDER[ordinal];
  const descriptor = plan.arms[arm];
  equal(resolve(process.cwd()), descriptor.cwd, 'single-run cwd');
  equal(outputPath, join(plan.outputRoot, `run-${ordinal}-${arm}.child.json`), 'single-run output');
  fixedEnvironment(plan, subject);
  // Set the profile before any serving-harness import captures phase lengths.
  for (const [key, value] of Object.entries(pairedEnvironment(subject))) process.env[key] = value;
  await digestFile(collectorPath(subject), plan.collectorSha256, 'collector content');
  await digestFile(VALIDATOR, plan.validatorSha256, 'validator content');
  await verifyProtocol(plan, subject);
  await verifyArm(plan, arm, subject);
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
  const condition = pairedCondition(subject);
  const target = AVAILABLE_TARGETS.find((item) => item.name === `${arm === 'N' ? 'native' : 'fluo'}-${condition.platform}`);
  if (!scenario || !target) throw new AAInputFailure('Missing fixed scenario or target');
  const servingTarget = subject ? { ...target, command: plan.runtimeExecutable } : target;
  const prepared = await prepareTimingIdentity(servingTarget, scenario.appShape);
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
    await runScenario(scenario, { index: 0, repeat: ordinal, targets: [servingTarget], connections: 64, samples, journal });
    equal(samples.length, 1, 'single result');
    raw = samples[0];
    await verifyArm(plan, arm, subject);
    await loadPlan(planPath, planHash, subject);
    await verifyProtocol(plan, subject);
    const checked = readRecord({
      ordinal, block: Math.floor(ordinal / 4), slot: ordinal % 4, arm, condition,
      identity, raw, startedMs: 1, endedMs: 2,
    }, ordinal, descriptor, subject);
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
  return collectSourcePaired(planPath, outputPath, planOnly);
}

export async function collectSourcePaired(planPath: string, outputPath: string, planOnly = false, subject?: NodeSubject) {
  const { bytes, input, plan } = await loadPlan(planPath, undefined, subject);
  if (planOnly) return plan;
  equal(resolve(outputPath), plan.outputRoot, 'frozen output path');
  equal(collectorPath(subject), join(plan.arms.N.cwd, 'results/issue-3914', collectorName(subject)), 'parent baseline checkout');
  const env = fixedEnvironment(plan, subject);
  await digestFile(collectorPath(subject), plan.collectorSha256, 'parent collector');
  await digestFile(VALIDATOR, plan.validatorSha256, 'parent validator');
  await verifyProtocol(plan, subject);
  for (const arm of ['N', 'X', 'Y'] as const) await verifyArm(plan, arm, subject);
  await mkdir(outputPath, { recursive: false });
  await writeFile(join(outputPath, 'plan.json'), bytes, { flag: 'wx' });
  let evidence: { records: unknown[]; invalidAttempts: unknown[] };
  try {
    evidence = await sequenceRuns(outputPath, async (ordinal, arm, prefix) => {
      await loadPlan(planPath, sha256(bytes), subject);
      await verifyProtocol(plan, subject);
      const descriptor = plan.arms[arm];
      const childPath = `${prefix}.child.json`;
      const child = await launchCollector(plan.generator.executable, [
        '--import', 'tsx', join(descriptor.cwd, 'results/issue-3914', collectorName(subject)),
        '--single-run', planPath, sha256(bytes), String(ordinal), childPath,
      ], descriptor.cwd, prefix, env, collectorDeadline(subject));
      let payload: unknown = null;
      try { payload = JSON.parse(await readFile(childPath, 'utf8')); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          payload = { readFailure: error instanceof Error ? error.message : String(error) };
        }
      }
      return { child, payload, cwd: descriptor.cwd };
    }, subject);
  } catch (error) {
    const partial = object(JSON.parse(await readFile(join(outputPath, 'parent-journal.json'), 'utf8')));
    evidence = { records: array(partial.records), invalidAttempts: array(partial.invalidAttempts) };
    if (evidence.invalidAttempts.length === 0) throw error;
  }
  const boundEvidence = { ...evidence, planSha256: sha256(JSON.stringify(input)), planFileSha256: sha256(bytes) };
  await writeFile(join(outputPath, 'evidence.json'), JSON.stringify(boundEvidence, null, 2), { flag: 'wx' });
  const decision = { ...evaluateSourcePaired(input, boundEvidence, subject),
    ...(subject ? { schema: subject.schema ?? 'paired-node-v1', mode: subject.mode, condition: pairedCondition(subject) } : {}) };
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
