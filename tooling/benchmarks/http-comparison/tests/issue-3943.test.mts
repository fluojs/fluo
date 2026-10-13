import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { EvidenceJournal } from '../src/evidence';
import { pairedInterval } from '../src/issue-3943/analysis';
import { retainCondition } from '../src/issue-3943/condition';
import { DESIGN, diagnosticArms } from '../src/issue-3943/design';
import { observeGeneratorArtifacts } from '../src/issue-3943/generator-artifacts';
import {
  frozenTopologyFixture as frozen,
  nativeGeneratorFixture,
  observedTopologyFixture as generatorFixture,
  requestTopologyFixture as requestFixture,
} from '../src/issue-3943/generator-fixture';
import { authenticateGenerator, authenticateGeneratorEvidence } from '../src/issue-3943/generator-identity';
import { assertArtifacts, parseFrozenInput } from '../src/issue-3943/identity';
import { assertTransport, parseTransport } from '../src/issue-3943/transport';
import { sha256 } from '../src/profile-report';
import { WDIR } from '../src/targets';

const execute = promisify(execFile);
const root = join(WDIR, 'results/issue-3943');

for (const failure of ['operation', 'cleanup', 'both'] as const) {
  test(`condition retention: ${failure} fails through real filesystem -> cleanup runs and original errors survive`, async () => {
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'condition-test-'));
    const manifest = join(directory, 'manifest.json');
    const journal = new EvidenceJournal(manifest, () => ({ issue: 3943 }));
    const operationPath = join(directory, 'missing-operation');
    const cleanupPath = join(directory, 'missing-cleanup');
    try {
      const action = retainCondition(async () => {
        await writeFile(join(directory, 'operation'), 'started');
        if (failure !== 'cleanup') await readFile(operationPath);
        return 'completed';
      }, async () => {
        await writeFile(join(directory, 'cleanup'), 'completed');
        if (failure !== 'operation') await readFile(cleanupPath);
      }, journal);

      await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, failure === 'both' ? 2 : 1);
        return true;
      });
      journal.finish();

      const retained = JSON.parse(await readFile(manifest, 'utf8'));
      assert.equal(await readFile(join(directory, 'operation'), 'utf8'), 'started');
      assert.equal(await readFile(join(directory, 'cleanup'), 'utf8'), 'completed');
      assert.deepEqual(retained.invalidAttempts.map((attempt: { error: { code: string } }) => attempt.error.code),
        Array.from({ length: failure === 'both' ? 2 : 1 }, () => 'ENOENT'));
      const paths = retained.invalidAttempts.map((attempt: { error: { message: string } }) => attempt.error.message);
      if (failure !== 'cleanup') assert.ok(paths.some((message: string) => message.includes(operationPath)));
      if (failure !== 'operation') assert.ok(paths.some((message: string) => message.includes(cleanupPath)));
    } finally {
      journal.finish();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('diagnostic arms: frozen design ->12 headroom and40 alternating A/A arms', () => {
  const arms = diagnosticArms();

  assert.equal(arms.filter((arm) => arm.phase === 'headroom').length, 12);
  assert.equal(arms.filter((arm) => arm.phase === 'aa').length, 40);
  for (const workload of DESIGN.workloads) {
    const headroom = arms.filter((arm) => arm.phase === 'headroom' && arm.workload === workload);
    assert.deepEqual(headroom.map((arm) => arm.workers), [1, 4, 4, 1, 1, 4]);
    assert.ok(headroom.every((arm) => arm.connections === 64 && arm.warmupSeconds === 3 && arm.captureSeconds === 10));
    for (const connections of [1, 64]) {
      const aa = arms.filter((arm) => arm.phase === 'aa' && arm.workload === workload && arm.connections === connections);
      assert.deepEqual(aa.map((arm) => arm.label), ['A1', 'A2', 'A2', 'A1', 'A1', 'A2', 'A2', 'A1', 'A1', 'A2']);
      assert.ok(aa.every((arm) => arm.warmupSeconds === 10 && arm.captureSeconds === 40));
    }
  }
});

test('frozen identity: actual process.version generator -> accepts and rejects bare versions.node format', () => {
  const input = parseFrozenInput(frozen());
  const request = requestFixture();
  const generator = generatorFixture(request);

  for (const pid of [process.pid, process.pid + 1, process.pid + 2]) {
    authenticateGenerator(input.generator, { ...generator, pid }, request);
  }

  assert.equal(process.version, `v${process.versions.node}`);
  for (const host of [
    { ...generator.host, node: process.versions.node }, { ...generator.host, node: 'v99.0.0' },
    { ...generator.host, hostname: 'wrong-host' },
  ]) assert.throws(() => authenticateGenerator(input.generator, { ...generator, host }, request));
  for (const phase of ['before', 'after'] as const) {
    for (const role of ['executable', 'entry', 'declaredLock', 'installedLock']) {
      const changed = { ...generator[phase], artifacts: { ...generator[phase].artifacts, [generator[phase].roles[role]]: 'c'.repeat(64) } };
      assert.throws(() => authenticateGenerator(input.generator, { ...generator, [phase]: changed }, request));
    }
  }
  assert.throws(() => authenticateGenerator(input.generator, generator, { ...request, duration: 10 }));
  assert.throws(() => authenticateGenerator(input.generator, { ...generator, instrumentation: { execArgv: ['--inspect'], nodeOptions: null } }, request));
});

test('native generator: one POST and real before/after observations -> binds actual wire body and rejects artifact/body changes', {
  skip: process.platform !== 'darwin', timeout: 60_000,
}, async () => {
  const good = await nativeGeneratorFixture();
  process.stdout.write(`${JSON.stringify({ correctnessOnly: true, condition: 'native-good', ...good })}\n`);
  assert.equal(good.exitCode, 0);
  assert.deepEqual(good.wire, { method: 'POST', path: '/payload', body: '{"value":"actual-wire-body"}' });
  const observation = authenticateGenerator(good.generator, good.response.generator, good.request);
  assert.deepEqual(observation.before.artifacts, good.generator.artifacts);
  assert.deepEqual(observation.after.artifacts, good.generator.artifacts);
  const bodyChanged = { ...good.request, requests: [{ ...good.request.requests[0], body: '{"value":"changed-wire-body"}' }] };
  assert.throws(() => authenticateGenerator(good.generator, good.response.generator, bodyChanged));
  for (const role of ['executable', 'entry', 'declaredLock', 'installedLock']) {
    assert.equal(observation.before.artifacts[observation.before.roles[role]], observation.after.artifacts[observation.after.roles[role]]);
  }
  for (const role of ['entry', 'declaredLock', 'installedLock'] as const) {
    const changed = await nativeGeneratorFixture(role);
    process.stdout.write(`${JSON.stringify({ correctnessOnly: true, condition: role, ...changed })}\n`);
    assert.equal(changed.exitCode, 0);
    assert.throws(() => authenticateGenerator(changed.generator, changed.response.generator, changed.request));
  }
  const wrongBody = await nativeGeneratorFixture('response-body');
  process.stdout.write(`${JSON.stringify({ correctnessOnly: true, condition: 'response-body', ...wrongBody })}\n`);
  assert.equal(wrongBody.exitCode, 1);
  assert.ok(wrongBody.response.failure);
});

test('LAN transport: declared server, bind, SSH target or directory drifts -> refuses local fallback and public endpoints', () => {
  const transport = parseFrozenInput(frozen()).transport;
  const env = {
    BENCH_SERVER_HOST: transport.serverHost, BENCH_BIND_HOST: transport.bindHost,
    BENCH_SSH_HOST: transport.sshTarget, BENCH_REMOTE_DIR: transport.remoteDirectory,
  };
  assertTransport(transport, env);
  for (const key of Object.keys(env)) assert.throws(() => assertTransport(transport, { ...env, [key]: 'changed' }));
  for (const override of [
    { sshTarget: undefined }, { sshTarget: 'ayden@192.168.1.20' }, { sshTarget: 'ayden@8.8.8.8' },
    { serverHost: '127.0.0.1' }, { bindHost: '127.0.0.1' }, { remoteDirectory: '/tmp/unsafe;command' },
  ]) assert.throws(() => parseTransport({ ...transport, ...override }));
});

test('remote generator: Mac executable absent on server -> authenticates copied receipt without opening remote paths', async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'remote-receipt-test-'));
  const input = parseFrozenInput(frozen());
  const { evidence: _evidence, ...generator } = input.generator;
  const path = join(directory, 'actual-generator.json');
  const bytes = JSON.stringify({
    issue: 3943, origin: 'actual-in-generator-observation', generator,
    instrumentation: { execArgv: [], nodeOptions: null },
  });
  try {
    await assert.rejects(readFile(generator.roles.executable), { code: 'ENOENT' });
    await writeFile(path, bytes);
    await authenticateGeneratorEvidence({ ...input.generator, evidence: { path, sha256: sha256(bytes) } });
    await writeFile(path, bytes.replace('independent-mac', 'substituted-mac'));
    await assert.rejects(authenticateGeneratorEvidence({ ...input.generator, evidence: { path, sha256: sha256(bytes) } }));
    assert.throws(() => parseFrozenInput({ ...frozen(), artifacts: { [generator.roles.executable]: 'a'.repeat(64) } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('generator observations: declared env hashes -> cannot replace actual executable, entry or lock bytes', async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'generator-observation-test-'));
  const entry = join(directory, 'load-client.mjs');
  const keys = ['BENCH_GENERATOR_EXECUTABLE_SHA256', 'BENCH_GENERATOR_ENTRY_SHA256', 'BENCH_GENERATOR_LOCK_SHA256'];
  const previous = keys.map((key) => process.env[key]);
  try {
    await writeFile(entry, 'export const marker = 3943;\n');
    keys.forEach((key) => { process.env[key] = '0'.repeat(64); });
    const actual = await observeGeneratorArtifacts(pathToFileURL(entry));
    for (const role of ['executable', 'entry', 'declaredLock', 'installedLock']) {
      const path = actual.roles[role];
      assert.equal(actual.artifacts[path], sha256(await readFile(path)));
      assert.notEqual(actual.artifacts[path], '0'.repeat(64));
    }
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(directory, { recursive: true, force: true });
  }
});

test('frozen design: relaxed CV or extended counts -> rejects before collection', () => {
  for (const design of [
    { ...DESIGN, gates: { ...DESIGN.gates, cv: 0.05 } },
    { ...DESIGN, aa: { ...DESIGN.aa, pairs: 6 } },
    { ...DESIGN, configuration: 'equivalent' },
  ]) {
    assert.throws(() => parseFrozenInput({ ...frozen(), design }));
  }
});

test('artifact authentication: real same-length byte tampering and missing file -> rejects originals retained', async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'identity-test-'));
  const path = join(directory, 'bundle.js');
  const original = Buffer.from('export const value = 1;\n');
  const artifacts = { [path]: sha256(original) };
  try {
    await writeFile(path, original);
    await assertArtifacts(artifacts);
    const changed = Buffer.from(original);
    changed[changed.indexOf(49)] = 50;

    await writeFile(path, changed);

    assert.equal(changed.byteLength, original.byteLength);
    await assert.rejects(assertArtifacts(artifacts));
    await writeFile(path, original);
    await assertArtifacts(artifacts);
    await assert.rejects(assertArtifacts({ [join(directory, 'missing.js')]: artifacts[path] }));
    assert.deepEqual(await readFile(path), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('paired ratios: independent nonconstant pairs -> deterministic95% interval without pooling or extra repeats', () => {
  const ratios = [0.98, 1.01, 1, 1.02, 0.99];

  const interval = pairedInterval(ratios);

  assert.deepEqual(interval, pairedInterval(ratios));
  assert.equal(interval.mean, 1);
  assert.ok(interval.low < 1 && interval.high > 1);
  assert.deepEqual(interval.ratios, ratios);
  assert.throws(() => pairedInterval([1, Number.NaN, 1]));
});

test('canonical CLI: invalid freeze and reused run ID -> retains failure and refuses overwrite before launch', { timeout: 10_000 }, async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'cli-test-'));
  const freeze = join(directory, 'frozen.json');
  const runId = `cli-3943-${directory.slice(directory.lastIndexOf('-') + 1)}`;
  const output = join(root, runId);
  try {
    await writeFile(freeze, JSON.stringify({ issue: 3943, design: { ...DESIGN, configuration: 'equivalent' } }));
    const args = ['--import', 'tsx', 'src/issue-3943/experiment.ts', freeze, runId];

    await assert.rejects(execute(process.execPath, args, { cwd: WDIR }));

    const before = await readFile(join(output, 'manifest.json'));
    const manifest = JSON.parse(before.toString('utf8'));
    assert.equal(manifest.performance, 'NOT_ESTABLISHED');
    assert.equal(manifest.adoption, 'BLOCKED');
    assert.equal(manifest.observations.length, 0);
    assert.equal(manifest.invalidAttempts.length, 1);
    const retained = JSON.parse(await readFile(join(output, 'frozen-input.json'), 'utf8'));
    assert.equal(retained.original, await readFile(freeze, 'utf8'));
    await assert.rejects(execute(process.execPath, args, { cwd: WDIR }), { code: 1 });
    assert.deepEqual(await readFile(join(output, 'manifest.json')), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});
