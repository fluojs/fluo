import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Issue3941 } from '../src/issue3941.js';
import { Issue3941Collector } from '../results/issue3941/collector.js';
import { sha256 } from '../src/profile-report.js';
import { WORKSPACE_ROOT } from '../src/provenance.js';
import { Issue3941Dependencies } from '../results/issue3941/dependencies.js';

const identities = () => ({
  server: { physicalHost: 'fixture-server', osCpu: 'fixture-linux-cpu', runtime: 'v24.20.0', executable: '/fixture/node', executableSha256: '1'.repeat(64), affinityPower: 'fixture-policy' },
  generator: { physicalHost: 'fixture-generator', osCpu: 'fixture-linux-cpu', runtime: 'v24.21.0', executable: '/fixture/node', executableSha256: '2'.repeat(64), affinityPower: 'fixture-policy' },
  source: { head: 'c'.repeat(40), packagesSha256: '3'.repeat(64), benchmarkSha256: '4'.repeat(64), buildSha256: '5'.repeat(64), workspaceLockSha256: '6'.repeat(64), benchmarkLockSha256: '7'.repeat(64), generatorLockSha256: '8'.repeat(64), preparedSha256: '9'.repeat(64), generatorClientSha256: 'a'.repeat(64), generatorInstalledLockSha256: 'b'.repeat(64), generatorDependenciesSha256: 'd'.repeat(64) },
  transport: { BENCH_SSH_HOST: 'fixture-generator', BENCH_SSH_CONTROL: '/fixture/control.sock', BENCH_REMOTE_DIR: '/fixture/load', BENCH_SERVER_HOST: 'fixture-server', BENCH_BIND_HOST: '0.0.0.0', networkPath: 'fixture-lan' },
});
const pair = (left = 100, right = 100) => ({ left, right });

const entryDirectory = await mkdtemp(join(tmpdir(), 'issue3941-entry-'));
const sharedPackageEntry = join(WORKSPACE_ROOT, 'packages/core/dist/index.js');
const sharedPackageBefore = await stat(sharedPackageEntry);
after(() => rm(entryDirectory, { recursive: true, force: true }));
before(async () => {
  // Workspace packages are prepared before the parallel suite; build only this private entry here.
  const execute = promisify(execFile);
  await execute('pnpm', ['exec', 'tsc', 'src/fluo/server.ts', '--target', 'ES2022',
    '--module', 'ESNext', '--moduleResolution', 'Bundler', '--strict', '--skipLibCheck',
    '--outDir', entryDirectory], { cwd: new URL('../', import.meta.url), timeout: 60_000 });
  await writeFile(join(entryDirectory, 'package.json'), JSON.stringify({ type: 'module' }));
  await symlink(new URL('../node_modules', import.meta.url).pathname, join(entryDirectory, 'node_modules'), 'dir');
}, { timeout: 240_000 });

test('benchmark entry setup: preserves the prepared shared package artifact', async () => {
  const afterBuild = await stat(sharedPackageEntry);

  assert.deepEqual(
    [afterBuild.dev, afterBuild.ino, afterBuild.size, afterBuild.mtimeMs, afterBuild.ctimeMs],
    [sharedPackageBefore.dev, sharedPackageBefore.ino, sharedPackageBefore.size, sharedPackageBefore.mtimeMs, sharedPackageBefore.ctimeMs],
  );
});

