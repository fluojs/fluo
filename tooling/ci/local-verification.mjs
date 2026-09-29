import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { schemaFailure } from '../../.agents/workflow-contracts/schema-validator.mjs';
import { imageKeyFor, loadEnvironmentLock, validateVerificationEnvironment } from './verification-environment.mjs';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const receiptSchema = JSON.parse(readFileSync(new URL('./local-verification-receipt.schema.json', import.meta.url), 'utf8'));

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function semanticPlanDigest(plan) {
  const { semanticDigest: _discard, identity, ...rest } = plan;
  return digest(JSON.stringify({
    ...rest,
    identity: { ...identity, root: '<checkout>', baseRef: identity.baseSha },
  }));
}

const nestedPath = (root, candidate) => candidate === root || candidate.startsWith(`${root}${sep}`);
const isoTimestamp = (value) => typeof value === 'string'
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

export function readVerificationManifest(path = new URL('./local-verification-manifest.json', import.meta.url)) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || value.version !== 2 || !Array.isArray(value.tasks)
    || !Array.isArray(value.hostChecks)
    || !Array.isArray(value.rules) || !Array.isArray(value.companions)
    || !value.scope || !Array.isArray(value.scope.fullPrefixes) || !Array.isArray(value.scope.fullPaths)) {
    throw new TypeError('local verification manifest must have version 2, tasks and rules.');
  }
  return value;
}

function isManifestChange(path) {
  return path === 'package.json' || path === 'pnpm-lock.yaml' || path.endsWith('/package.json');
}

function isCleanDistChange(path) {
  return isManifestChange(path) || path.startsWith('tooling/') || path.includes('/src/') || path.startsWith('tsconfig');
}

function isDocsChange(path) {
  return path.startsWith('docs/') || path.startsWith('book/') || /(^|\/)README(?:\.ko)?\.md$/u.test(path)
    || path.startsWith('tooling/governance/');
}

export function verificationModeForChanges(changedFiles, manifest = readVerificationManifest()) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return 'full';
  for (const file of changedFiles) {
    if (typeof file !== 'string' || !file.startsWith('packages/') || isManifestChange(file)
      || manifest.scope.fullPaths.includes(file)
      || manifest.scope.fullPrefixes.some((prefix) => file.startsWith(prefix))) {
      return 'full';
    }
  }
  return 'scoped';
}

const COMPANION_TRIGGERS = {
  documentation: isDocsChange,
  'global-setup': (path) => /global[-_]?setup|setup\.(?:[cm]?[jt]s)$/iu.test(path),
  'module-importer': (path) => path.endsWith('.mjs') || path.includes('/import'),
  'package-manifest': isManifestChange,
  'public-source': (path) => path.startsWith('packages/') && path.includes('/src/'),
};

function companionDefinitions(manifest) {
  const definitions = new Map();
  for (const definition of manifest.companions) {
    if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' || definition.id.length === 0) {
      throw new TypeError('local verification companion trigger is malformed.');
    }
    if (definitions.has(definition.id)) {
      throw new TypeError(`local verification companion trigger is duplicate: ${definition.id}`);
    }
    if (typeof definition.when !== 'string' || definition.when.length === 0) {
      throw new TypeError(`local verification companion trigger is malformed: ${definition.id}`);
    }
    if (!Object.hasOwn(COMPANION_TRIGGERS, definition.when)) {
      throw new TypeError(`local verification companion trigger is unknown: ${definition.when}`);
    }
    if (!Array.isArray(definition.commands) || definition.commands.length === 0) {
      throw new TypeError(`local verification companion ${definition.id} has no executable commands.`);
    }
    definitions.set(definition.id, definition);
  }
  return definitions;
}

function companionChecks(changedFiles, manifest) {
  const definitions = companionDefinitions(manifest);
  return [...definitions.values()]
    .filter((definition) => changedFiles.some(COMPANION_TRIGGERS[definition.when]))
    .map((definition) => definition.id)
    .sort();
}

