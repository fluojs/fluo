import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const REQUIRED = ['install', 'build', 'typecheck', 'test', 'lint', 'platform-governance'];

const command = (id, argv) => ({ argv, cwd: '.', executable: 'pnpm', id });

export const digest = (value) => createHash('sha256').update(value).digest('hex');

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

function companionChecks(changedFiles, manifest) {
  const checks = new Set();
  for (const file of changedFiles) {
    if (isManifestChange(file)) {
      checks.add('manifest-lockfile');
      checks.add('package-dependency-closure');
    }
    if (file.endsWith('.mjs') || file.includes('/import')) checks.add('declaration-importers');
    if (file.startsWith('packages/') && file.includes('/src/')) checks.add('source-copy-inventory');
    if (isDocsChange(file)) checks.add('documentation-governance');
    if (/global[-_]?setup|setup\.(?:[cm]?[jt]s)$/iu.test(file)) checks.add('global-setup-contract');
  }
  const known = new Set(manifest.companions.map((rule) => rule?.id));
  if ([...checks].some((id) => !known.has(id))) throw new TypeError('local verification companion manifest is incomplete.');
  return [...checks].sort();
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
  const companionDefinitions = new Map(manifest.companions.map((item) => [item?.id, item]));
  for (const id of companionIds) {
    commands.push(...executableCommands(id, companionDefinitions));
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
    && typeof identity.clean === 'boolean' && DIGEST.test(identity.worktreeStatusDigest)
    && [identity.headSha, identity.treeSha, identity.baseSha, identity.mergeBase].every((value) => SHA.test(value))
    && [identity.changedFilesDigest, identity.diffDigest].every((value) => DIGEST.test(value)),
  );
}

export function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.version !== 1 || receipt.status !== 'passed') {
    return { valid: false, reason: 'receipt is not a passed v1 receipt' };
  }
  if (!hasExactIdentity(receipt.identity) || !DIGEST.test(receipt.manifestDigest) || !DIGEST.test(receipt.planDigest)) {
    return { valid: false, reason: 'receipt identity or digest is malformed' };
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
    if (!hasExactIdentity(result.identityBefore) || !hasExactIdentity(result.identityAfter)
      || !result.identityBefore.clean || !result.identityAfter.clean
      || !['baseSha', 'changedFilesDigest', 'diffDigest', 'headSha', 'mergeBase', 'treeSha', 'worktreeStatusDigest']
        .every((key) => result.identityBefore[key] === receipt.identity[key] && result.identityAfter[key] === receipt.identity[key])) {
      return { valid: false, reason: 'receipt command boundary identity is stale or dirty' };
    }
    seen.add(result.id);
  }
  if (!REQUIRED.every((id) => seen.has(id))) return { valid: false, reason: 'receipt omits a required command' };
  if (!receipt.logs.every((log) => log && typeof log.path === 'string' && DIGEST.test(log.digest))) {
    return { valid: false, reason: 'receipt log evidence is malformed' };
  }
  return { valid: true };
}

export function receiptIsCurrent(receipt, identity) {
  return validateReceipt(receipt).valid && hasExactIdentity(identity) && receipt.identity.clean && identity.clean
    && ['root', 'headSha', 'treeSha', 'baseSha', 'mergeBase', 'changedFilesDigest', 'diffDigest', 'worktreeStatusDigest']
      .every((key) => receipt.identity[key] === identity[key]);
}

export function manifestPath(root) {
  return resolve(root, 'tooling/ci/local-verification-manifest.json');
}
