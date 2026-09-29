import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { buildVerificationPlan, digest, readVerificationManifest, receiptMatchesPlan,
  receiptIsCurrent, validateReceiptEvidence, validateReceipt } from './local-verification.mjs';

const identity = {
  baseRef: 'b'.repeat(40), baseSha: 'b'.repeat(40), changedFilesDigest: 'c'.repeat(64),
  clean: true, diffDigest: 'd'.repeat(64), headSha: 'a'.repeat(40),
  mergeBase: 'b'.repeat(40), root: '/repo', treeSha: 'f'.repeat(40),
  worktreeStatusDigest: '0'.repeat(64),
};

function testEnvironment(lock) {
  return {
    os: 'linux', arch: 'arm64',
    node: Object.fromEntries(Object.entries(lock.node).map(([name, value]) => [name, value.version])),
    bun: Object.fromEntries(Object.entries(lock.bun).map(([name, value]) => [name, value.version])),
    deno: Object.fromEntries(Object.entries(lock.deno).map(([name, value]) => [name, value.version])),
    pnpm: lock.pnpm.version,
    browser: { channel: lock.browser.channel, version: lock.browser.version, launched: true },
    docker: { reachable: true, version: '28.3.3', cliVersion: lock.docker.version },
    redis: { ping: 'PONG', image: lock.redis.image },
    watch: { linuxVolume: true, event: 'rename' },
  };
}

function receiptFor(plan, receiptIdentity = plan.identity) {
  const planDigest = plan.semanticDigest;
  const hostChecks = {
    status: 'passed', planDigest, headSha: plan.source.headSha, treeSha: plan.source.treeSha,
    commands: plan.hostChecks.map((command) => ({ command, exitCode: 0, signal: null, spawnError: null })),
    logs: plan.hostChecks.map((_, index) => ({ path: `host-check-${index}.log`, digest: digest('log') })),
  };
  const taskResults = plan.tasks.map((task) => ({
    version: 2, status: 'passed', taskId: task.id, imageKey: plan.environment.imageKey,
    imageId: `sha256:${'1'.repeat(64)}`, headSha: plan.source.headSha, treeSha: plan.source.treeSha,
    planDigest, environment: testEnvironment(plan.environment.lock),
    logs: task.commands.map((_, index) => ({ commandIndex: index, path: `${task.id}-${index}.log`, digest: digest('log') })),
    artifacts: [],
    commands: task.commands.map((command) => ({ command, exitCode: 0, signal: null, spawnError: null,
      identityBefore: { headSha: plan.source.headSha, treeSha: plan.source.treeSha, statusDigest: digest('') },
      identityAfter: { headSha: plan.source.headSha, treeSha: plan.source.treeSha, statusDigest: digest('') } })),
  }));
  return {
    version: 2, status: 'passed', profile: plan.profile, identity: receiptIdentity,
    source: plan.source, environment: { imageKey: plan.environment.imageKey, lock: plan.environment.lock },
    imageIdentity: { key: plan.environment.imageKey, id: `sha256:${'1'.repeat(64)}` },
    environmentLockDigest: plan.environment.lockDigest, manifestDigest: plan.manifestDigest,
    planDigest, hostChecks, taskResults, capabilityTasks: plan.capabilityTasks,
    logs: taskResults.flatMap((result) => [
      ...result.logs.map((log) => ({ path: `.omo/verification/ci-parity/runner/results/${log.path}`, digest: log.digest })),
      { path: `.omo/verification/ci-parity/runner/results/${result.taskId}.json`,
        digest: digest(`${JSON.stringify(result)}\n`) },
    ]).concat([
      ...hostChecks.logs.map((log) => ({ path: `.omo/verification/ci-parity/runner/results/${log.path}`, digest: log.digest })),
      { path: '.omo/verification/ci-parity/runner/results/host-checks.json', digest: digest(`${JSON.stringify(hostChecks)}\n`) },
    ]),
    artifacts: [{ path: '.omo/verification/ci-parity/runner/archive.tar', digest: digest('archive') }],
    startedAt: '2026-09-14T00:00:00.000Z', completedAt: '2026-09-14T00:00:01.000Z',
  };
}

test('the full primary profile maps every triggered companion onto existing tasks', () => {
  const plan = buildVerificationPlan({ changedFiles: [
    'packages/core/package.json', 'packages/core/src/index.mjs',
    'packages/core/test/global-setup.ts', 'docs/reference/node-support.md',
    'packages/platform-deno/src/index.ts',
  ], identity });
  assert.deepEqual(plan.companionChecks, [
    'declaration-importers', 'documentation-governance', 'global-setup-contract',
    'manifest-lockfile', 'package-dependency-closure', 'source-copy-inventory',
  ]);
  for (const id of plan.companionChecks) assert.ok(plan.capabilityTasks[id]?.length, id);
  assert.equal(plan.tasks.some((task) => task.commands.some((command) => command.argv.join(' ') === 'test:verify')), false);
  assert.ok(plan.tasks.find((task) => task.id === 'native-web')?.commands.some((command) => command.executable === 'deno'));
});