for (const host of [undefined, '0.0.0.0']) {
  test(`benchmark entry startup: bind host ${host ?? 'unset'} -> preserves adapter option and actual listener`, { timeout: 15_000 }, async () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('BENCH_') || key === 'NODE_OPTIONS') delete env[key];
    env.PORT = '0';
    if (host !== undefined) env.BENCH_BIND_HOST = host;
    const script = `
      import assert from 'node:assert/strict';
      import { mock } from 'node:test';
      import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
      import { FluoFactory } from '@fluojs/runtime';
      const adapterCreate = FastifyHttpApplicationAdapter.create;
      const appCreate = FluoFactory.create;
      let adapter, app, options, observation;
      mock.method(FastifyHttpApplicationAdapter, 'create', (input) => {
        options = input;
        adapter = adapterCreate.call(FastifyHttpApplicationAdapter, input);
        return adapter;
      });
      mock.method(FluoFactory, 'create', async (...args) => {
        app = await appCreate.apply(FluoFactory, args);
        return app;
      });
      try {
        await import(${JSON.stringify(pathToFileURL(join(entryDirectory, 'fluo/server.js')).href)});
        assert.ok(app && adapter);
        const address = adapter.getServer().address();
        assert.ok(address && typeof address !== 'string' && address.port > 0);
        observation = { options, address };
      } finally {
        if (app) await app.close();
        mock.restoreAll();
      }
      process.stdout.write('ISSUE3941_ENTRY ' + JSON.stringify(observation) + '\\n');
    `;

    const { stdout } = await promisify(execFile)(process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: new URL('../', import.meta.url), env, timeout: 10_000 });

    const messages = stdout.split('\n').filter((line) => line.startsWith('ISSUE3941_ENTRY '));
    assert.equal(messages.length, 1);
    const observed = JSON.parse(messages[0].slice('ISSUE3941_ENTRY '.length));
    assert.deepEqual(observed.options, host === undefined ? { port: 0 } : { port: 0, host });
    assert.ok(host === undefined ? ['127.0.0.1', '::1'].includes(observed.address.address) : observed.address.address === host);
  });
}

test('frozen policy artifact: machine contract -> matches executable gates', async () => {
  const historical = JSON.parse(await readFile(new URL('../results/issue3941/frozen-policy-windows-server.json', import.meta.url), 'utf8'));
  const fixture = JSON.parse(await readFile(new URL('../results/issue3941/frozen-policy-collector-integrity.json', import.meta.url), 'utf8'));

  assert.deepEqual(fixture, Issue3941.policy);
  assert.deepEqual(fixture, { ...historical, preflightSha256: 'b60b5ea4ddd154a0b233f328ef4ef88df584e9cddaef036e9e05c217fc5bece5' });
});

test('freeze: complete real-identity-shaped input -> binds finite immutable schedule', () => {
  const plan = Issue3941.freeze(identities());

  assert.equal(plan.runs.filter((run) => run.phase === 'aa').length, 120);
  assert.equal(plan.runs.filter((run) => run.phase === 'headroom').length, 6);
  assert.equal(plan.runs.filter((run) => run.phase === 'profile').length, 2);
  assert.equal(plan.policy.pairs, 5);
  assert.equal(plan.policy.automaticAdditionalRepeats, 0);
  assert.deepEqual(plan.runs.slice(0, 4).map((run) => run.arm), ['A1', 'A2', 'A2', 'A1']);
  assert.equal(Object.isFrozen(plan.policy), true);
  assert.equal(Object.isFrozen(plan.runs), true);
  assert.equal(Issue3941.parse(plan).sha256, plan.sha256);
});

for (const section of ['server', 'generator', 'source', 'transport'] as const) {
  test(`freeze: missing ${section} -> rejects before creating commands`, () => {
    const input: Record<string, unknown> = identities();
    delete input[section];

    assert.throws(() => Issue3941.freeze(input), TypeError);
  });
}
test('freeze: unknown executable digest or empty transport -> rejects invented defaults', () => {
  const input = identities();
  input.generator.executableSha256 = 'unknown';

  assert.throws(() => Issue3941.freeze(input), TypeError);
  input.generator.executableSha256 = '2'.repeat(64);
  input.transport.BENCH_SERVER_HOST = '';
  assert.throws(() => Issue3941.freeze(input), TypeError);
});

