import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const REQUIRED = ['install', 'build', 'typecheck', 'test', 'lint', 'platform-governance'];

const command = (id, argv) => ({ argv, cwd: '.', executable: 'pnpm', id });
const node = (id, argv) => ({ argv, cwd: '.', executable: 'node', id });

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function readVerificationManifest(path = new URL('./local-verification-manifest.json', import.meta.url)) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.rules)) {
    throw new TypeError('local verification manifest must have version 1 and rules.');
  }
  return value;
}

function isManifestChange(path) {
  return path === 'package.json' || path === 'pnpm-lock.yaml' || path.endsWith('/package.json');
}

function isCleanDistChange(path) {
  return isManifestChange(path) || path.startsWith('tooling/scripts/') || path.includes('/src/') || path.startsWith('tsconfig');
}

function isDocsChange(path) {
  return path.startsWith('docs/') || path.startsWith('book/') || /(^|\/)README(?:\.ko)?\.md$/u.test(path)
    || path.startsWith('tooling/governance/');
}

export function buildVerificationPlan({ changedFiles, identity, manifest = readVerificationManifest() }) {
  if (!Array.isArray(changedFiles) || changedFiles.some((file) => typeof file !== 'string')) {
    throw new TypeError('changedFiles must be an array of paths.');
  }
  const forceFull = changedFiles.length === 0 || changedFiles.some((file) =>
    !file.startsWith('packages/') || file.startsWith('.github/') || isManifestChange(file));
  const cleanDist = changedFiles.some(isCleanDistChange);
  const commands = [
    command('install', ['install', '--frozen-lockfile']),
    command('build', ['build']),
    command('typecheck', ['typecheck']),
    command('test', ['test']),
    command('lint', ['lint']),
    command('platform-governance', ['verify:platform-consistency-governance']),
  ];
  if (changedFiles.some((file) => file.endsWith('.mjs') || file.includes('/import'))) {
    commands.push(node('declaration-parity', ['tooling/governance/declaration-parity.test.mjs']));
  }
  if (changedFiles.some(isDocsChange)) {
    commands.push(command('docs', ['verify:docs']));
  }
  for (const rule of manifest.rules) {
    if (!rule || typeof rule !== 'object' || typeof rule.prefix !== 'string' || !Array.isArray(rule.argv)) {
      throw new TypeError('local verification manifest rule is malformed.');
    }
    if (changedFiles.some((file) => file.startsWith(rule.prefix))) {
      commands.push(command(`manifest:${rule.prefix}`, rule.argv));
    }
  }
  return {
    cleanDist,
    commands,
    identity,
    manifestDigest: digest(JSON.stringify(manifest)),
    mode: forceFull ? 'full' : 'scoped',
  };
}

function hasExactIdentity(identity) {
  return Boolean(
    identity && typeof identity.root === 'string' && identity.root.length > 0
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
    seen.add(result.id);
  }
  if (!REQUIRED.every((id) => seen.has(id))) return { valid: false, reason: 'receipt omits a required command' };
  if (!receipt.logs.every((log) => log && typeof log.path === 'string' && DIGEST.test(log.digest))) {
    return { valid: false, reason: 'receipt log evidence is malformed' };
  }
  return { valid: true };
}

export function receiptIsCurrent(receipt, identity) {
  return validateReceipt(receipt).valid && hasExactIdentity(identity)
    && ['root', 'headSha', 'treeSha', 'baseSha', 'mergeBase', 'changedFilesDigest', 'diffDigest']
      .every((key) => receipt.identity[key] === identity[key]);
}

export function manifestPath(root) {
  return resolve(root, 'tooling/ci/local-verification-manifest.json');
}