export function buildVerificationPlan({ changedFiles, identity, manifest = readVerificationManifest(), profile = 'pr',
  lock = loadEnvironmentLock() }) {
  if (!Array.isArray(changedFiles) || changedFiles.some((file) => typeof file !== 'string')) {
    throw new TypeError('changedFiles must be an array of paths.');
  }
  if (!['pr', 'extended'].includes(profile)) throw new TypeError(`unknown verification profile: ${profile}`);
  if (!hasExactIdentity(identity) || !identity.clean) throw new TypeError('plan requires an exact clean source identity');
  if (manifest.hostChecks?.length !== 1 || manifest.hostChecks[0].id !== 'runner-integration'
    || manifest.hostChecks[0].executable !== 'node' || manifest.hostChecks[0].cwd !== '.'
    || JSON.stringify(manifest.hostChecks[0].argv) !== JSON.stringify(['--test', 'tooling/ci/verification-runner.docker-test.mjs'])) {
    throw new TypeError('missing required host Docker integration check');
  }
  const definitions = companionDefinitions(manifest);
  const companionIds = companionChecks(changedFiles, manifest);
  const mode = verificationModeForChanges(changedFiles, manifest);
  const cleanDist = changedFiles.some(isCleanDistChange);
  const taskIds = new Set(manifest.tasks.map((task) => task.id));
  if (taskIds.size !== 16 || manifest.tasks.length !== 16) throw new TypeError('missing or duplicate required verification task');
  const required = ['build', 'static', ...Array.from({ length: 4 }, (_, i) => `packages-${i + 1}`),
    'tooling-1', 'tooling-2', 'starters', 'studio', 'compatibility-floor', 'compatibility-next',
    'runtime-floor', 'native-bun', 'native-web', 'packed'];
  if (required.some((id) => !taskIds.has(id))) throw new TypeError('missing required capability task');
  const applicableBenchmark = changedFiles.some((file) => file.startsWith('tooling/benchmarks/http-comparison/'));
  const tasks = manifest.tasks.map((definition) => {
    if (!['primary', 'compat24', 'compat26', 'runtimeFloor'].includes(definition.runtime)
      || !Array.isArray(definition.dependencies) || !Array.isArray(definition.capabilities)
      || !Array.isArray(definition.inputs) || !Array.isArray(definition.outputs)
      || !Array.isArray(definition.commands) || definition.commands.length === 0) {
      throw new TypeError(`malformed verification task: ${definition.id}`);
    }
    const commands = definition.commands.filter((item) => !item.when || item.when === 'isolated-benchmark' && applicableBenchmark)
      .map((item) => {
        if (!['pnpm', 'node', 'bun', 'deno'].includes(item.executable)
          || !Array.isArray(item.argv) || item.argv.some((arg) => typeof arg !== 'string') || item.cwd !== '.') {
          throw new TypeError(`malformed command in ${definition.id}`);
        }
        return { ...item, argv: item.argv.map((arg) => arg.replaceAll('{baseSha}', identity.baseSha)) };
      });
    if (profile === 'extended' && definition.id.startsWith('compatibility-')) {
      const packages = commands.findIndex(({ argv }) => argv.includes('--project') && argv.includes('packages'));
      if (packages === -1) throw new TypeError(`compatibility task ${definition.id} omits package tests`);
      commands.splice(packages, 1);
      commands.push(...[
        ['typecheck'], ['lint'], ['test:verify'],
      ].map((argv) => ({ executable: 'pnpm', argv, cwd: '.' })));
      const starter = commands.find((item) => item.env?.FLUO_CLI_SANDBOX_PROFILE);
      if (!starter) throw new TypeError(`compatibility task ${definition.id} omits starter coverage`);
      starter.env = { ...starter.env, FLUO_CLI_SANDBOX_PROFILE: 'full' };
    }
    if (profile === 'extended' && definition.id === 'starters') {
      commands.push({ executable: 'pnpm', argv: ['--dir', 'packages/cli', 'sandbox:matrix'], cwd: '.',
        env: { FLUO_CLI_SANDBOX_PROFILE: 'full', FLUO_CLI_SANDBOX_DEPENDENCIES: 'fresh' } });
    }
    return { ...definition, commands,
      capabilities: definition.capabilities.filter((capability) => capability !== 'isolated-benchmark' || applicableBenchmark) };
  });
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    if (task.dependencies.some((dependency) => !taskById.has(dependency) || dependency === task.id)) {
      throw new TypeError(`missing dependency or cycle for ${task.id}`);
    }
  }
  const seen = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new TypeError(`verification task cycle: ${id}`);
    if (seen.has(id)) return;
    visiting.add(id);
    for (const dependency of taskById.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    seen.add(id);
  };
  for (const task of tasks) visit(task.id);
  const capabilityTasks = {};
  for (const task of tasks) {
    for (const capability of task.capabilities) {
      (capabilityTasks[capability] ??= []).push(task.id);
    }
  }
  for (const id of companionIds) {
    if (!definitions.has(id) || !capabilityTasks[id]?.length) throw new TypeError(`missing companion capability: ${id}`);
  }
  for (const rule of manifest.rules) {
    if (!rule || typeof rule.prefix !== 'string' || !Array.isArray(rule.commands)) throw new TypeError('malformed manifest rule');
  }
  const environmentLockDigest = digest(JSON.stringify(lock));
  const imageKey = imageKeyFor(lock, readFileSync(new URL('./Dockerfile', import.meta.url)));
  const plan = {
    changedFiles: [...changedFiles],
    cleanDist,
    capabilityTasks,
    companionChecks: companionIds,
    environment: { lock, lockDigest: environmentLockDigest, imageKey },
    hostChecks: manifest.hostChecks,
    identity,
    manifestDigest: digest(JSON.stringify(manifest)),
    mode,
    notApplicableCapabilities: applicableBenchmark ? {} : { 'isolated-benchmark': 'no isolated benchmark changes' },
    profile,
    source: { headSha: identity.headSha, treeSha: identity.treeSha, baseSha: identity.baseSha },
    tasks,
    version: 2,
  };
  return { ...plan, semanticDigest: semanticPlanDigest(plan) };
}

