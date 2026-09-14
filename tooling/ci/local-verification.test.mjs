import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import {
  buildVerificationPlan,
  digest,
  readVerificationManifest,
  receiptMatchesPlan,
  receiptIsCurrent,
  validateReceiptEvidence,
  validateReceipt,
} from './local-verification.mjs';

const identity = {
  baseRef: 'origin/main',
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

const passingReceipt = (plan, receiptIdentity = plan.identity) => ({
  commands: plan.commands.map((command) => ({
    ...command,
    exitCode: 0,
    finishedAt: '2026-09-14T00:00:01.000Z',
    identityAfter: receiptIdentity,
    identityBefore: receiptIdentity,
    signal: null,
    spawnError: null,
    startedAt: '2026-09-14T00:00:00.000Z',
  })),
  completedAt: '2026-09-14T00:00:01.000Z',
  environment: {},
  identity: receiptIdentity,
  limitations: [],
  logs: plan.commands.map((command, index) => ({
    commandId: command.id,
    digest: `${index}`.padStart(64, '0'),
    path: `.omo/verification/logs/${receiptIdentity.headSha}/${index}.log`,
  })),
  manifestDigest: plan.manifestDigest,
  planDigest: digest(JSON.stringify(plan.commands)),
  startedAt: '2026-09-14T00:00:00.000Z',
  status: 'passed',
  version: 1,
});

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

test('selects companion commands from the manifest when predicate', () => {
  const manifest = structuredClone(readVerificationManifest());
  const closure = manifest.companions.find(({ id }) => id === 'package-dependency-closure');
  closure.when = 'documentation';

  const packagePlan = buildVerificationPlan({
    changedFiles: ['packages/core/package.json'],
    identity,
    manifest,
  });
  assert.equal(
    packagePlan.commands.some(({ id }) => id === 'companion:package-dependency-closure'),
    false,
  );

  const docsPlan = buildVerificationPlan({
    changedFiles: ['docs/reference/node-support.md'],
    identity,
    manifest,
  });
  assert.equal(
    docsPlan.commands.some(({ id }) => id === 'companion:package-dependency-closure'),
    true,
  );
});

test('fails closed for malformed, duplicate, and unknown companion triggers', () => {
  const malformed = structuredClone(readVerificationManifest());
  malformed.companions[0].when = '';
  assert.throws(
    () => buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest: malformed }),
    /trigger/u,
  );

  const duplicate = structuredClone(readVerificationManifest());
  duplicate.companions[1].id = duplicate.companions[0].id;
  assert.throws(
    () => buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest: duplicate }),
    /duplicate/u,
  );

  const unknown = structuredClone(readVerificationManifest());
  unknown.companions[0].when = 'not-a-supported-trigger';
  assert.throws(
    () => buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest: unknown }),
    /unknown/u,
  );
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
      finishedAt: '2026-09-14T00:00:01.000Z',
      id,
      identityAfter: identity,
      identityBefore: identity,
      signal: null,
      spawnError: null,
      startedAt: '2026-09-14T00:00:00.000Z',
    })),
    completedAt: '2026-09-14T00:00:01.000Z',
    environment: {},
    identity,
    limitations: [],
    logs: [
      'install', 'build', 'typecheck', 'test', 'lint', 'platform-governance',
    ].map((commandId, index) => ({
      commandId,
      digest: `${index}`.padStart(64, '0'),
      path: `.omo/verification/logs/head/${index}.log`,
    })),
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

test('requires a receipt to attest the canonical base and exact verification plan', () => {
  const plan = buildVerificationPlan({ changedFiles: [], identity });
  const receipt = passingReceipt(plan);

  assert.equal(receiptMatchesPlan(receipt, identity, plan), true);
  assert.equal(
    receiptMatchesPlan({ ...receipt, identity: { ...identity, baseRef: 'HEAD' } }, identity, plan),
    false,
  );

  const omitted = receipt.commands.slice(1);
  assert.equal(
    receiptMatchesPlan({
      ...receipt,
      commands: omitted,
      planDigest: digest(JSON.stringify(omitted.map(({ argv, cwd, executable, id }) => ({ argv, cwd, executable, id })))),
    }, identity, plan),
    false,
  );
});