test('parse: changed threshold, source or schedule -> rejects changed freeze', () => {
  const plan = Issue3941.freeze(identities());
  for (const mutate of [
    (p: Record<string, unknown>) => { p.policy = {}; },
    (p: Record<string, unknown>) => { p.runs = []; },
    (p: Record<string, unknown>) => { const changed = identities(); changed.source.buildSha256 = '9'.repeat(64); p.identities = changed; },
  ]) {
    const input: Record<string, unknown> = structuredClone(plan);
    mutate(input);

    assert.throws(() => Issue3941.parse(input), TypeError);
  }
});

test('command: ordinary slot -> retains correctness, timing and issue-owned raw output', () => {
  const plan = Issue3941.freeze(identities());

  const command = Issue3941.command(plan, 0);

  assert.equal(command.env.BENCH_TARGETS, 'fluo-fastify');
  assert.equal(command.env.BENCH_RUNS, '1');
  assert.equal(command.env.BENCH_WARMUP_SEC, '10');
  assert.equal(command.env.BENCH_MEASURE_SEC, '40');
  assert.equal(command.env.BENCH_LOAD_PROCESS, '1');
  assert.equal(command.env.BENCH_SSH_CONTROL, '/fixture/control.sock');
  assert.match(command.env.BENCH_OUTPUT_JSON, /results\/issue3941\/.*aa.*\.json$/);
  assert.equal(Object.hasOwn(command.env, 'BENCH_DIAGNOSTIC_DRIFT'), false);
  assert.equal(command.args[2], 'results/issue3941/collector.ts');
  assert.equal(command.args[3], 'arm');
  assert.equal(command.args.at(-1), '0');
});

test('assertArtifacts: same-byte-length valid JSON corruption -> rejects changed hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue3941-hash-'));
  const path = join(directory, 'original.json');
  const original = '{"value":100}';
  const changed = '{"value":101}';
  try {
    await writeFile(path, original);
    const artifacts = { [path]: sha256(original) };
    await Issue3941Collector.assertArtifacts(artifacts);
    assert.equal(Buffer.byteLength(original), Buffer.byteLength(changed));
    assert.doesNotThrow(() => JSON.parse(changed));
    await writeFile(path, changed);

    await assert.rejects(Issue3941Collector.assertArtifacts(artifacts), /Artifact hash drift/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('parsePrepared: same-byte-length valid JSON corruption -> rejects prepared receipt tampering', () => {
  const body = {
    version: 1, preflightSha256: Issue3941.policy.preflightSha256, capturedAt: '0',
    commands: [
      { command: 'pnpm', args: ['--dir', WORKSPACE_ROOT, 'build'] },
      { command: 'pnpm', args: ['exec', 'tsc', 'src/fluo/server.ts'] },
      { command: 'pnpm', args: ['exec', 'esbuild', 'results/issue3941/generator.ts'] },
    ],
    artifacts: { '/fixture/package/dist/index.js': 'a'.repeat(64) },
  };
  const original = JSON.stringify({ ...body, sha256: sha256(JSON.stringify(body)) });
  const corrupted = original.replace('"capturedAt":"0"', '"capturedAt":"1"');
  assert.equal(Issue3941Collector.parsePrepared(JSON.parse(original)).body.capturedAt, '0');
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(corrupted));

  assert.throws(() => Issue3941Collector.parsePrepared(JSON.parse(corrupted)), /Artifact hash drift/);
});

test('assertRaw: same-byte-length valid JSON sample corruption -> rejects original byte drift', () => {
  const plan = Issue3941.freeze(identities());
  const original = '{"requests":100}';
  const changed = '{"requests":101}';
  const receipt = { slot: 0, path: Issue3941Collector.output(plan, 0), planSha256: plan.sha256,
    preparedSha256: plan.identities.source.preparedSha256, sha256: sha256(original) };
  Issue3941Collector.assertRaw(plan, 0, Buffer.from(original), receipt);
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(changed));

  assert.throws(() => Issue3941Collector.assertRaw(plan, 0, Buffer.from(changed), receipt), /Artifact hash drift/);
});