function hasExactIdentity(identity) {
  return Boolean(
    identity && typeof identity.root === 'string' && identity.root.length > 0
    && typeof identity.baseRef === 'string' && identity.baseRef.length > 0
    && typeof identity.clean === 'boolean' && DIGEST.test(identity.worktreeStatusDigest)
    && [identity.headSha, identity.treeSha, identity.baseSha, identity.mergeBase].every((value) => SHA.test(value))
    && [identity.changedFilesDigest, identity.diffDigest].every((value) => DIGEST.test(value)),
  );
}

export function validateReceipt(receipt) {
  const failure = schemaFailure(receiptSchema, receipt, 'receipt');
  if (failure !== null) return { valid: false, reason: failure };
  if (receipt.version !== 2 || receipt.status !== 'passed') {
    return { valid: false, reason: 'receipt is not a passed v2 receipt' };
  }
  if (!hasExactIdentity(receipt.identity) || !receipt.identity.clean || !DIGEST.test(receipt.manifestDigest)
    || !DIGEST.test(receipt.planDigest) || !DIGEST.test(receipt.environmentLockDigest)
    || receipt.source.headSha !== receipt.identity.headSha || receipt.source.treeSha !== receipt.identity.treeSha
    || receipt.source.baseSha !== receipt.identity.baseSha || receipt.imageIdentity.key !== receipt.environment.imageKey
    || !/^sha256:[0-9a-f]{64}$/u.test(receipt.imageIdentity.id ?? '')) {
    return { valid: false, reason: 'receipt identity or digest is malformed' };
  }
  if (!isoTimestamp(receipt.startedAt) || !isoTimestamp(receipt.completedAt)
    || Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    return { valid: false, reason: 'receipt timestamps are malformed' };
  }
  if (!receipt.environment.lock || !Array.isArray(receipt.taskResults) || receipt.taskResults.length === 0
    || !Array.isArray(receipt.logs) || !Array.isArray(receipt.artifacts)
    || digest(JSON.stringify(receipt.environment.lock)) !== receipt.environmentLockDigest) {
    return { valid: false, reason: 'receipt is missing environment or task evidence' };
  }
  const host = receipt.hostChecks;
  if (host?.status !== 'passed' || host.planDigest !== receipt.planDigest
    || host.headSha !== receipt.source.headSha || host.treeSha !== receipt.source.treeSha
    || !Array.isArray(host.commands) || host.commands.length === 0
    || host.commands.some((item) => item.exitCode !== 0 || item.signal !== null || item.spawnError !== null)
    || !Array.isArray(host.logs) || host.logs.length !== host.commands.length
    || !receipt.logs.some((log) => log.path.endsWith('/results/host-checks.json'))
    || host.logs.some((log) => !receipt.logs.some((file) =>
      file.path.endsWith(`/results/${log.path}`) && file.digest === log.digest))) {
    return { valid: false, reason: 'receipt is missing successful host integration evidence' };
  }
  if (receipt.taskResults.some((result) => result?.status !== 'passed'
    || result.headSha !== receipt.source.headSha || result.treeSha !== receipt.source.treeSha
    || result.planDigest !== receipt.planDigest || result.imageKey !== receipt.imageIdentity.key
    || result.imageId !== receipt.imageIdentity.id
    || !Array.isArray(result.commands) || result.commands.length === 0
    || result.commands.some((item) => item.exitCode !== 0 || item.signal !== null || item.spawnError !== null
      || [item.identityBefore, item.identityAfter].some((boundary) =>
        boundary?.headSha !== receipt.source.headSha || boundary?.treeSha !== receipt.source.treeSha
        || boundary?.statusDigest !== digest(''))))) {
    return { valid: false, reason: 'receipt task is failed, incomplete or stale' };
  }
  try {
    for (const result of receipt.taskResults) {
      validateVerificationEnvironment({ lock: receipt.environment.lock, actual: result.environment,
        imageKey: receipt.imageIdentity.key });
    }
  } catch (error) {
    return { valid: false, reason: `receipt environment mismatch: ${error.message}` };
  }
  if (new Set(receipt.taskResults.map((item) => item.taskId)).size !== receipt.taskResults.length
    || !receipt.logs.every((item) => typeof item.path === 'string' && DIGEST.test(item.digest))
    || !receipt.artifacts.every((item) => typeof item.path === 'string' && DIGEST.test(item.digest))) {
    return { valid: false, reason: 'receipt task/log/artifact evidence is malformed' };
  }
  for (const result of receipt.taskResults) {
    if (!Array.isArray(result.logs) || result.logs.length !== result.commands.length
      || !receipt.logs.some((log) => log.path.endsWith(`/results/${result.taskId}.json`))
      || result.logs.some((log) => !receipt.logs.some((evidence) =>
        evidence.path.endsWith(`/results/${log.path}`) && evidence.digest === log.digest))
      || !Array.isArray(result.artifacts)
      || result.artifacts.some((file) => !receipt.artifacts.some((evidence) =>
        evidence.path.endsWith(`/artifacts/${file.path}`) && evidence.digest === file.digest))) {
      return { valid: false, reason: `receipt omits validated task logs or artifacts for ${result.taskId}` };
    }
  }
  return { valid: true };
}

