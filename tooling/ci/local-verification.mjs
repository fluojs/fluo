import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { schemaFailure } from '../../.agents/workflow-contracts/schema-validator.mjs';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const REQUIRED = ['install', 'build', 'typecheck', 'test', 'lint', 'platform-governance'];
const receiptSchema = JSON.parse(readFileSync(new URL('./local-verification-receipt.schema.json', import.meta.url), 'utf8'));

const command = (id, argv) => ({ argv, cwd: '.', executable: 'pnpm', id });

export const digest = (value) => createHash('sha256').update(value).digest('hex');

const nestedPath = (root, candidate) => candidate === root || candidate.startsWith(`${root}${sep}`);
const isoTimestamp = (value) => typeof value === 'string'
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

export function readVerificationManifest(path = new URL('./local-verification-manifest.json', import.meta.url)) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.rules) || !Array.isArray(value.companions)
    || !value.scope || !Array.isArray(value.scope.fullPrefixes) || !Array.isArray(value.scope.fullPaths)) {
    throw new TypeError('local verification manifest must have version 1 and rules.');
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

function executableCommands(id, definitions) {
  const definition = definitions.get(id);
  if (!definition || !Array.isArray(definition.commands) || definition.commands.length === 0) {
    throw new TypeError(`local verification companion ${id} has no executable commands.`);
  }
  return definition.commands.map((item, index) => {
    if (!item || typeof item !== 'object' || typeof item.executable !== 'string' || item.executable.length === 0
      || !Array.isArray(item.argv) || item.argv.some((value) => typeof value !== 'string')
      || typeof item.cwd !== 'string' || item.cwd.length === 0) {
      throw new TypeError(`local verification companion ${id} command is malformed.`);
    }
    const suffix = definition.commands.length === 1 ? '' : `:${index}`;
    return { argv: item.argv, cwd: item.cwd, executable: item.executable, id: `companion:${id}${suffix}` };
  });
}

export function buildVerificationPlan({ changedFiles, identity, manifest = readVerificationManifest() }) {
  if (!Array.isArray(changedFiles) || changedFiles.some((file) => typeof file !== 'string')) {
    throw new TypeError('changedFiles must be an array of paths.');
  }
  const mode = verificationModeForChanges(changedFiles, manifest);
  const cleanDist = changedFiles.some(isCleanDistChange);
  const commands = [
    command('install', ['install', '--frozen-lockfile']),
    ...(cleanDist ? [command('clean-dist', ['-r', '--filter', './packages/*', 'exec', 'node', '../../tooling/scripts/clean-dist.mjs'])] : []),
    command('build', ['build']),
    command('typecheck', ['typecheck']),
    command('test', ['test:verify']),
    command('lint', ['lint']),
    command('platform-governance', ['verify:platform-consistency-governance']),
  ];
  if (changedFiles.some((file) => file.endsWith('.mjs') || file.includes('/import'))) {
    commands.push(command('declaration-parity', ['verify:public-export-tsdoc']));
  }
  if (changedFiles.some(isDocsChange)) {
    commands.push(command('docs', ['verify:docs']));
  }
  const companionIds = companionChecks(changedFiles, manifest);
  const companionDefinitionMap = companionDefinitions(manifest);
  for (const id of companionIds) {
    commands.push(...executableCommands(id, companionDefinitionMap));
  }
  for (const rule of manifest.rules) {
    if (!rule || typeof rule !== 'object' || typeof rule.prefix !== 'string' || !Array.isArray(rule.commands)) {
      throw new TypeError('local verification manifest rule is malformed.');
    }
    if (changedFiles.some((file) => file.startsWith(rule.prefix))) {
      commands.push(...executableCommands(rule.prefix, new Map([[rule.prefix, rule]]))
        .map((item) => ({ ...item, id: item.id.replace(`companion:${rule.prefix}`, `manifest:${rule.prefix}`) })));
    }
  }
  return {
    cleanDist,
    companionChecks: companionIds,
    commands,
    identity,
    manifestDigest: digest(JSON.stringify(manifest)),
    mode,
  };
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
  if (!receipt || typeof receipt !== 'object' || receipt.version !== 1 || receipt.status !== 'passed') {
    return { valid: false, reason: 'receipt is not a passed v1 receipt' };
  }
  if (!hasExactIdentity(receipt.identity) || !DIGEST.test(receipt.manifestDigest) || !DIGEST.test(receipt.planDigest)) {
    return { valid: false, reason: 'receipt identity or digest is malformed' };
  }
  if (!isoTimestamp(receipt.startedAt) || !isoTimestamp(receipt.completedAt)
    || Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    return { valid: false, reason: 'receipt timestamps are malformed' };
  }
  if (!Array.isArray(receipt.commands) || receipt.commands.length === 0 || !Array.isArray(receipt.logs) || receipt.logs.length === 0) {
    return { valid: false, reason: 'receipt is missing command or log evidence' };
  }
  const seen = new Set();
  for (const result of receipt.commands) {
    if (!result || typeof result.executable !== 'string' || !Array.isArray(result.argv) || typeof result.cwd !== 'string'
      || result.exitCode !== 0 || result.signal !== null || result.spawnError !== null || seen.has(result.id)) {
      return { valid: false, reason: 'receipt command evidence is incomplete or failed' };
    }
    if (!isoTimestamp(result.startedAt) || !isoTimestamp(result.finishedAt)
      || Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      return { valid: false, reason: 'receipt command timestamps are malformed' };
    }
    if (!hasExactIdentity(result.identityBefore) || !hasExactIdentity(result.identityAfter)
      || !result.identityBefore.clean || !result.identityAfter.clean
      || !['baseRef', 'baseSha', 'changedFilesDigest', 'diffDigest', 'headSha', 'mergeBase', 'root', 'treeSha', 'worktreeStatusDigest']
        .every((key) => result.identityBefore[key] === receipt.identity[key] && result.identityAfter[key] === receipt.identity[key])) {
      return { valid: false, reason: 'receipt command boundary identity is stale or dirty' };
    }
    seen.add(result.id);
  }
  if (!REQUIRED.every((id) => seen.has(id))) return { valid: false, reason: 'receipt omits a required command' };
  const logIds = new Set();
  if (receipt.logs.length !== receipt.commands.length
    || !receipt.logs.every((log) => log && typeof log.path === 'string' && DIGEST.test(log.digest)
      && typeof log.commandId === 'string' && seen.has(log.commandId) && !logIds.has(log.commandId)
      && (logIds.add(log.commandId) || true))) {
    return { valid: false, reason: 'receipt log evidence is malformed' };
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
    || receipt.manifestDigest !== plan.manifestDigest
    || receipt.planDigest !== digest(JSON.stringify(plan.commands))
    || !Array.isArray(plan.commands)
    || receipt.commands.length !== plan.commands.length) {
    return false;
  }
  return receipt.commands.every((result, index) => {
    const expected = plan.commands[index];
    return result.id === expected.id
      && result.executable === expected.executable
      && result.cwd === expected.cwd
      && JSON.stringify(result.argv) === JSON.stringify(expected.argv);
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
  for (const log of receipt.logs) {
    const candidateLog = resolve(root, log.path);
    if (!nestedPath(evidenceRoot, candidateLog) || !existsSync(candidateLog)) {
      return { valid: false, reason: 'receipt log path escapes or is missing' };
    }
    try {
      const realLog = realpathSync(candidateLog);
      if (!nestedPath(realEvidenceRoot, realLog) || digest(readFileSync(realLog)) !== log.digest) {
        return { valid: false, reason: 'receipt log digest is stale' };
      }
    } catch {
      return { valid: false, reason: 'receipt log path is unresolved' };
    }
  }
  return { valid: true };
}

export function manifestPath(root) {
  return resolve(root, 'tooling/ci/local-verification-manifest.json');
}