test('unknown changes remain full and companion trigger changes cannot silently remove coverage', () => {
  assert.equal(buildVerificationPlan({ changedFiles: ['unknown.txt'], identity }).mode, 'full');
  const malformed = structuredClone(readVerificationManifest());
  malformed.companions[0].when = 'unknown';
  assert.throws(() => buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest: malformed }), /unknown/u);
  const duplicate = structuredClone(readVerificationManifest());
  duplicate.companions[1].id = duplicate.companions[0].id;
  assert.throws(() => buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest: duplicate }), /duplicate/u);
});

test('v1 native receipt and wrong platform, profile, image or source fail admission', () => {
  const plan = buildVerificationPlan({ changedFiles: [], identity });
  const receipt = receiptFor(plan);
  assert.deepEqual(validateReceipt(receipt), { valid: true });
  assert.equal(receiptMatchesPlan(receipt, identity, plan), true);
  assert.equal(receiptIsCurrent(receipt, { ...identity, treeSha: '9'.repeat(40) }), false);
  assert.equal(validateReceipt({ ...receipt, version: 1 }).valid, false);
  assert.equal(validateReceipt({ ...receipt, hostChecks: null }).valid, false);
  assert.equal(validateReceipt({ ...receipt, imageIdentity: { ...receipt.imageIdentity, id: null } }).valid, false);
  const missingHostCommand = structuredClone(receipt);
  missingHostCommand.hostChecks.commands = [];
  assert.equal(receiptMatchesPlan(missingHostCommand, identity, plan), false);
  assert.equal(receiptMatchesPlan({ ...receipt, profile: 'extended' }, identity, plan), false);
  assert.equal(validateReceipt({ ...receipt, imageIdentity: { ...receipt.imageIdentity, key: `sha256:${'9'.repeat(64)}` } }).valid, false);
  assert.equal(validateReceipt({ ...receipt, identity: { ...identity, clean: false } }).valid, false);
  const wrongPlatform = structuredClone(receipt);
  wrongPlatform.taskResults[0].environment.arch = 'x64';
  assert.equal(validateReceipt(wrongPlatform).valid, false);
  const wrongRuntime = structuredClone(receipt);
  wrongRuntime.taskResults[0].environment.node.floor = '24.21.0';
  assert.equal(validateReceipt(wrongRuntime).valid, false);
  const incomplete = structuredClone(receipt);
  incomplete.taskResults.pop();
  assert.equal(receiptMatchesPlan(incomplete, identity, plan), false);
  const failed = structuredClone(receipt);
  failed.taskResults[0].commands[0].exitCode = 1;
  assert.equal(validateReceipt(failed).valid, false);
});

test('v2 receipt authenticates log, archive and receipt bytes inside the real evidence root', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-receipt-v2-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receiptIdentity = { ...identity, root };
  const receipt = receiptFor(buildVerificationPlan({ changedFiles: [], identity: receiptIdentity }));
  for (const file of receipt.logs) {
    const result = receipt.taskResults.find((item) => file.path.endsWith(`/results/${item.taskId}.json`))
      ?? (file.path.endsWith('/results/host-checks.json') ? receipt.hostChecks : undefined);
    mkdirSync(join(root, file.path, '..'), { recursive: true });
    writeFileSync(join(root, file.path), result ? `${JSON.stringify(result)}\n` : 'log');
  }
  for (const [file, content] of [[receipt.artifacts[0], 'archive']]) {
    mkdirSync(join(root, file.path, '..'), { recursive: true });
    writeFileSync(join(root, file.path), content);
  }
  const receiptPath = join(root, '.omo/verification/receipt.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const reference = { worktree: root, receiptPath: relative(root, receiptPath), receiptSha256: digest(readFileSync(receiptPath)) };
  assert.equal(validateReceiptEvidence(receipt, reference).valid, true);
  writeFileSync(join(root, receipt.artifacts[0].path), 'changed');
  assert.equal(validateReceiptEvidence(receipt, reference).valid, false);
  writeFileSync(join(root, receipt.artifacts[0].path), 'archive');
  writeFileSync(receiptPath, 'tampered');
  assert.equal(validateReceiptEvidence(receipt, reference).valid, false);
});

test('symlink escape cannot redirect receipt evidence outside the worktree', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-v2-symlink-'));
  const outside = mkdtempSync(join(tmpdir(), 'fluo-v2-outside-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  const receipt = receiptFor(buildVerificationPlan({ changedFiles: [], identity: { ...identity, root } }));
  mkdirSync(join(root, '.omo'));
  symlinkSync(outside, join(root, '.omo/verification'));
  const receiptPath = join(root, '.omo/verification/receipt.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal(validateReceiptEvidence(receipt, {
    worktree: root, receiptPath: relative(root, receiptPath), receiptSha256: digest(readFileSync(receiptPath)),
  }).valid, false);
});

test('v2 schema keeps typed clean source and task artifact evidence', () => {
  const schema = JSON.parse(readFileSync(new URL('./local-verification-receipt.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.version.const, 2);
  assert.equal(schema.$defs.identity.properties.clean.const, true);
  for (const field of ['taskResults', 'capabilityTasks', 'environmentLockDigest', 'imageIdentity', 'artifacts', 'logs']) {
    assert.ok(schema.required.includes(field), field);
  }
});