export function receiptIsCurrent(receipt, identity) {
  return validateReceipt(receipt).valid && hasExactIdentity(identity) && receipt.identity.clean && identity.clean
    && ['root', 'baseRef', 'headSha', 'treeSha', 'baseSha', 'mergeBase', 'changedFilesDigest', 'diffDigest', 'worktreeStatusDigest']
      .every((key) => receipt.identity[key] === identity[key]);
}

export function receiptMatchesPlan(receipt, identity, plan) {
  if (!receiptIsCurrent(receipt, identity)
    || !plan || typeof plan !== 'object'
    || plan.version !== 2 || receipt.profile !== plan.profile
    || JSON.stringify(receipt.source) !== JSON.stringify(plan.source)
    || receipt.manifestDigest !== plan.manifestDigest
    || receipt.planDigest !== semanticPlanDigest(plan)
    || receipt.environmentLockDigest !== plan.environment.lockDigest
    || receipt.imageIdentity.key !== plan.environment.imageKey
    || JSON.stringify(receipt.capabilityTasks) !== JSON.stringify(plan.capabilityTasks)
    || JSON.stringify(receipt.hostChecks.commands.map(({ command }) => command)) !== JSON.stringify(plan.hostChecks)
    || !Array.isArray(plan.tasks) || receipt.taskResults.length !== plan.tasks.length) {
    return false;
  }
  return plan.tasks.every((expected) => {
    const result = receipt.taskResults.find((item) => item.taskId === expected.id);
    return result && result.commands.length === expected.commands.length
      && result.commands.every((item, index) => JSON.stringify(item.command) === JSON.stringify(expected.commands[index]));
  });
}

