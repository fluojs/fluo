import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  clean: true,
  diffDigest: 'd'.repeat(64),
  headSha: 'a'.repeat(40),
  mergeBase: 'e'.repeat(40),
  root: '/repo',
  treeSha: 'f'.repeat(40),
  worktreeStatusDigest: '0'.repeat(64),
};

test('plans frozen install before build, typecheck, tests, lint, and governance', () => {
  const plan = buildVerificationPlan({ changedFiles: ['packages/core/src/index.ts'], identity });

  assert.deepEqual(
    plan.commands.map((command) => command.argv.slice(0, 2).join(' ')),
    ['install --frozen-lockfile', '-r --filter', 'build', 'typecheck', 'test:verify', 'lint', 'verify:platform-consistency-governance', 'test:verify'],
  );
  assert.equal(plan.mode, 'scoped');
});

test('fails closed to full coverage for an unknown or manifest change', () => {
  assert.equal(buildVerificationPlan({ changedFiles: ['unknown.txt'], identity }).mode, 'full');
  const plan = buildVerificationPlan({ changedFiles: ['packages/core/package.json'], identity });
  assert.equal(plan.cleanDist, true);
  assert.ok(plan.commands.findIndex(({ id }) => id === 'clean-dist') < plan.commands.findIndex(({ id }) => id === 'build'));
  assert.deepEqual(
    plan.commands.find(({ id }) => id === 'clean-dist')?.argv,
    ['-r', '--filter', './packages/*', 'exec', 'node', '../../tooling/scripts/clean-dist.mjs'],
  );
});

test('adds importer declaration parity and docs consumers to the plan', () => {
  const plan = buildVerificationPlan({
    changedFiles: ['tooling/ci/new-importer.mjs', 'docs/reference/node-support.md'],
    identity,
  });

  const commands = plan.commands.map((command) => command.argv.join(' '));
  assert.equal(commands.includes('typecheck'), true);
  assert.equal(commands.includes('verify:public-export-tsdoc'), true);
  assert.equal(commands.includes('verify:docs'), true);
});

test('maps every triggered companion to executable commands', () => {
  const plan = buildVerificationPlan({
    changedFiles: [
      'packages/core/package.json',
      'packages/core/src/index.mjs',
      'docs/reference/node-support.md',
      'packages/core/test/global-setup.ts',
    ],
    identity,
  });

  const companionCommands = plan.commands.filter(({ id }) => id.startsWith('companion:'));
  assert.deepEqual(
    new Set(companionCommands.map(({ id }) => id)),
    new Set([
      'companion:declaration-importers',
      'companion:documentation-governance',
      'companion:global-setup-contract',
      'companion:manifest-lockfile',
      'companion:package-dependency-closure',
      'companion:source-copy-inventory',
    ]),
  );
  assert.ok(companionCommands.every(({ argv, executable }) => executable.length > 0 && argv.length > 0));
});

test('runs native Deno build, check, and test surfaces', () => {
  const plan = buildVerificationPlan({ changedFiles: ['packages/platform-deno/src/adapter.ts'], identity });

  assert.deepEqual(
    plan.commands.filter(({ id }) => id.startsWith('manifest:packages/platform-deno/')).map(({ argv, executable }) => ({ argv, executable })),
    [
      { executable: 'node', argv: ['tooling/scripts/run-workspace-build-closure.mjs', '@fluojs/platform-deno'] },
      { executable: 'deno', argv: ['check', '--no-lock', '--node-modules-dir=auto', '--config', 'packages/platform-deno/deno/deno.json', 'npm:@fluojs/platform-deno'] },
      { executable: 'deno', argv: ['test', '--no-lock', '--config', 'packages/platform-deno/deno/deno.json', '--allow-net', '--allow-read', 'packages/platform-deno/deno/native-adapter.test.js'] },
    ],
  );
});

test('accepts only complete successful receipts for the exact current identity', () => {
  const receipt = {
    commands: [
      'install', 'build', 'typecheck', 'test', 'lint', 'platform-governance',
    ].map((id) => ({
      argv: [id],
      cwd: '/repo',
      executable: 'pnpm',
      exitCode: 0,
      id,
      identityAfter: identity,
      identityBefore: identity,
      signal: null,
      spawnError: null,
    })),
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
  assert.equal(receiptIsCurrent(receipt, { ...identity, clean: false }), false);
  assert.equal(
    validateReceipt({
      ...receipt,
      commands: [...receipt.commands, {
        ...receipt.commands[0],
        exitCode: 1,
        id: 'companion:source-copy-inventory',
      }],
    }).valid,
    false,
  );
});

test('rejects incomplete, failed, and plan-only receipts', () => {
  const base = {
    commands: [{
      argv: ['build'],
      cwd: '/repo',
      executable: 'pnpm',
      exitCode: 0,
      identityAfter: identity,
      identityBefore: identity,
      signal: null,
      spawnError: null,
    }],
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

test('typed receipt schema requires clean worktree and command-boundary identities', () => {
  const schema = JSON.parse(
    readFileSync(new URL('./local-verification-receipt.schema.json', import.meta.url), 'utf8'),
  );
  const identityRequired = schema.$defs.identity.required;
  const commandItems = schema.properties.commands.items;

  assert.equal(identityRequired.includes('clean'), true);
  assert.equal(identityRequired.includes('worktreeStatusDigest'), true);
  assert.equal(commandItems.required.includes('identityBefore'), true);
  assert.equal(commandItems.required.includes('identityAfter'), true);
});
