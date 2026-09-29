import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { digest, buildVerificationPlan, semanticPlanDigest } from './local-verification.mjs';
import { aggregateResults, restoreBuildInputs, validateHostChecks, validatePlan } from './verification-runner.mjs';

const script = new URL('./verification-runner.mjs', import.meta.url).pathname;
const run = (name, args, cwd) => {
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, COPYFILE_DISABLE: '1' } });
  assert.equal(result.status, 0, `${name} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
const fixtureIdentity = {
  baseRef: 'a'.repeat(40), baseSha: 'a'.repeat(40), changedFilesDigest: digest(''), clean: true,
  diffDigest: 'c'.repeat(64), headSha: 'a'.repeat(40), mergeBase: 'a'.repeat(40),
  root: '/fixture', treeSha: 'd'.repeat(40), worktreeStatusDigest: 'e'.repeat(64),
};

test('rejects missing task, cycles and unprovided capabilities in the frozen DAG', () => {
  // Given: A real catalog is resolved into the same plan consumed by CLI and workflow.
  const changedFiles = ['tooling/ci/verification-runner.mjs'];
  const plan = buildVerificationPlan({ changedFiles,
    identity: { ...fixtureIdentity, changedFilesDigest: digest(changedFiles.join('\n')) } });
  // When / Then: No silent reduction of required work is accepted.
  assert.equal(validatePlan(plan), plan);
  assert.throws(() => validatePlan({ ...plan, tasks: plan.tasks.slice(1) }), /stale|malformed/u);
  const cycle = structuredClone(plan);
  cycle.tasks[0].dependencies.push('static');
  cycle.semanticDigest = semanticPlanDigest(cycle);
  assert.throws(() => validatePlan(cycle), /canonical/u);
  const removed = structuredClone(plan);
  delete removed.capabilityTasks['native-cookies'];
  removed.semanticDigest = semanticPlanDigest(removed);
  assert.throws(() => validatePlan(removed), /canonical/u);
  const edited = structuredClone(plan);
  edited.tasks[0].commands.pop();
  edited.semanticDigest = semanticPlanDigest(edited);
  assert.throws(() => validatePlan(edited), /canonical/u);
});

test('build archive restoration keeps executable, symlink and generated CLI metadata and rejects alteration', (t) => {
  // Given: A tar produced from built package outputs with the real tar command.
  const root = mkdtempSync(join(tmpdir(), 'fluo-build-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const build = join(root, 'build');
  const target = join(root, 'consumer');
  const artifacts = join(root, 'artifacts');
  mkdirSync(join(build, 'packages/cli/dist'), { recursive: true });
  mkdirSync(join(build, 'packages/cli/src/new'), { recursive: true });
  mkdirSync(target);
  mkdirSync(artifacts);
  writeFileSync(join(build, 'packages/cli/dist/cli.js'), '#!/usr/bin/env node\n');
  chmodSync(join(build, 'packages/cli/dist/cli.js'), 0o755);
  symlinkSync('cli.js', join(build, 'packages/cli/dist/fluo'));
  writeFileSync(join(build, 'packages/cli/src/new/published-internal-dependencies.ts'), 'export const generated = true;\n');
  run('tar', ['-cf', join(artifacts, 'build.tar'), 'packages/cli/dist',
    'packages/cli/src/new/published-internal-dependencies.ts'], build);
  const plan = buildVerificationPlan({ changedFiles: [], identity: fixtureIdentity });
  const task = { inputs: ['build.tar'] };
  writeFileSync(join(artifacts, 'build.json'), JSON.stringify({
    headSha: plan.source.headSha, treeSha: plan.source.treeSha, imageKey: plan.environment.imageKey,
    files: { 'build.tar': digest(readFileSync(join(artifacts, 'build.tar'))) },
  }));

  // When: A consumer restores the provenance-checked archive.
  restoreBuildInputs(plan, task, artifacts, target);
  // Then: The real filesystem semantics and generated metadata survive.
  assert.ok(lstatSync(join(target, 'packages/cli/dist/cli.js')).mode & 0o111);
  assert.equal(readlinkSync(join(target, 'packages/cli/dist/fluo')), 'cli.js');
  assert.match(readFileSync(join(target, 'packages/cli/src/new/published-internal-dependencies.ts'), 'utf8'), /generated = true/u);
  writeFileSync(join(artifacts, 'build.json'), JSON.stringify({
    headSha: plan.source.headSha, treeSha: plan.source.treeSha, imageKey: plan.environment.imageKey,
    files: { 'build.tar': '0'.repeat(64) },
  }));
  assert.throws(() => restoreBuildInputs(plan, task, artifacts, target), /tampered/u);
});

test('aggregate CLI rejects missing, failed, cancelled and skipped required workflow results', (t) => {
  // Given: A plan with one required task but no signed result.
  const root = mkdtempSync(join(tmpdir(), 'fluo-aggregate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plan = buildVerificationPlan({ changedFiles: [], identity: fixtureIdentity });
  const path = join(root, 'plan.json');
  writeFileSync(path, JSON.stringify(plan));
  mkdirSync(join(root, 'results'));
  mkdirSync(join(root, 'artifacts'));
  for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
    // When / Then: Workflow status alone never certifies missing task evidence.
    const process = spawnSync(processExec(), [script, '--plan', path, '--aggregate',
      '--output', join(root, 'results'), '--artifacts', join(root, 'artifacts')], {
      env: { ...globalThis.process.env, VERIFICATION_RESULTS: JSON.stringify({
        plan: { result: 'success' }, build: { result }, verification: { result: 'success' },
        compatibility: { result: 'success' },
      }) },
      encoding: 'utf8',
    });
    assert.notEqual(process.status, 0, result);
    assert.match(process.stderr, /missing task|job failed|skipped|cancelled/u);
  }
  assert.throws(() => aggregateResults(plan, join(root, 'results'), join(root, 'artifacts')), /missing task/u);
  assert.throws(() => aggregateResults(plan, join(root, 'results'), join(root, 'artifacts'), {
    plan: { result: 'success' }, build: { result: 'success' },
  }), /job failed/u);
});

const processExec = () => globalThis.process.execPath;

test('host integration evidence rejects missing commands and tampered logs', (t) => {
  // Given
  const output = mkdtempSync(join(tmpdir(), 'fluo-host-evidence-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const plan = buildVerificationPlan({ changedFiles: [], identity: fixtureIdentity });
  writeFileSync(join(output, 'host-check-0.log'), 'real fixture output');
  const result = {
    status: 'passed', planDigest: plan.semanticDigest, headSha: plan.source.headSha, treeSha: plan.source.treeSha,
    commands: plan.hostChecks.map((command) => ({ command, exitCode: 0, signal: null, spawnError: null })),
    logs: [{ path: 'host-check-0.log', digest: digest('real fixture output') }],
  };

  // When / Then
  assert.equal(validateHostChecks(plan, result, output), result);
  assert.throws(() => validateHostChecks(plan, { ...result, commands: [] }, output), /missing|failed/u);
  writeFileSync(join(output, 'host-check-0.log'), 'tampered');
  assert.throws(() => validateHostChecks(plan, result, output), /log changed/u);
});
