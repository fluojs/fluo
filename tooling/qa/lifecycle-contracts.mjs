import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { claimEvidenceRoot, createCommandEvidence } from '../ci/command-evidence.mjs';
import { resolveWorkspaceBuildOrder } from '../scripts/run-workspace-build-closure.mjs';

// allow: SIZE_OK - The four required scenarios share one child registry and one mandatory cleanup/receipt boundary.
const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  scenario: { type: 'string', default: 'all' },
  evidence: { type: 'string' },
  'fixture-dir': { type: 'string', default: fileURLToPath(new URL('./fixtures/lifecycle-contracts/', import.meta.url)) },
  contract: { type: 'string' },
  'timeout-ms': { type: 'string', default: '120000' },
} });
const scenarios = ['types', 'lifecycle', 'failures', 'dependency'];
assert.ok(values.scenario === 'all' || scenarios.includes(values.scenario), 'Unknown scenario');
assert.ok(values.evidence && isAbsolute(values.evidence), '--evidence must be absolute');
assert.ok(process.env.RUN_TMP, 'RUN_TMP is required');
assert.ok(!values.contract || /^[a-f0-9]{64}$/u.test(values.contract), 'Invalid contract digest');
const timeout = Number(values['timeout-ms']);
assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2 ** 31 - 1, 'Invalid timeout');
const owner = claimEvidenceRoot(values.evidence);
const work = mkdtempSync(join(realpathSync(process.env.RUN_TMP), 'lifecycle-contracts-'));
const overrides = {
  TMPDIR: join(work, 'tmp'),
  NODE_COMPILE_CACHE: join(work, 'node-cache'),
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(work, 'bun-cache'),
};
for (const path of [...Object.values(overrides), join(work, 'tarballs'), join(work, 'empty-types'), join(owner.root, 'tarballs')]) {
  mkdirSync(path, { recursive: true });
}
const selected = values.scenario === 'all' ? scenarios : [values.scenario];
const report = {
  version: 1, kind: 'packed-lifecycle-contracts', source: {}, status: 'failed',
  scenarios: Object.fromEntries(selected.map((name) => [name, 'FAIL'])),
  tarballs: [], resolution: {}, results: {}, commands: [], errors: [],
  authoring: { generatedArtifact: join(owner.root, 'receipt.json'), runner: 'tooling/qa/lifecycle-contracts.mjs' },
  environment: { node: process.version, typescript: ts.version, cwd: root, runTmp: work, overrides },
  ...(values.contract ? { contract_sha256: values.contract } : {}),
};
const registry = new Map();
let spawned = 0;
let settled = 0;
let interrupted = false;
const reference = (path) => {
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const interrupt = () => {
  interrupted = true;
  for (const entry of registry.values()) entry.stop();
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

async function runCommand(label, command, cwd = root) {
  assert.equal(interrupted, false, 'Runner interrupted');
  const capture = createCommandEvidence(owner, label, { ...command, env: overrides }, { cwd });
  const child = spawn(command.executable, command.args, {
    cwd, env: { ...process.env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  spawned += 1;
  capture.attach(child);
  let error;
  let cancelled = false;
  let forced = false;
  let escalation;
  const kill = (signal) => {
    if (!child.pid || !registry.has(label)) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (failure) {
      if (failure.code !== 'ESRCH') throw failure;
    }
  };
  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    kill('SIGTERM');
    escalation = setTimeout(() => { forced = true; kill('SIGKILL'); }, 1000);
  };
  registry.set(label, { child, stop });
  const outcome = await new Promise((complete) => {
    const deadline = setTimeout(stop, timeout);
    child.once('error', (failure) => { error = failure; });
    child.once('close', (exitCode, signal) => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      registry.delete(label);
      settled += 1;
      complete({ exitCode, signal, closed: true, cancelled, forced, ...(error ? { error } : {}) });
    });
  });
  const evidence = capture.finish(outcome);
  const receipt = JSON.parse(readFileSync(evidence.receipt.path, 'utf8'));
  report.commands.push({
    label, command: [command.executable, ...command.args], cwd: receipt.cwd, env: overrides,
    exit: outcome.exitCode, signal: outcome.signal, elapsedMs: receipt.duration_ms,
    evidence, log: evidence.log.path, logSha256: evidence.log.sha256,
    ...(command.expectedRejection ? { expectedRejection: true } : {}),
  });
  assert.equal(outcome.error, undefined, `${label}: spawn failed`);
  assert.equal(outcome.signal, null, `${label}: terminated by signal`);
  assert.equal(outcome.cancelled, false, `${label}: cancelled`);
  if (command.expectedRejection) assert.notEqual(outcome.exitCode, 0, `${label}: invalid input compiled`);
  else assert.equal(outcome.exitCode, 0, `${label}: see ${evidence.stderr.path}`);
  return readFileSync(evidence.stdout.path, 'utf8');
}

async function compile(consumer, name, nodeTypes = false) {
  const rejected = /-(?:numeric-hook|empty-union|promise-number|numeric-shutdown)$/u.test(name);
  const file = join(consumer, `${name}.mts`);
  const stdout = await runCommand(`tsc-${consumer.split(sep).pop()}-${name}`, {
    executable: process.execPath,
    args: [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext', '--target', 'ESNext', '--verbatimModuleSyntax', 'true',
      '--skipLibCheck', 'false', '--noEmitOnError', '--outDir', join(consumer, 'emitted'),
      '--listFiles', '--pretty', 'false', '--typeRoots',
      nodeTypes ? join(root, 'node_modules/@types') : join(work, 'empty-types'),
      ...(nodeTypes ? ['--types', 'node'] : []), ...(rejected ? ['--noEmit'] : []), file],
    expectedRejection: rejected,
  });
  const diagnostics = [...stdout.matchAll(/^(.+)\((\d+),(\d+)\): error TS(\d+):/gmu)];
  if (rejected) {
    assert.equal(diagnostics.length, 1, stdout);
    const diagnostic = diagnostics[0];
    assert.equal(resolve(root, diagnostic[1]), file);
    assert.deepEqual(diagnostic.slice(2), name.endsWith('numeric-shutdown')
      ? ['2', '71', '2345'] : ['2', name.endsWith('empty-union') ? '7' : '30', '2322']);
  } else {
    assert.equal(diagnostics.length, 0, stdout);
    const emitted = join(consumer, 'emitted', `${name}.mjs`);
    copyFileSync(emitted, join(owner.root, `${consumer.split(sep).pop()}-${name}.mjs`));
    if (!nodeTypes) {
      const ast = ts.createSourceFile(emitted, readFileSync(emitted, 'utf8'), ts.ScriptTarget.Latest, true);
      assert.equal(ast.statements.filter((node) =>
        ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier),
      ).length, 0, 'Type imports must not introduce JavaScript module requirements');
    }
  }
  const declarations = stdout.split('\n').filter((line) => line.includes('/node_modules/@fluojs/') && isAbsolute(line));
  assert.ok(declarations.length > 0, 'No public Fluo declarations resolved');
  assert.ok(declarations.every((path) => path.endsWith('.d.ts') && realpathSync(path).startsWith(`${consumer}${sep}`)));
  return declarations;
}

const archives = new Map();
async function runScenario(kind) {
  const names = resolveWorkspaceBuildOrder(kind === 'dependency' ? '@fluojs/core' : '@fluojs/runtime', root);
  const consumer = join(work, 'consumers', kind);
  mkdirSync(consumer, { recursive: true });
  const dependencies = Object.fromEntries(names.map((name) => [name, `file:${archives.get(name)}`]));
  writeJson(join(consumer, 'package.json'), {
    name: `packed-lifecycle-${kind}`, private: true, type: 'module', dependencies,
    pnpm: { overrides: dependencies },
  });
  await runCommand(`install-${kind}`, {
    executable: 'corepack', args: ['pnpm', 'install', '--ignore-workspace', '--ignore-scripts', '--lockfile=false'],
  }, consumer);
  const urls = JSON.parse(await runCommand(`resolve-${kind}`, {
    executable: process.execPath,
    args: ['--input-type=module', '--eval', `console.log(JSON.stringify(${JSON.stringify(names)}.map(name => ({ name, url: import.meta.resolve(name) }))));`],
  }, consumer));
  report.resolution[kind] = urls.map(({ name, url }) => {
    const entry = realpathSync(fileURLToPath(url));
    assert.ok(entry.startsWith(`${consumer}${sep}`), 'Package resolution escaped the isolated consumer');
    const manifest = JSON.parse(readFileSync(join(dirname(dirname(entry)), 'package.json'), 'utf8'));
    return { name, entry, version: manifest.version, dependencies: manifest.dependencies ?? {} };
  });
  const copyFixture = (source, name) => copyFileSync(join(values['fixture-dir'], source), join(consumer, `${name}.mts`));
  switch (kind) {
    case 'types':
      for (const name of ['valid', 'core-only', ...['core', 'runtime'].flatMap((ownerName) =>
        ['numeric-hook', 'empty-union', 'promise-number', 'numeric-shutdown'].map((invalid) => `${ownerName}-${invalid}`))]) {
        copyFixture(`types/${name}.mts`, name);
        await compile(consumer, name);
      }
      break;
    case 'dependency': {
      copyFixture('dependency/consumer.mts', 'consumer');
      const declarations = await compile(consumer, 'consumer');
      assert.deepEqual([...new Set(declarations.map((path) => path.split('/node_modules/@fluojs/').pop().split('/')[0]))].sort(), ['core', 'persistence']);
      assert.equal(existsSync(join(consumer, 'node_modules/@fluojs/runtime')), false);
      const core = report.resolution[kind].find((entry) => entry.name === '@fluojs/core');
      assert.deepEqual(Object.keys(core.dependencies).sort(), ['@fluojs/diagnostics', '@fluojs/persistence']);
      report.results.dependency = { declarations, coreDependencies: core.dependencies, runtimeAbsent: true };
      break;
    }
    case 'lifecycle':
    case 'failures': {
      copyFixture(`${kind}/main.mts`, 'main');
      await compile(consumer, 'main', true);
      const output = await runCommand(`node-${kind}`, { executable: process.execPath, args: [join(consumer, 'emitted/main.mjs')] }, consumer);
      const lines = output.split('\n').filter((line) => line.startsWith('###LIFECYCLE-RESULT### '));
      assert.equal(lines.length, 1, 'Expected exactly one fixture result sentinel');
      const result = JSON.parse(lines[0].slice('###LIFECYCLE-RESULT### '.length));
      assert.equal(result.kind, kind);
      assert.equal(result.ok, true);
      assert.deepEqual(result.failures, []);
      if (kind === 'lifecycle') {
        assert.deepEqual(result.events, ['A:init', 'B:init', 'A:bootstrap', 'B:bootstrap', 'B:destroy', 'A:destroy', 'B:shutdown:SIGTERM', 'A:shutdown:SIGTERM']);
        assert.deepEqual(result.afterCreate, result.events.slice(0, 4));
        assert.deepEqual(result.afterFirstClose, result.events);
      } else {
        assert.equal(result.sentinelIdentityPreserved && result.cleanupSettledBeforeRejection && result.destroyErrorIdentityPreserved, true);
        const cleanupIndex = result.events.indexOf('resource:cleanup:done');
        const rejectionIndex = result.events.indexOf('rejected');
        assert.ok(cleanupIndex >= 0 && rejectionIndex > cleanupIndex, 'Cleanup must exist and finish before rejection');
        assert.deepEqual(result.order, ['B:destroy', 'A:destroy', 'B:shutdown:SIGTERM', 'A:shutdown:SIGTERM']);
      }
      report.results[kind] = result;
      break;
    }
    default: assert.fail(`Unknown scenario ${kind}`);
  }
}

try {
  report.head = (await runCommand('observe-head', { executable: 'git', args: ['rev-parse', 'HEAD'] })).trim();
  report.source = { head: report.head, tree: (await runCommand('observe-tree', { executable: 'git', args: ['rev-parse', 'HEAD^{tree}'] })).trim() };
  report.environment.pnpm = (await runCommand('observe-pnpm', { executable: 'corepack', args: ['pnpm', '--version'] })).trim();
  for (const name of resolveWorkspaceBuildOrder(values.scenario === 'dependency' ? '@fluojs/core' : '@fluojs/runtime', root)) {
    const directory = join(root, 'packages', name.slice('@fluojs/'.length));
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    assert.ok(existsSync(join(directory, 'dist/index.d.ts')), `Build ${name} before running packed QA`);
    await runCommand(`pack-${name.slice('@fluojs/'.length)}`, { executable: 'corepack', args: ['pnpm', 'pack', '--pack-destination', join(work, 'tarballs')] }, directory);
    const archive = join(work, 'tarballs', `${name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`);
    const retained = join(owner.root, 'tarballs', archive.split(sep).pop());
    copyFileSync(archive, retained);
    archives.set(name, archive);
    report.tarballs.push({ package: name, version: manifest.version, ...reference(retained) });
  }
  for (const kind of selected) {
    try {
      await runScenario(kind);
      report.scenarios[kind] = 'PASS';
    } catch (error) {
      report.errors.push({ scenario: kind, message: error instanceof Error ? error.message : String(error) });
    }
    process.stdout.write(`SCENARIO ${kind} ${report.scenarios[kind]}\n`);
  }
} catch (error) {
  report.errors.push({ message: error instanceof Error ? error.message : String(error) });
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  assert.equal(registry.size, 0, 'A command must close before cleanup');
  rmSync(work, { recursive: true, force: true });
  const cleanup = { spawnedChildren: spawned, settledChildren: settled, childrenRegistryEmpty: registry.size === 0,
    removedPaths: [{ path: work, existsAfterCleanup: existsSync(work) }], allOwnedDirsAbsent: !existsSync(work) };
  writeJson(join(owner.root, 'cleanup.json'), cleanup);
  report.cleanup = reference(join(owner.root, 'cleanup.json'));
  report.children = { spawned, settled, registryEmpty: registry.size === 0 };
  if (!interrupted && report.errors.length === 0 && spawned === settled && cleanup.allOwnedDirsAbsent) report.status = 'passed';
  writeJson(report.authoring.generatedArtifact, report);
}
process.exitCode = report.status === 'passed' ? 0 : 1;
