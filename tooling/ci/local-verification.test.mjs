import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVerificationPlan,
  receiptIsCurrent,
  validateReceipt,
} from './local-verification.mjs';

const identity = {
  baseRef: 'main',
  baseSha: 'b'.repeat(40),
  changedFilesDigest: 'c'.repeat(64),
  diffDigest: 'd'.repeat(64),
  headSha: 'a'.repeat(40),
  mergeBase: 'e'.repeat(40),
  root: '/repo',
  treeSha: 'f'.repeat(40),
};

test('plans frozen install before build, typecheck, tests, lint, and governance', () => {
  const plan = buildVerificationPlan({ changedFiles: ['packages/core/src/index.ts'], identity });

  assert.deepEqual(
    plan.commands.map((command) => command.argv.slice(0, 2).join(' ')),
    ['install --frozen-lockfile', 'build', 'typecheck', 'test', 'lint', 'verify:platform-consistency-governance'],
  );
  assert.equal(plan.mode, 'scoped');
});

test('fails closed to full coverage for an unknown or manifest change', () => {
  assert.equal(buildVerificationPlan({ changedFiles: ['unknown.txt'], identity }).mode, 'full');
  assert.equal(buildVerificationPlan({ changedFiles: ['packages/core/package.json'], identity }).cleanDist, true);
});

test('adds importer declaration parity and docs consumers to the plan', () => {
  const plan = buildVerificationPlan({
    changedFiles: ['tooling/ci/new-importer.mjs', 'docs/reference/node-support.md'],
    identity,
  });

  const commands = plan.commands.map((command) => command.argv.join(' '));
  assert.equal(commands.includes('typecheck'), true);
  assert.equal(commands.includes('tooling/governance/declaration-parity.test.mjs'), true);
  assert.equal(commands.includes('verify:docs'), true);
});

test('accepts only complete successful receipts for the exact current identity', () => {
  const receipt = {
    commands: [
      'install', 'build', 'typecheck', 'test', 'lint', 'platform-governance',
    ].map((id) => ({ argv: [id], cwd: '/repo', executable: 'pnpm', exitCode: 0, id, signal: null, spawnError: null })),
    completedAt: '2026-09-14T00:00:01.000Z',
    identity,
    limitations: [],
    logs: [{ digest: '1'.repeat(64), path: '.artifacts/local-verification/build.log' }],
    manifestDigest: '2'.repeat(64),
    planDigest: '3'.repeat(64),
    startedAt: '2026-09-14T00:00:00.000Z',
    status: 'passed',
    version: 1,
  };

  assert.deepEqual(validateReceipt(receipt), { valid: true });
  assert.equal(receiptIsCurrent(receipt, identity), true);
  assert.equal(receiptIsCurrent(receipt, { ...identity, treeSha: '0'.repeat(40) }), false);
});

test('rejects incomplete, failed, and plan-only receipts', () => {
  const base = {
    commands: [{ argv: ['build'], cwd: '/repo', executable: 'pnpm', exitCode: 0, signal: null, spawnError: null }],
    completedAt: '2026-09-14T00:00:01.000Z',
    identity,
    limitations: [],
    logs: [{ digest: '1'.repeat(64), path: '.artifacts/local-verification/build.log' }],
    manifestDigest: '2'.repeat(64),
    planDigest: '3'.repeat(64),
    startedAt: '2026-09-14T00:00:00.000Z',
    status: 'passed',
    version: 1,
  };

  assert.equal(validateReceipt({ ...base, commands: [] }).valid, false);
  assert.equal(validateReceipt({ ...base, status: 'planned' }).valid, false);
  assert.equal(validateReceipt({ ...base, commands: [{ ...base.commands[0], signal: 'SIGTERM' }] }).valid, false);
});
