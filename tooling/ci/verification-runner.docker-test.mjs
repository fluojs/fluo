import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { digest, buildVerificationPlan, readVerificationManifest } from './local-verification.mjs';
import { aggregateResults, runTask, validateTaskResult } from './verification-runner.mjs';

const script = new URL('./verification-runner.mjs', import.meta.url).pathname;
const run = (name, args, cwd) => {
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', timeout: 180_000, env: { ...process.env, COPYFILE_DISABLE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const fixtureIdentity = {
  baseRef: 'a'.repeat(40), baseSha: 'a'.repeat(40), changedFilesDigest: digest(''), clean: true,
  diffDigest: 'c'.repeat(64), headSha: 'a'.repeat(40), mergeBase: 'a'.repeat(40),
  root: '/fixture', treeSha: 'd'.repeat(40), worktreeStatusDigest: 'e'.repeat(64),
};

test('real Docker Linux checkout runs a command and exports failure evidence without a passed result', { timeout: 240_000 }, (t) => {
  // Given: A clean tiny Git source, not a host bind mount, and the locked image.
  assert.equal(spawnSync('docker', ['info'], { stdio: 'ignore' }).status, 0, 'host Docker fixture requires an available daemon');
  const root = mkdtempSync(join(tmpdir(), 'fluo-linux-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [
    'tooling/ci/verification-runner.mjs', 'tooling/ci/local-verification.mjs',
    'tooling/ci/local-verification-manifest.json', 'tooling/ci/local-verification-receipt.schema.json',
    'tooling/ci/verification-environment.mjs', 'tooling/ci/probe-verification-environment.mjs',
    'tooling/ci/environment.lock.json', 'tooling/ci/Dockerfile',
    '.agents/workflow-contracts/schema-validator.mjs',
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(new URL(`../../${file}`, import.meta.url), join(root, file));
  }
  const manifestPath = join(root, 'tooling/ci/local-verification-manifest.json');
  const manifest = readVerificationManifest(manifestPath);
  const buildTask = manifest.tasks.find(({ id }) => id === 'build');
  buildTask.commands = [
    { executable: 'pnpm', argv: ['install', '--frozen-lockfile'], cwd: '.' },
    { executable: 'node', argv: ['-e',
      'const fs=require("node:fs");const store=require("node:child_process").execFileSync("pnpm",["store","path"],{encoding:"utf8"}).trim();if(!store.startsWith("/pnpm-cache/"))throw Error("PNPM_STORE_OUTSIDE_CACHE:"+store);const cache=process.env.XDG_DATA_HOME??"/tmp/pnpm-cache";fs.mkdirSync(cache,{recursive:true});fs.writeFileSync(cache+"/cross-task-proof","cached input");fs.mkdirSync("packages/cli/dist",{recursive:true});fs.writeFileSync("packages/cli/dist/cli.js","export const built = true;\\n");fs.mkdirSync(".omo/verification/runtime-floor",{recursive:true});fs.writeFileSync(".omo/verification/runtime-floor/runtime-floor-exercise.mjs","export const runtime = true;\\n")'], cwd: '.' },
  ];
  const staticTask = manifest.tasks.find(({ id }) => id === 'static');
  staticTask.commands = [
    { executable: 'pnpm', argv: ['install', '--frozen-lockfile'], cwd: '.' },
    { executable: 'node', argv: ['-e',
      'const fs=require("node:fs");if(!fs.existsSync("node_modules/fixture-lib")||!fs.existsSync("packages/cli/dist/cli.js")){console.error("INSTALL_OR_BUILD_MISSING");process.exit(6)}if(!fs.existsSync((process.env.XDG_DATA_HOME??"/tmp/pnpm-cache")+"/cross-task-proof"))throw Error("CACHE_NOT_SHARED");fs.mkdirSync(".artifacts/docs-site",{recursive:true});fs.writeFileSync(".artifacts/docs-site/index.html","linux artifact");console.log("LINUX_TASK_OK",process.platform,process.arch)'], cwd: '.' },
  ];
  const failingTask = manifest.tasks.find(({ id }) => id === 'packages-1');
  failingTask.commands = [
    { executable: 'pnpm', argv: ['install', '--frozen-lockfile'], cwd: '.' },
    { executable: 'node', argv: ['-e',
      'const fs=require("node:fs");const debug=process.env.FLUO_VITEST_SHUTDOWN_DEBUG_DIR;fs.mkdirSync(debug,{recursive:true});fs.writeFileSync(debug+"/failure.json","{}");fs.mkdirSync(".omo/verification/browser-traces",{recursive:true});fs.writeFileSync(".omo/verification/browser-traces/trace.zip","trace");const report=process.env.FLUO_CLI_SANDBOX_ROOT+"/node_modules/.cache/playwright-results/case";fs.mkdirSync(report,{recursive:true});fs.writeFileSync(report+"/error-context.md","browser failure");process.exit(7)'], cwd: '.' },
  ];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  copyFileSync(new URL('../../.gitignore', import.meta.url), join(root, '.gitignore'));
  mkdirSync(join(root, 'packages/cli/src/new'), { recursive: true });
  writeFileSync(join(root, 'packages/cli/src/new/published-internal-dependencies.ts'), 'export const generated = true;\n');
  mkdirSync(join(root, 'packages/fixture-lib'), { recursive: true });
  writeFileSync(join(root, 'packages/fixture-lib/package.json'),
    '{"name":"fixture-lib","version":"1.0.0","main":"index.js"}\n');
  writeFileSync(join(root, 'packages/fixture-lib/index.js'), 'module.exports = true;\n');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  writeFileSync(join(root, 'package.json'),
    '{"name":"fluo-runner-fixture","version":"1.0.0","private":true,"packageManager":"pnpm@10.4.1","dependencies":{"fixture-lib":"workspace:*"}}\n');
  run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], root);
  run('git', ['init', '-q'], root);
  run('git', ['add', '.'], root);
  run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], root);
  const headSha = run('git', ['rev-parse', 'HEAD'], root);
  const treeSha = run('git', ['rev-parse', 'HEAD^{tree}'], root);
  const plan = buildVerificationPlan({ changedFiles: [],
    identity: { ...fixtureIdentity, root, baseRef: headSha, baseSha: headSha, mergeBase: headSha,
      headSha, treeSha, worktreeStatusDigest: digest('') },
    manifest });
  const path = join(root, '.git', 'plan.json');
  writeFileSync(path, JSON.stringify(plan));
  const output = join(root, '.git', 'results');
  const artifacts = join(root, '.git', 'artifacts');

  // When: A real producer builds and exports the source-bound archive.
  const built = runTask(plan, 'build', output, artifacts, path, root);
  assert.equal(built.status, 'passed');
  assert.equal(JSON.parse(readFileSync(join(artifacts, 'build.json'), 'utf8')).headSha, headSha);
  // When: The public CLI restores that producer's archive in a separate volume.
  const execution = JSON.parse(run(process.execPath, [script, '--plan', path, '--task', 'static',
    '--output', output, '--artifacts', artifacts], root));
  assert.equal(execution.status, 'passed');
  const passed = JSON.parse(readFileSync(join(output, 'static.json'), 'utf8'));
  // Then: Exported bytes attest Linux/amd64 and exact source, not a fake docker call.
  assert.equal(passed.environment.os, 'linux');
  assert.equal(passed.environment.arch, 'x64');
  assert.equal(passed.headSha, headSha);
  assert.match(readFileSync(join(output, 'static-1.log'), 'utf8'), /LINUX_TASK_OK linux x64/u);
  assert.equal(passed.commands[0].command.argv.join(' '), 'install --frozen-lockfile');
  assert.equal(passed.commands[0].exitCode, 0);
  assert.equal(passed.commands[1].identityBefore.statusDigest, digest(''));
  assert.equal(passed.commands[1].identityAfter.statusDigest, digest(''));
  assert.equal(readFileSync(join(artifacts, 'docs-site/index.html'), 'utf8'), 'linux artifact');
  assert.equal(validateTaskResult(plan, plan.tasks.find(({ id }) => id === 'static'),
    passed, output, artifacts), passed);
  assert.throws(() => aggregateResults(plan, output, artifacts, null, root), /missing task/u);
  writeFileSync(join(artifacts, 'docs-site/index.html'), 'tampered');
  assert.throws(() => validateTaskResult(plan, plan.tasks.find(({ id }) => id === 'static'),
    passed, output, artifacts), /artifact changed/u);
  writeFileSync(join(artifacts, 'docs-site/index.html'), 'linux artifact');

  // When: A separate isolated consumer fails after a real frozen installation.
  const failure = spawnSync(process.execPath, [script, '--plan', path, '--task', 'packages-1',
    '--output', output, '--artifacts', artifacts], { cwd: root, encoding: 'utf8', timeout: 180_000 });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /failed/u);
  const failed = JSON.parse(readFileSync(join(output, 'packages-1.json'), 'utf8'));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.commands[0].exitCode, 0);
  assert.equal(failed.commands[1].exitCode, 7);
  assert.equal(failed.commands[1].identityAfter.statusDigest, digest(''));
  assert.ok(failed.diagnostics.some(({ path }) => path.endsWith('failure.json')));
  assert.ok(failed.diagnostics.some(({ path }) => path.endsWith('trace.zip')));
  assert.ok(failed.diagnostics.some(({ path }) => path.endsWith('error-context.md')));
  assert.throws(() => aggregateResults(plan, output, artifacts, null, root), /artifact changed|missing task|invalid task result/u);
  const evidenceParent = new URL('../../.omo/verification/ci-parity/runner/', import.meta.url);
  mkdirSync(evidenceParent, { recursive: true });
  const evidence = mkdtempSync(join(evidenceParent.pathname, 'fixture-'));
  cpSync(output, join(evidence, 'results'), { recursive: true });
  cpSync(artifacts, join(evidence, 'artifacts'), { recursive: true });
  writeFileSync(join(evidence, 'source.json'), `${JSON.stringify({
    headSha, treeSha, imageKey: plan.environment.imageKey,
    passed: ['build', 'static'], failed: 'packages-1',
  }, null, 2)}\n`);
});
