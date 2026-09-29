#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVerificationPlan, digest, readVerificationManifest, semanticPlanDigest } from './local-verification.mjs';
import { recordPreparedBuild } from './prepared-build.mjs';
import { imageKeyFor, loadEnvironmentLock, prepareVerificationEnvironment, validateVerificationEnvironment } from './verification-environment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = /^[a-f0-9]{40}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const nested = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const execute = (executable, argv, options = {}) => {
  const result = spawnSync(executable, argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${argv.join(' ')}: ${result.error?.message ?? result.stderr ?? result.stdout ?? result.status}`);
  }
  return result.stdout.trim();
};
const requiredArgs = (argv) => {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--plan', '--task', '--output', '--artifacts'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new TypeError(`invalid runner option ${argv[i]}`);
    }
    options[argv[i].slice(2)] = argv[i + 1];
  }
  for (const name of ['plan', 'output', 'artifacts']) {
    if (!options[name]) throw new TypeError(`runner requires --${name}`);
  }
  return options;
};

export function validatePlan(plan, catalogRoot = process.cwd()) {
  if (plan?.version !== 2 || !['pr', 'extended'].includes(plan.profile)
    || !sha.test(plan.source?.headSha) || !sha.test(plan.source?.treeSha)
    || !sha.test(plan.source?.baseSha) || plan.source.headSha !== plan.identity?.headSha
    || plan.source.treeSha !== plan.identity?.treeSha || plan.source.baseSha !== plan.identity?.baseSha
    || !plan.identity.clean || !sha256.test(plan.manifestDigest) || !sha256.test(plan.environment?.lockDigest)
    || !sha256.test(plan.semanticDigest) || semanticPlanDigest(plan) !== plan.semanticDigest
    || digest(JSON.stringify(plan.environment.lock)) !== plan.environment.lockDigest
    || imageKeyFor(plan.environment.lock, readFileSync(join(here, 'Dockerfile'))) !== plan.environment.imageKey
    || !Array.isArray(plan.tasks) || plan.tasks.length !== 16
    || !Array.isArray(plan.changedFiles)
    || digest(plan.changedFiles.join('\n')) !== plan.identity.changedFilesDigest) {
    throw new TypeError('stale or malformed frozen verification plan');
  }
  const manifest = readVerificationManifest(join(catalogRoot, 'tooling/ci/local-verification-manifest.json'));
  const lock = loadEnvironmentLock(join(catalogRoot, 'tooling/ci/environment.lock.json'));
  const canonical = buildVerificationPlan({ changedFiles: plan.changedFiles, identity: plan.identity,
    manifest, lock, profile: plan.profile });
  if (JSON.stringify(canonical) !== JSON.stringify(plan)) {
    throw new TypeError('frozen plan differs from canonical catalog, profile or environment');
  }
  const ids = new Set();
  for (const task of plan.tasks) {
    if (!task?.id || ids.has(task.id) || !Array.isArray(task.dependencies) || !Array.isArray(task.commands)
      || task.commands.length === 0 || !Array.isArray(task.capabilities)
      || !['primary', 'compat24', 'compat26', 'runtimeFloor'].includes(task.runtime)) {
      throw new TypeError(`malformed or duplicate task ${task?.id}`);
    }
    ids.add(task.id);
  }
  for (const task of plan.tasks) {
    if (task.dependencies.some((id) => !ids.has(id) || id === task.id)) throw new TypeError('unknown or cyclic task dependency');
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new TypeError('cyclic task dependency');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of plan.tasks.find((task) => task.id === id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of plan.tasks) visit(task.id);
  for (const [capability, providers] of Object.entries(plan.capabilityTasks ?? {})) {
    if (!Array.isArray(providers) || providers.length === 0
      || providers.some((id) => !plan.tasks.some((task) => task.id === id && task.capabilities.includes(capability)))) {
      throw new TypeError(`missing capability ${capability}`);
    }
  }
  return plan;
}

const hashFile = (path) => digest(readFileSync(path));
const walkFiles = (root) => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const file = join(root, entry.name);
  return entry.isDirectory() ? walkFiles(file) : entry.isFile() ? [file] : [];
});
const artifact = (path, root) => ({ path: relative(root, path), digest: hashFile(path), size: statSync(path).size });

export function validateTaskResult(plan, task, result, output, artifacts) {
  if (result?.version !== 2 || result.status !== 'passed' || result.taskId !== task.id
    || result.headSha !== plan.source.headSha || result.treeSha !== plan.source.treeSha
    || result.planDigest !== plan.semanticDigest || result.imageKey !== plan.environment.imageKey
    || !/^sha256:[a-f0-9]{64}$/u.test(result.imageId ?? '')
    || !Array.isArray(result.commands) || result.commands.length !== task.commands.length
    || !Array.isArray(result.logs) || result.logs.length !== task.commands.length
    || !Array.isArray(result.artifacts) || !result.environment) throw new TypeError(`invalid task result ${task.id}`);
  validateVerificationEnvironment({ lock: plan.environment.lock, actual: result.environment, imageKey: result.imageKey });
  const logRoot = realpathSync(output);
  const artifactRoot = realpathSync(artifacts);
  for (const [index, command] of task.commands.entries()) {
    const actual = result.commands[index];
    const log = result.logs[index];
    if (JSON.stringify(actual.command) !== JSON.stringify(command) || actual.exitCode !== 0
      || actual.signal !== null || actual.spawnError !== null
      || [actual.identityBefore, actual.identityAfter].some((identity) =>
        identity?.headSha !== plan.source.headSha || identity?.treeSha !== plan.source.treeSha
        || identity?.statusDigest !== digest(''))
      || !sha256.test(log?.digest)
      || log.commandIndex !== index || typeof log.path !== 'string') throw new TypeError(`task command failed ${task.id}`);
    const path = resolve(output, log.path);
    if (!nested(logRoot, realpathSync(path)) || hashFile(path) !== log.digest) throw new TypeError(`task log changed ${task.id}`);
  }
  for (const file of result.artifacts) {
    const path = resolve(artifacts, file.path);
    if (!nested(artifactRoot, realpathSync(path)) || !sha256.test(file.digest)
      || hashFile(path) !== file.digest || statSync(path).size !== file.size) throw new TypeError(`artifact changed ${task.id}`);
  }
  for (const name of task.outputs) {
    if (!result.artifacts.some((item) => item.path === name || item.path.startsWith(`${name}/`))) {
      throw new TypeError(`missing output ${name} of ${task.id}`);
    }
  }
  return result;
}

export function aggregateResults(plan, output, artifacts, jobResults = null, catalogRoot = process.cwd()) {
  validatePlan(plan, catalogRoot);
  if (jobResults !== null && (typeof jobResults !== 'object'
    || JSON.stringify(Object.keys(jobResults).sort()) !== JSON.stringify(['build', 'compatibility', 'plan', 'verification'])
    || Object.values(jobResults).some((job) => job?.result !== 'success'))) {
    throw new TypeError('required workflow job failed, skipped, cancelled or missing');
  }
  const results = plan.tasks.map((task) => {
    const file = resolve(output, `${task.id}.json`);
    if (!existsSync(file)) throw new TypeError(`missing task result ${task.id}`);
    return validateTaskResult(plan, task, JSON.parse(readFileSync(file, 'utf8')), output, artifacts);
  });
  for (const [capability, ids] of Object.entries(plan.capabilityTasks)) {
    if (!ids.some((id) => results.some((result) => result.taskId === id && result.status === 'passed'))) {
      throw new TypeError(`missing passed capability ${capability}`);
    }
  }
  validateHostChecks(plan, JSON.parse(readFileSync(resolve(output, 'host-checks.json'), 'utf8')), output);
  return results;
}

export function validateHostChecks(plan, result, output) {
  if (result?.status !== 'passed' || result.planDigest !== plan.semanticDigest
    || result.headSha !== plan.source.headSha || result.treeSha !== plan.source.treeSha
    || !Array.isArray(result.commands) || result.commands.length !== plan.hostChecks.length
    || !Array.isArray(result.logs) || result.logs.length !== plan.hostChecks.length) {
    throw new TypeError('host integration evidence is missing, failed or stale');
  }
  const root = realpathSync(output);
  for (const [index, command] of plan.hostChecks.entries()) {
    const actual = result.commands[index];
    const log = result.logs[index];
    if (JSON.stringify(actual.command) !== JSON.stringify(command) || actual.exitCode !== 0
      || actual.signal !== null || actual.spawnError !== null || !sha256.test(log?.digest)) {
      throw new TypeError('host integration command failed or changed');
    }
    const path = realpathSync(resolve(output, log.path));
    if (!nested(root, path) || hashFile(path) !== log.digest) throw new TypeError('host integration log changed');
  }
  return result;
}

export function runHostChecks(plan, output, sourceRoot = process.cwd()) {
  validatePlan(plan, sourceRoot);
  const assertSource = () => {
    if (execute('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }) !== plan.source.headSha
      || execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: sourceRoot }) !== plan.source.treeSha
      || execute('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: sourceRoot }) !== '') {
      throw new TypeError('host source changed before or during integration checks');
    }
  };
  assertSource();
  mkdirSync(output, { recursive: true });
  const result = { status: 'passed', planDigest: plan.semanticDigest, headSha: plan.source.headSha,
    treeSha: plan.source.treeSha, commands: [], logs: [], driver: { node: process.version, platform: process.platform, arch: process.arch } };
  for (const [index, command] of plan.hostChecks.entries()) {
    const processResult = spawnSync(process.execPath, command.argv, {
      cwd: sourceRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    const path = join(output, `host-check-${index}.log`);
    writeFileSync(path, `${processResult.stdout ?? ''}${processResult.stderr ?? ''}${processResult.error?.message ?? ''}`);
    result.commands.push({ command, exitCode: processResult.status, signal: processResult.signal,
      spawnError: processResult.error?.message ?? null });
    result.logs.push({ path: basename(path), digest: hashFile(path) });
    if (processResult.status !== 0 || processResult.signal || processResult.error) {
      result.status = 'failed';
      break;
    }
  }
  writeFileSync(join(output, 'host-checks.json'), `${JSON.stringify(result, null, 2)}\n`);
  assertSource();
  return validateHostChecks(plan, result, output);
}

const runtimePath = (lock, task, command) => {
  const version = lock.node[task.runtime === 'runtimeFloor' ? 'floor' : task.runtime === 'compat24' ? 'compat24'
    : task.runtime === 'compat26' ? 'compat26' : 'primary'].version;
  const prefix = `/opt/node/${version}/bin`;
  const extra = command.executable === 'bun' ? `/opt/bun/${command.runtimeVersion}` : command.executable === 'deno'
    ? `/opt/deno/${command.runtimeVersion}` : null;
  return [extra, prefix, '/opt/bun/1.4.0', '/opt/deno/2.9.7', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':');
};

function collectFailureDiagnostics(task, root, output) {
  const locations = [
    join(root, '.omo/verification/vitest-shutdown-debug'),
    join(root, '.omo/verification/browser-traces'),
    join(root, '.artifacts/vitest-shutdown-debug'),
    join(root, 'test-results'),
    join(root, 'playwright-report'),
    join(root, '.artifacts/browser-traces'),
    join(root, 'packages/studio/test-results'),
    join(root, 'packages/studio/node_modules/.cache/playwright-results'),
    join('/tmp', `fluo-${task.id}`, 'node_modules/.cache/playwright-results'),
    join('/tmp', `fluo-${task.id}`),
  ];
  const destination = join(output, `${task.id}-diagnostics`);
  const evidence = [];
  const visit = (path, label) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.next', '.cache'].includes(entry.name)) continue;
      const source = join(path, entry.name);
      const name = join(label, entry.name);
      if (entry.isDirectory()) visit(source, name);
      else if (entry.isFile() && /\.(?:json|log|txt|md|zip|webm|png|html)$/u.test(entry.name)) {
        const target = join(destination, name);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(source, target);
        evidence.push(artifact(target, output));
      }
    }
  };
  for (const [index, path] of locations.entries()) visit(path, `source-${index}`);
  return evidence;
}

function inspectEnvironment() {
  // Re-run the actual browser launch, Linux-volume watch and Redis fixture
  // inside each isolated task, rather than trusting a prior feasibility JSON.
  const result = JSON.parse(execute('node',
    ['tooling/ci/probe-verification-environment.mjs', '--inside'], { cwd: '/workspace' }));
  return result.actual;
}

export function restoreBuildInputs(plan, task, artifacts, root) {
  if (!task.inputs.length) return;
  const metadata = JSON.parse(readFileSync(join(artifacts, 'build.json'), 'utf8'));
  if (metadata.headSha !== plan.source.headSha || metadata.treeSha !== plan.source.treeSha
    || metadata.imageKey !== plan.environment.imageKey) throw new TypeError('build artifact source mismatch');
  for (const name of task.inputs) {
    const file = join(artifacts, name);
    if (!sha256.test(metadata.files[name]) || hashFile(file) !== metadata.files[name]) {
      throw new TypeError(`missing or tampered build input ${name}`);
    }
  }
  if (task.inputs.includes('build.tar')) execute('tar', ['-xf', join(artifacts, 'build.tar'), '-C', root]);
  if (task.inputs.includes('runtime-floor.tar')) {
    mkdirSync(join(root, '.omo/verification/runtime-floor'), { recursive: true });
    execute('tar', ['-xf', join(artifacts, 'runtime-floor.tar'), '-C', join(root, '.omo/verification/runtime-floor')]);
  }
}

function sandboxIdentity(root, source) {
  const headSha = execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const treeSha = execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root });
  const status = execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root });
  if (headSha !== source.headSha || treeSha !== source.treeSha || status !== '') {
    throw new TypeError(`Linux sandbox source changed outside declared ignored output directories: ${JSON.stringify(status)}`);
  }
  return { headSha, treeSha, statusDigest: digest(status) };
}

function insideTask(plan, task, output, artifacts) {
  const root = '/workspace';
  if (execute('git', ['rev-parse', 'HEAD'], { cwd: root }) !== plan.source.headSha
    || execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }) !== plan.source.treeSha
    || execute('git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: root }) !== plan.source.baseSha
    || execute('git', ['status', '--porcelain'], { cwd: root }) !== '') throw new TypeError('Linux source tree mismatch');
  mkdirSync(output, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  const startedAt = new Date().toISOString();
  const environment = inspectEnvironment();
  validateVerificationEnvironment({ lock: plan.environment.lock, actual: environment, imageKey: plan.environment.imageKey });
  restoreBuildInputs(plan, task, artifacts, root);
  let preparedBuild;
  const commands = [];
  const logs = [];
  let failure = null;
  for (const [index, command] of task.commands.entries()) {
    const path = join(output, `${task.id}-${index}.log`);
    const started = new Date().toISOString();
    let identityBefore;
    try { identityBefore = sandboxIdentity(root, plan.source); }
    catch (error) { failure = `command ${index} source changed before execution: ${error.message}`; break; }
    const executable = command.executable === 'pnpm'
      ? `/opt/node/${plan.environment.lock.node[task.runtime === 'runtimeFloor' ? 'floor' : task.runtime === 'compat24' ? 'compat24' : task.runtime === 'compat26' ? 'compat26' : 'primary'].version}/bin/node`
      : command.executable === 'bun' || command.executable === 'deno'
        ? `/opt/${command.executable}/${command.runtimeVersion}/${command.executable}`
        : `/opt/node/${plan.environment.lock.node[task.runtime === 'runtimeFloor' ? 'floor' : task.runtime === 'compat24' ? 'compat24' : task.runtime === 'compat26' ? 'compat26' : 'primary'].version}/bin/node`;
    const argv = command.executable === 'pnpm' ? ['/opt/pnpm/bin/pnpm.cjs', ...command.argv] : command.argv;
    const result = spawnSync(executable, argv, { cwd: resolve(root, command.cwd), encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      env: { PATH: runtimePath(plan.environment.lock, task, command), CI: '1', TZ: 'UTC', LANG: 'C.UTF-8',
        HOME: '/tmp', XDG_DATA_HOME: '/pnpm-cache', DOCKER_HOST: 'unix:///var/run/docker.sock', CHROME_BIN: '/opt/google/chrome/chrome',
        npm_config_store_dir: '/pnpm-cache/pnpm/store',
        PLAYWRIGHT_BROWSERS_PATH: '/opt/google/chrome', FLUO_CLI_SANDBOX_ROOT: `/tmp/fluo-${task.id}`,
        FLUO_VITEST_SHUTDOWN_DEBUG: '1',
        FLUO_VITEST_SHUTDOWN_DEBUG_DIR: `.omo/verification/vitest-shutdown-debug/${task.id}`,
        ...(preparedBuild ? { FLUO_VERIFIED_BUILD: preparedBuild } : {}),
        ...command.env } });
    writeFileSync(path, `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`);
    let identityAfter = null;
    try { identityAfter = sandboxIdentity(root, plan.source); }
    catch (error) { failure = `command ${index} source changed after execution: ${error.message}`; }
    commands.push({ command, exitCode: result.status, signal: result.signal,
      spawnError: result.error?.message ?? null, identityBefore, identityAfter,
      startedAt: started, finishedAt: new Date().toISOString() });
    logs.push({ commandIndex: index, path: basename(path), digest: hashFile(path) });
    if (result.status !== 0 || result.signal || result.error) failure ??= `command ${index} failed`;
    if (failure) break;
    if (command.executable === 'pnpm' && command.cwd === '.'
      && (command.argv.join(' ') === 'build'
        || (task.inputs.includes('build.tar') && command.argv.join(' ') === 'install --frozen-lockfile'))) {
      preparedBuild = recordPreparedBuild(root, plan.environment.imageKey);
    }
  }
  const artifactsWritten = [];
  if (!failure && task.id === 'build') {
    const dist = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'dist')))
      .map((entry) => `packages/${entry.name}/dist`);
    execute('tar', ['-cf', join(artifacts, 'build.tar'), ...dist,
      'packages/cli/src/new/published-internal-dependencies.ts'], { cwd: root });
    execute('tar', ['-cf', join(artifacts, 'runtime-floor.tar'), '-C', join(root, '.omo/verification/runtime-floor'), '.']);
    const metadata = { headSha: plan.source.headSha, treeSha: plan.source.treeSha, imageKey: plan.environment.imageKey,
      files: Object.fromEntries(['build.tar', 'runtime-floor.tar'].map((name) => [name, hashFile(join(artifacts, name))])) };
    writeFileSync(join(artifacts, 'build.json'), `${JSON.stringify(metadata)}\n`);
  }
  if (!failure && task.id === 'static') {
    cpSync(join(root, '.artifacts/docs-site'), join(artifacts, 'docs-site'), { recursive: true });
  }
  if (!failure) {
    for (const name of task.outputs) {
      const path = join(artifacts, name);
      if (!existsSync(path)) { failure = `missing declared output ${name}`; break; }
      artifactsWritten.push(...(statSync(path).isDirectory() ? walkFiles(path) : [path]).map((file) => artifact(file, artifacts)));
    }
  }
  const diagnostics = failure ? collectFailureDiagnostics(task, root, output) : [];
  const result = { version: 2, taskId: task.id, status: failure ? 'failed' : 'passed', reason: failure,
    headSha: plan.source.headSha, treeSha: plan.source.treeSha,
    planDigest: plan.semanticDigest, imageKey: plan.environment.imageKey,
    environment, commands, logs, artifacts: artifactsWritten, diagnostics, startedAt, completedAt: new Date().toISOString() };
  writeFileSync(join(output, `${task.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  if (failure) throw new Error(`${task.id}: ${failure}`);
  return result;
}

export function runTask(plan, taskId, output, artifacts, planPath, sourceRoot = process.cwd()) {
  validatePlan(plan, sourceRoot);
  const task = plan.tasks.find(({ id }) => id === taskId);
  if (!task) throw new TypeError(`unknown task ID: ${taskId}`);
  if (execute('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }) !== plan.source.headSha
    || execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: sourceRoot }) !== plan.source.treeSha
    || execute('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: sourceRoot }) !== '') {
    throw new TypeError('host worktree does not match frozen clean source');
  }
  mkdirSync(output, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  const dependencyCache = resolve(sourceRoot, '.omo/verification/cache/pnpm');
  mkdirSync(dependencyCache, { recursive: true });
  if (task.inputs.length && existsSync(join(output, 'build.json'))) {
    validateTaskResult(plan, plan.tasks.find(({ id }) => id === 'build'),
      JSON.parse(readFileSync(join(output, 'build.json'), 'utf8')), output, artifacts);
  }
  const prepared = prepareVerificationEnvironment();
  if (prepared.imageKey !== plan.environment.imageKey) throw new TypeError('built image differs from frozen plan');
  const staging = mkdtempSync(join(tmpdir(), 'fluo-verification-source-'));
  const volume = `fluo-verify-${process.pid}-${createHash('sha256').update(staging).digest('hex').slice(0, 12)}`;
  const watchVolume = `${volume}-watch`;
  try {
    const bundle = join(staging, 'source.bundle');
    execute('git', ['bundle', 'create', bundle, 'HEAD', plan.source.baseSha], { cwd: sourceRoot });
    execute('docker', ['volume', 'create', volume]);
    execute('docker', ['volume', 'create', watchVolume]);
    execute('docker', ['run', '--rm', '--platform', 'linux/arm64', '--network', 'host',
      '-v', `${volume}:/workspace`, '-v', `${bundle}:/tmp/source.bundle:ro`, prepared.tag, 'sh', '-c',
      `git init -q /workspace && git -C /workspace fetch -q /tmp/source.bundle HEAD ` +
      `&& git -C /workspace cat-file -e ${plan.source.baseSha}^{commit} ` +
      `&& git -C /workspace update-ref refs/remotes/origin/main ${plan.source.baseSha} ` +
      `&& git -C /workspace config user.name Verification ` +
      `&& git -C /workspace config user.email verification@localhost ` +
      `&& git -C /workspace checkout -q --detach ${plan.source.headSha}`]);
    const dockerHost = execute('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (!dockerHost.startsWith('unix://')) throw new TypeError('Docker Unix socket required');
    const args = ['run', '--rm', '--init', '--platform', 'linux/arm64', '--network', 'host',
      '-v', `${volume}:/workspace`, '-v', `${resolve(planPath)}:/tmp/plan.json:ro`,
      '-v', `${resolve(output)}:/evidence`, '-v', `${resolve(artifacts)}:/artifacts`,
      '-v', `${dependencyCache}:/pnpm-cache`,
      '-v', `${watchVolume}:/workspace-watch`,
      '-v', `${dockerHost.slice(7)}:/var/run/docker.sock`, prepared.tag,
      'node', 'tooling/ci/verification-runner.mjs', '--inside', '--plan', '/tmp/plan.json',
      '--task', task.id, '--output', '/evidence', '--artifacts', '/artifacts'];
    const run = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    const resultPath = join(output, `${task.id}.json`);
    const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
    if (result) {
      result.imageId = prepared.imageId;
      writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    if (run.error || run.status !== 0) {
      const lastLog = result?.logs?.at(-1);
      const detail = lastLog ? readFileSync(join(output, lastLog.path), 'utf8').slice(-2_000) : '';
      throw new Error(`Linux task ${task.id} failed: ${run.stderr ?? run.error?.message}\n${detail}`);
    }
    validateTaskResult(plan, task, result, output, artifacts);
    if (execute('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: sourceRoot }) !== ''
      || execute('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }) !== plan.source.headSha) {
      throw new TypeError('host worktree changed during Linux verification');
    }
    return result;
  } finally {
    execute('docker', ['volume', 'rm', '--force', volume, watchVolume]);
    rmSync(staging, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const inside = argv.includes('--inside');
  const aggregate = argv.includes('--aggregate');
  const hostChecks = argv.includes('--host-checks');
  const options = requiredArgs(argv.filter((option) => !['--inside', '--aggregate', '--host-checks'].includes(option)));
  const plan = validatePlan(JSON.parse(readFileSync(options.plan, 'utf8')), inside ? '/workspace' : process.cwd());
  if (hostChecks) {
    if (inside || aggregate || options.task) throw new TypeError('host checks cannot select an inside task or aggregate');
    const result = runHostChecks(plan, resolve(options.output));
    process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
    return;
  }
  if (aggregate) {
    if (options.task) throw new TypeError('aggregate cannot select one task');
    if (process.env.GITHUB_ACTIONS === 'true' && !process.env.VERIFICATION_RESULTS) {
      throw new TypeError('required workflow job results are missing');
    }
    const jobs = process.env.VERIFICATION_RESULTS ? JSON.parse(process.env.VERIFICATION_RESULTS) : null;
    const results = aggregateResults(plan, resolve(options.output), resolve(options.artifacts), jobs);
    process.stdout.write(`${JSON.stringify({ status: 'passed', tasks: results.map(({ taskId }) => taskId) })}\n`);
    return;
  }
  if (!options.task) throw new TypeError('runner requires --task or --aggregate');
  const task = plan.tasks.find(({ id }) => id === options.task);
  if (!task) throw new TypeError(`unknown task ID: ${options.task}`);
  const result = inside ? insideTask(plan, task, resolve(options.output), resolve(options.artifacts))
    : runTask(plan, task.id, resolve(options.output), resolve(options.artifacts), options.plan);
  process.stdout.write(`${JSON.stringify({ status: result.status, taskId: task.id })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