test('authenticates exact receipt and command log bytes within evidence root', () => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-local-verification-'));
  const receiptIdentity = { ...identity, root };
  const plan = buildVerificationPlan({ changedFiles: [], identity: receiptIdentity });
  const receipt = passingReceipt(plan, receiptIdentity);

  try {
    for (const [index, log] of receipt.logs.entries()) {
      const path = join(root, log.path);
      mkdirSync(join(path, '..'), { recursive: true });
      const content = `command ${index}`;
      writeFileSync(path, content);
      receipt.logs[index] = { ...log, digest: digest(content) };
    }
    const receiptPath = join(root, '.omo/verification/receipt.json');
    const bytes = `${JSON.stringify(receipt)}\n`;
    writeFileSync(receiptPath, bytes);

    assert.equal(validateReceiptEvidence(receipt, {
      receiptPath: relative(root, receiptPath),
      receiptSha256: digest(bytes),
      worktree: root,
    }).valid, true);

    writeFileSync(join(root, receipt.logs[0].path), 'tampered');
    assert.equal(validateReceiptEvidence(receipt, {
      receiptPath: relative(root, receiptPath),
      receiptSha256: digest(bytes),
      worktree: root,
    }).valid, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects an evidence root symlink that escapes the real worktree', () => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-local-verification-worktree-'));
  const externalEvidenceRoot = mkdtempSync(join(tmpdir(), 'fluo-local-verification-external-'));
  const receiptIdentity = { ...identity, root };
  const plan = buildVerificationPlan({ changedFiles: [], identity: receiptIdentity });
  const receipt = passingReceipt(plan, receiptIdentity);

  try {
    mkdirSync(join(root, '.omo'), { recursive: true });
    symlinkSync(externalEvidenceRoot, join(root, '.omo/verification'));
    for (const [index, log] of receipt.logs.entries()) {
      const path = join(root, log.path);
      mkdirSync(join(path, '..'), { recursive: true });
      const content = `command ${index}`;
      writeFileSync(path, content);
      receipt.logs[index] = { ...log, digest: digest(content) };
    }
    const receiptPath = join(root, '.omo/verification/receipt.json');
    const bytes = `${JSON.stringify(receipt)}\n`;
    writeFileSync(receiptPath, bytes);

    assert.equal(validateReceiptEvidence(receipt, {
      receiptPath: relative(root, receiptPath),
      receiptSha256: digest(bytes),
      worktree: root,
    }).valid, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(externalEvidenceRoot, { force: true, recursive: true });
  }
});

test('rejects malformed receipt timestamps before filesystem validation', () => {
  const plan = buildVerificationPlan({ changedFiles: [], identity });
  const receipt = passingReceipt(plan);

  assert.equal(validateReceipt({
    ...receipt,
    commands: [{ ...receipt.commands[0], startedAt: 'not-a-timestamp' }, ...receipt.commands.slice(1)],
  }).valid, false);
});

test('enforces every canonical receipt schema top-level requirement at runtime', () => {
  const plan = buildVerificationPlan({ changedFiles: [], identity });
  const receipt = passingReceipt(plan);
  const requiredTopLevel = [
    'version', 'status', 'identity', 'environment', 'commands', 'logs',
    'manifestDigest', 'planDigest', 'startedAt', 'completedAt', 'limitations',
  ];

  for (const key of requiredTopLevel) {
    const malformed = { ...receipt };
    delete malformed[key];
    assert.equal(validateReceipt(malformed).valid, false, `missing ${key} must be rejected`);
  }
  assert.equal(validateReceipt({ ...receipt, environment: [] }).valid, false);
  assert.equal(validateReceipt({ ...receipt, limitations: [1] }).valid, false);
  assert.equal(validateReceipt({
    ...receipt,
    commands: [{ ...receipt.commands[0], argv: [1] }, ...receipt.commands.slice(1)],
  }).valid, false);
  assert.equal(validateReceipt({
    ...receipt,
    logs: [{ ...receipt.logs[0], path: '' }, ...receipt.logs.slice(1)],
  }).valid, false);
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
  assert.equal(schema.properties.logs.items.required.includes('commandId'), true);
});