export function validateReceiptEvidence(receipt, { worktree, receiptPath, receiptSha256 }) {
  const validation = validateReceipt(receipt);
  if (!validation.valid) return validation;
  if (typeof worktree !== 'string' || typeof receiptPath !== 'string' || !DIGEST.test(receiptSha256)) {
    return { valid: false, reason: 'receipt evidence reference is malformed' };
  }
  const root = resolve(worktree);
  const evidenceRoot = resolve(root, '.omo', 'verification');
  const candidateReceipt = resolve(root, receiptPath);
  if (!nestedPath(evidenceRoot, candidateReceipt) || !existsSync(candidateReceipt)) {
    return { valid: false, reason: 'receipt evidence path escapes or is missing' };
  }
  let realEvidenceRoot;
  let realReceipt;
  let realWorktree;
  try {
    realWorktree = realpathSync(root);
    realEvidenceRoot = realpathSync(evidenceRoot);
    realReceipt = realpathSync(candidateReceipt);
  } catch {
    return { valid: false, reason: 'receipt evidence path is unresolved' };
  }
  if (realEvidenceRoot !== resolve(realWorktree, '.omo', 'verification')
    || !nestedPath(realEvidenceRoot, realReceipt)
    || digest(readFileSync(realReceipt)) !== receiptSha256) {
    return { valid: false, reason: 'receipt evidence digest is stale' };
  }
  for (const file of [...receipt.logs, ...receipt.artifacts]) {
    const candidate = resolve(root, file.path);
    if (!nestedPath(evidenceRoot, candidate) || !existsSync(candidate)) {
      return { valid: false, reason: 'receipt log or artifact path escapes or is missing' };
    }
    try {
      const actual = realpathSync(candidate);
      if (!nestedPath(realEvidenceRoot, actual) || digest(readFileSync(actual)) !== file.digest) {
        return { valid: false, reason: 'receipt log or artifact digest is stale' };
      }
    } catch {
      return { valid: false, reason: 'receipt log or artifact path is unresolved' };
    }
  }
  for (const result of receipt.taskResults) {
    const file = receipt.logs.find((log) => log.path.endsWith(`/results/${result.taskId}.json`));
    if (!file || JSON.stringify(JSON.parse(readFileSync(resolve(root, file.path), 'utf8'))) !== JSON.stringify(result)) {
      return { valid: false, reason: `receipt task result ${result.taskId} is stale` };
    }
  }
  const hostEvidence = receipt.logs.find((log) => log.path.endsWith('/results/host-checks.json'));
  if (!hostEvidence || JSON.stringify(JSON.parse(readFileSync(resolve(root, hostEvidence.path), 'utf8'))) !== JSON.stringify(receipt.hostChecks)) {
    return { valid: false, reason: 'receipt host integration result is stale' };
  }
  return { valid: true };
}

export function manifestPath(root) {
  return resolve(root, 'tooling/ci/local-verification-manifest.json');
}