test('assertDigest: prepared inventory additions or removals -> rejects changed file closure', () => {
  const original = { '/fixture/source.ts': 'a'.repeat(64), '/fixture/dist/server.js': 'b'.repeat(64) };
  const expected = sha256(JSON.stringify(original));

  assert.throws(() => Issue3941Collector.assertDigest(JSON.stringify({
    ...original, '/fixture/dist/extra.js': 'c'.repeat(64),
  }), expected, 'prepared inventory'), /Artifact hash drift/);
  assert.throws(() => Issue3941Collector.assertDigest(JSON.stringify({
    '/fixture/source.ts': 'a'.repeat(64),
  }), expected, 'prepared inventory'), /Artifact hash drift/);
});

test('dependencies.capture: linked transitive bytes -> authenticates complete runtime closure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue3941-deps-'));
  try {
    const one = join(directory, 'node_modules/one');
    const two = join(directory, 'node_modules/two');
    await mkdir(one, { recursive: true });
    await mkdir(two, { recursive: true });
    await writeFile(join(one, 'package.json'), JSON.stringify({ name: 'one', dependencies: { two: '1' } }));
    await writeFile(join(two, 'package.json'), JSON.stringify({ name: 'two' }));
    const path = join(two, 'value.json');
    await writeFile(path, '{"value":100}');
    const captured = await Issue3941Dependencies.capture(join(directory, 'package.json'), ['one']);
    assert.equal(Object.keys(captured).length, 3);
    await writeFile(path, '{"value":101}');

    await assert.rejects(Issue3941Collector.assertArtifacts(captured), /Artifact hash drift/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('generator bundle: identity-only CLI -> reports actual executable lock client and dependency hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue3941-generator-'));
  try {
    const entry = join(directory, 'load-client.mjs');
    await promisify(execFile)('pnpm', ['exec', 'esbuild', 'results/issue3941/generator.ts',
      '--bundle', '--platform=node', '--format=esm', '--packages=external', `--outfile=${entry}`],
      { cwd: new URL('../', import.meta.url), timeout: 30_000 });
    await copyFile(new URL('../pnpm-lock.yaml', import.meta.url), join(directory, 'pnpm-lock.yaml'));
    await symlink(new URL('../node_modules', import.meta.url).pathname, join(directory, 'node_modules'), 'dir');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('BENCH_') || key === 'NODE_OPTIONS') delete env[key];

    const { stdout } = await promisify(execFile)(process.execPath, [entry, '--identity'], { env });

    const observed = JSON.parse(stdout);
    assert.equal(observed.protocol, 'issue3941-generator-v1');
    assert.equal(observed.node, process.version);
    assert.equal(observed.executable, process.execPath);
    assert.equal(observed.executableSha256, sha256(await readFile(process.execPath)));
    assert.equal(observed.clientSha256, sha256(await readFile(entry)));
    assert.equal(observed.lockSha256, sha256(await readFile(join(directory, 'pnpm-lock.yaml'))));
    assert.equal(observed.installedLockSha256, sha256(await readFile(join(directory, 'node_modules/.pnpm/lock.yaml'))));
    assert.equal(observed.autocannon, '7.15.0');
    assert.match(observed.dependenciesSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('assertEnvironment: inherited diagnostic preload or changed duration -> rejects before traffic', () => {
  const expected = Issue3941.command(Issue3941.freeze(identities()), 0).env;
  Issue3941Collector.assertEnvironment(expected, expected, ['--import', 'tsx']);

  for (const changed of [
    { ...expected, BENCH_DIAGNOSTIC_DRIFT: '1' }, { ...expected, NODE_OPTIONS: '--inspect' },
    { ...expected, BENCH_WARMUP_SEC: '1' },
  ]) assert.throws(() => Issue3941Collector.assertEnvironment(changed, expected, ['--import', 'tsx']), TypeError);
  assert.throws(() => Issue3941Collector.assertEnvironment(expected, expected, ['--import', 'tsx', '--inspect']), TypeError);
});

test('command: headroom without complete A/A receipt -> stays gated', () => {
  const plan = Issue3941.freeze(identities());
  const slot = plan.runs.findIndex((run) => run.phase === 'headroom');

  assert.throws(() => Issue3941.command(plan, slot), TypeError);
  assert.throws(() => Issue3941.command(plan, slot, undefined, undefined, {
    status: 'FAIL', planSha256: plan.sha256, artifacts: Array.from({ length: 120 }, () => ({})),
  }), TypeError);
});

test('collect: complete frozen schedule -> dispatches exactly 120 slots once without diagnostics', async () => {
  const plan = Issue3941.freeze(identities());
  const visited: number[] = [];

  await Issue3941Collector.collect(plan, async (slot) => { visited.push(slot); });

  assert.deepEqual(visited, plan.runs.flatMap((run, slot) => run.phase === 'aa' ? [slot] : []));
  assert.equal(new Set(visited).size, 120);
});

test('assertOrder: later slot without authenticated predecessor -> rejects before any traffic', async () => {
  const input = identities();
  input.server.physicalHost = `order-fixture-${process.pid}`;
  const plan = Issue3941.freeze(input);

  await assert.rejects(Issue3941Collector.assertOrder(plan, 1), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'ENOENT');
});

test('assertOrder: completed predecessor then restart or tamper -> enforces single frozen execution order', async () => {
  const input = identities();
  input.server.physicalHost = `order-fixture-${randomUUID()}`;
  const plan = Issue3941.freeze(input);
  const path = Issue3941Collector.output(plan, 0);
  const directory = join(path, '..');
  await mkdir(directory);
  try {
    await Issue3941Collector.assertOrder(plan, 0);
    const original = JSON.stringify(rawFixture(plan, 0));
    await writeFile(path, original);
    await writeFile(`${path}.receipt.json`, JSON.stringify({
      path, slot: 0, planSha256: plan.sha256, preparedSha256: plan.identities.source.preparedSha256, sha256: sha256(original),
    }));

    await Issue3941Collector.assertOrder(plan, 1);

    await assert.rejects(Issue3941Collector.assertOrder(plan, 0), /Frozen order/);
    const corrupted = original.replace('"total":100', '"total":101');
    assert.equal(Buffer.byteLength(original), Buffer.byteLength(corrupted));
    await writeFile(path, corrupted);
    await assert.rejects(Issue3941Collector.assertOrder(plan, 1), /Artifact hash drift/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const rawFixture = (plan: ReturnType<typeof Issue3941.freeze>, slot: number) => {
  const run = plan.runs[slot];
  const generator = { node: plan.identities.generator.runtime, executable: plan.identities.generator.executable,
    executableSha256: plan.identities.generator.executableSha256, lockSha256: plan.identities.source.generatorLockSha256,
    clientSha256: plan.identities.source.generatorClientSha256, protocol: 'issue3941-generator-v1',
    installedLockSha256: plan.identities.source.generatorInstalledLockSha256,
    dependenciesSha256: plan.identities.source.generatorDependenciesSha256 };
  const traffic = {
    result: { requests: { total: 100, average: 100 }, errors: 0, timeouts: 0, non2xx: 0, mismatches: 0 },
    statusMismatches: 0, generator, clientCpu: { userMicros: 1, systemMicros: 1, wallMicros: 1, coreEquivalentPercent: 1 },
    latencyHistogramMicros: [[1000, 100]], latencyPercentilesMs: { p50: 1, p95: 1, p99: 1 },
  };
  return {
    schemaVersion: 3, configuration: run.configuration, durationSeconds: 40, warmupSeconds: 10, runs: 1,
    cohort: { planSha256: plan.sha256, slot, run, preparedSha256: plan.identities.source.preparedSha256 },
    invalidAttempts: [],
    sweeps: [{ connections: run.connections, rawRuns: [[{ name: run.scenario, targets: [{
      label: 'fluo-fastify', ...traffic, warmup: traffic,
      coldStart: { firstRequest: traffic, processToReadyMs: 1 },
      servingIdentity: { status: 'authenticated', instrumentation: 'none', executable: plan.identities.server.executable,
        executableSha256: plan.identities.server.executableSha256, runtime: { node: plan.identities.server.runtime.slice(1) },
        artifactsSha256: plan.identities.source.buildSha256 },
      server: { cpuSeconds: 1, peakRssBytes: 100, samples: [{ wallMs: 0 }, { wallMs: 1 }] },
    }] }]] }],
  };
};

test('sample: real Node version formats -> accepts same runtime without rewriting either identity', () => {
  const input = identities();
  input.server.runtime = 'v24.21.0';
  input.server.executable = '/opt/fluo-tools/node-v24.21.0-linux-x64/bin/node';
  input.server.executableSha256 = '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c';
  input.source.buildSha256 = '722b27f414d0f2e65320bddd67c018fe155d4430b6cb638a5b3aaa38619ab9d0';
  const plan = Issue3941.freeze(input);
  const raw = rawFixture(plan, 0);
  const originals = structuredClone({ plan, raw });
  assert.equal(raw.sweeps[0].rawRuns[0][0].targets[0].servingIdentity.runtime.node, '24.21.0');
  assert.equal(plan.identities.server.runtime, 'v24.21.0');

  const sample = Issue3941Collector.sample(plan, 0, raw);

  assert.deepEqual(sample, { throughput: 100, cpu: 0.01, p95: 1, p99: 1, rss: 100 });
  assert.deepEqual({ plan, raw }, originals);
});

for (const field of ['runtime', 'executable', 'executableSha256', 'artifactsSha256', 'status', 'instrumentation'] as const) {
  test(`sample: different serving identity ${field} -> rejects drift with real version format`, () => {
    const input = identities();
    input.server.runtime = 'v24.21.0';
    const plan = Issue3941.freeze(input);
    const raw = rawFixture(plan, 0);
    const serving = raw.sweeps[0].rawRuns[0][0].targets[0].servingIdentity;
    if (field === 'runtime') serving.runtime.node = '24.21.1';
    else serving[field] = field.endsWith('Sha256') ? '0'.repeat(64) : 'different';

    assert.throws(() => Issue3941Collector.sample(plan, 0, raw), /Original serving identity drift/);
  });
}

test('sample: invalid serving version representations -> rejects prefix truncation whitespace and missing values', () => {
  const input = identities();
  input.server.runtime = 'v24.21.0';
  const plan = Issue3941.freeze(input);
  for (const version of ['v24.21.0', '24.21', '24.21.0 ', '024.21.0', 24.21, null, undefined]) {
    const raw = rawFixture(plan, 0);
    Reflect.set(raw.sweeps[0].rawRuns[0][0].targets[0].servingIdentity.runtime, 'node', version);

    assert.throws(() => Issue3941Collector.sample(plan, 0, raw), /Original serving identity drift/);
  }
});

test('checkTraffic: unprefixed generator runtime -> still rejects different generator wire format', () => {
  const plan = Issue3941.freeze(identities());
  const raw = rawFixture(plan, 0);
  const traffic = raw.sweeps[0].rawRuns[0][0].targets[0];
  traffic.generator.node = plan.identities.generator.runtime.slice(1);

  assert.throws(() => Issue3941Collector.checkTraffic(plan, traffic), /Generator identity drift/);
});

test('evaluate: complete original fixture matrix -> evaluates every frozen gate in schedule order', () => {
  const plan = Issue3941.freeze(identities());
  const rows = plan.runs.flatMap((run, slot) => run.phase === 'aa' ? [{ slot, raw: rawFixture(plan, slot) }] : []);

  const evaluation = Issue3941Collector.evaluate(plan, rows);

  assert.equal(evaluation.status, 'PASS_NUMERIC_GATE_ONLY');
  assert.equal(evaluation.conditions.length, 12);
  assert.equal(evaluation.conditions.every((condition) => condition.metrics.length === 5), true);
  assert.equal(evaluation.samples, 120);
  assert.equal(evaluation.noiseEnvelope, 0);
});

test('evaluate: missing duplicated reordered or invalidAttempts originals -> rejects incomplete cohort', () => {
  const plan = Issue3941.freeze(identities());
  const rows = plan.runs.flatMap((run, slot) => run.phase === 'aa' ? [{ slot, raw: rawFixture(plan, slot) }] : []);
  for (const changed of [rows.slice(1), [...rows.slice(1), rows[0]], [rows[0], ...rows.slice(0, -1)]]) {
    assert.throws(() => Issue3941Collector.evaluate(plan, changed), /finite|order/);
  }
  const invalid = structuredClone(rows);
  Reflect.set(invalid[0].raw, 'invalidAttempts', [{ phase: 'teardown' }]);

  assert.throws(() => Issue3941Collector.evaluate(plan, invalid), /invalidAttempts/);
});

test('evaluate: warmup correctness runtime drift and measured CPU drift -> cannot pass gates', () => {
  const plan = Issue3941.freeze(identities());
  const makeRows = () => plan.runs.flatMap((run, slot) => run.phase === 'aa' ? [{ slot, raw: rawFixture(plan, slot) }] : []);
  const badWarmup = makeRows();
  badWarmup[0].raw.sweeps[0].rawRuns[0][0].targets[0].warmup.result.mismatches = 1;
  assert.throws(() => Issue3941Collector.evaluate(plan, badWarmup), /traffic/);
  const changedGenerator = makeRows();
  changedGenerator[0].raw.sweeps[0].rawRuns[0][0].targets[0].generator.clientSha256 = 'b'.repeat(64);
  assert.throws(() => Issue3941Collector.evaluate(plan, changedGenerator), /Generator/);
  const cpuDrift = makeRows();
  for (const row of cpuDrift) if (plan.runs[row.slot].arm === 'A2') row.raw.sweeps[0].rawRuns[0][0].targets[0].server.cpuSeconds = 1.04;

  assert.equal(Issue3941Collector.evaluate(plan, cpuDrift).status, 'FAIL');
});

test('collect: finite schedule dispatch -> serial fresh slots stops on failure without rerun', async () => {
  const plan = Issue3941.freeze(identities());
  const visited: number[] = [];

  await assert.rejects(Issue3941Collector.collect(plan, async (slot) => {
    visited.push(slot);
    if (visited.length === 12) throw new Error('fixture failure');
  }), /fixture failure/);

  assert.deepEqual(visited, plan.runs.flatMap((run, slot) => run.phase === 'aa' ? [slot] : []).slice(0, 12));
});

test('collector CLI: malformed frozen input -> exits nonzero without build or traffic', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue3941-cli-'));
  try {
    const path = join(directory, 'bad.json');
    await writeFile(path, '{}');
    const execute = promisify(execFile);

    await assert.rejects(execute(process.execPath, ['--import', 'tsx',
      'results/issue3941/collector.ts', 'evaluate', path, path], { cwd: new URL('../', import.meta.url) }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('command: profile without bound calibration -> rejects rather than preselecting candidate', () => {
  const plan = Issue3941.freeze(identities());
  const index = plan.runs.findIndex((run) => run.phase === 'profile');

  assert.throws(() => Issue3941.command(plan, index), /calibration/);
  assert.throws(() => Issue3941.command(plan, -1), /slot/);
});

test('profile: missing or unbound calibration -> rejects before starting real traffic', async () => {
  const plan = Issue3941.freeze(identities());
  const slot = plan.runs.findIndex((run) => run.phase === 'profile');

  await assert.rejects(Issue3941.profile(plan, slot, { verdict: 'PASS' }), /source-bound/);
  await assert.rejects(Issue3941.profile(plan, slot, {
    verdict: 'PASS', planSha256: plan.sha256, sourceSha256: plan.identities.source.packagesSha256, artifacts: [],
  }), /128|120 A\/A/);
});

test('calibration: stable complete pairs -> passes numerical gate without adoption claim', () => {
  const pairs = Array.from({ length: 5 }, () => pair());

  const gate = Issue3941.calibration(pairs, 0.03);

  assert.equal(gate.status, 'PASS_NUMERIC_GATE_ONLY');
  assert.equal(gate.drift, 0);
  assert.equal(gate.leftCv, 0);
});

test('calibration: mean drift or arm variability -> fails frozen limits', () => {
  assert.equal(Issue3941.calibration(Array.from({ length: 5 }, () => pair(100, 104)), 0.03).status, 'FAIL');
  assert.equal(Issue3941.calibration([pair(80, 80), pair(), pair(), pair(), pair(120, 120)], 0.03).status, 'FAIL');
});

test('pairedInterval: deterministic gain -> preserves all pairs and frozen seed', () => {
  const pairs = Array.from({ length: 5 }, () => pair(100, 106));

  const result = Issue3941.pairedInterval(pairs);

  assert.deepEqual(result, Issue3941.pairedInterval(pairs));
  assert.ok(result.lower > 0.03);
  assert.equal(result.count, 5);
  assert.deepEqual(pairs, Array.from({ length: 5 }, () => pair(100, 106)));
});

test('numeric gates: missing, zero or nonfinite sample -> never yields pass', () => {
  for (const pairs of [[], [pair()], Array.from({ length: 5 }, () => pair(0, 1)), Array.from({ length: 5 }, () => pair(100, NaN))]) {
    assert.throws(() => Issue3941.pairedInterval(pairs), TypeError);
    assert.throws(() => Issue3941.calibration(pairs, 0.03), TypeError);
  }
});

test('headroom: same physical host -> stays inconclusive despite flat scaling', () => {
  const input = identities();
  input.generator.physicalHost = input.server.physicalHost;

  const gate = Issue3941.headroom(Issue3941.freeze(input), [pair(), pair(), pair()]);

  assert.equal(gate.status, 'INCONCLUSIVE');
});

test('headroom: independent host with scaling -> fails exact-repeat limit', () => {
  const plan = Issue3941.freeze(identities());

  const gate = Issue3941.headroom(plan, [pair(), pair(), pair(100, 106)]);

  assert.equal(gate.status, 'FAIL');
});

const comparison = () => Issue3941.policy.workloads.flatMap((workload) =>
  Issue3941.policy.configurations.flatMap((configuration) => Issue3941.policy.connections.map((connections) => ({
    condition: `${workload}/${configuration}/${connections}`,
    metrics: {
      throughput: Array.from({ length: 5 }, () => pair(100, 106)),
      cpu: Array.from({ length: 5 }, () => pair()),
      p95: Array.from({ length: 5 }, () => pair()),
      p99: Array.from({ length: 5 }, () => pair()),
      rss: Array.from({ length: 5 }, () => pair()),
    },
  }))));
test('comparison: complete stable gain -> clears only numerical gates', () => {
  const gate = Issue3941.comparison(comparison(), 0.03);

  assert.equal(gate.status, 'PASS_NUMERIC_GATE_ONLY');
  assert.equal(gate.observations.length, 12);
});
test('comparison: missing condition, uncertain interval, noise or regression -> never adopts', () => {
  const rows = comparison();
  rows[0].metrics.p99 = Array.from({ length: 5 }, () => pair(100, 106));

  assert.equal(Issue3941.comparison(rows, 0.03).status, 'INCONCLUSIVE_OR_REJECT');
  assert.equal(Issue3941.comparison(comparison(), 0.07).status, 'INCONCLUSIVE_OR_REJECT');
  assert.throws(() => Issue3941.comparison(rows.slice(1), 0.03), TypeError);
});
