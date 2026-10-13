import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { FIXTURES } from '../src/issue-3942/fixtures.js';
import { assertGenerator, calibrationVerdicts, ownedPath, retainWarmup, smoke } from '../src/issue-3942/experiment.js';
import { evaluate, headroomGate, interval, type Metrics, POLICY } from '../src/issue-3942/gates.js';
import { assertFrozen, frozenPlan, localBinding, parseHosts } from '../src/issue-3942/manifest.js';
import { sha256 } from '../src/profile-report.js';
import { WDIR } from '../src/targets.js';

const metrics: Metrics = { throughput: 1_000, cpuPerRequest: 0.001, p95: 2, p99: 3, rss: 100_000_000 };
const pairs = Array.from({ length: 8 }, () => ({ a: metrics, b: metrics }));

test('calibration: stable same-build pairs -> passes without claiming candidate adoption', () => {
  const result = evaluate(pairs, 'aa');

  assert.equal(result.status, 'PASS');
  assert.equal(result.noiseBound, 0);
});

test('calibration: missing or nonfinite samples -> stays inconclusive', () => {
  const invalid = pairs.map((pair) => ({ ...pair, b: { ...metrics, rss: Number.NaN } }));

  assert.equal(evaluate(pairs.slice(1), 'aa').status, 'INCONCLUSIVE');
  assert.equal(evaluate(invalid, 'aa').status, 'INCONCLUSIVE');
  assert.equal(evaluate([...pairs, pairs[0]], 'aa').status, 'INCONCLUSIVE');
});

test('calibration: high run variance hidden by equal paired ratios -> fails CV', () => {
  const variable = pairs.map((pair, i) => ({
    a: { ...pair.a, throughput: i % 2 === 0 ? 800 : 1_200 },
    b: { ...pair.b, throughput: i % 2 === 0 ? 800 : 1_200 },
  }));

  const result = evaluate(variable, 'aa');

  assert.equal(result.status, 'INCONCLUSIVE');
  assert.match(result.reason ?? '', /^aa-cv:/);
});

test('calibration: finite CI extends beyond noise budget -> fails despite central ratio', () => {
  const noisy = pairs.map((pair, i) => ({ ...pair, b: { ...metrics, throughput: i % 2 === 0 ? 970 : 1_030 } }));

  const result = evaluate(noisy, 'aa');

  assert.equal(result.status, 'INCONCLUSIVE');
});

test('headroom: scaling gain or unexcluded bottleneck -> cannot authorize A/A', () => {
  const ratios = [1, 1, 1];

  assert.equal(headroomGate(ratios, true), 'PASS');
  assert.equal(headroomGate(ratios, false), 'INCONCLUSIVE');
  assert.equal(headroomGate([1.03, 1.03, 1.03], true), 'INCONCLUSIVE');
  assert.equal(headroomGate(ratios.slice(1), true), 'INCONCLUSIVE');
});

test('adoption: primary gain and calibrated noise -> requires all nonregression gates', () => {
  const good = pairs.map((pair) => ({ ...pair, b: { ...metrics, throughput: 1_040 } }));
  const regressed = good.map((pair) => ({ ...pair, b: { ...pair.b, cpuPerRequest: 0.00103 } }));

  assert.equal(evaluate(good, 'candidate', 'throughput', 0).status, 'PASS');
  assert.equal(evaluate(regressed, 'candidate', 'throughput', 0).status, 'INCONCLUSIVE');
  assert.equal(evaluate(good, 'candidate').status, 'INCONCLUSIVE');
});

test('adoption: gain below twice calibration noise -> rejects without extra repetitions', () => {
  const candidate = pairs.map((pair) => ({ ...pair, b: { ...metrics, throughput: 1_030 } }));

  const result = evaluate(candidate, 'candidate', 'throughput', 0.02);

  assert.equal(result.status, 'REJECT');
});

test('paired interval: invalid metrics -> rejects malformed evidence', () => {
  assert.throws(() => interval([1, 0]), TypeError);
  assert.throws(() => interval([1, Infinity]), TypeError);
});

const machine = {
  hostname: 'server', nodeVersion: 'v24.21.0', nodeExecutable: '/node',
  nodeExecutableSha256: 'a'.repeat(64), kernel: 'kernel', wsl: 'not-applicable',
  cpu: 'cpu', quota: 'unlimited', affinity: 'all', power: 'AC', backgroundLoad: 'idle-observed',
  identityEvidenceSha256: 'b'.repeat(64),
};
const hosts = {
  server: machine, generator: { ...machine, hostname: 'generator' },
  serverOrigin: 'http://192.0.2.1:33913', bindHost: '0.0.0.0',
  lease: 'test-only-lease', transport: 'direct-http',
  generatorLockfileSha256: 'c'.repeat(64), generatorEntrySha256: 'd'.repeat(64),
  generatorSshTarget: 'operator@generator',
};

const generatorResponse = {
  generator: {
    hostname: hosts.generator.hostname, node: hosts.generator.nodeVersion,
    executable: hosts.generator.nodeExecutable, osRelease: hosts.generator.kernel,
    cpus: [hosts.generator.cpu], pid: 123,
    nodeExecutableSha256: hosts.generator.nodeExecutableSha256,
    entrySha256: hosts.generatorEntrySha256, lockfileSha256: hosts.generatorLockfileSha256,
  },
  result: { requests: { total: 7 }, errors: 0 },
  latencyHistogramMicros: [[10, 7]],
  clientCpu: { userMicros: 17 },
  extraRawProvenance: { preserved: true },
};

test('warmup provenance: complete generator response -> retains every field before authentication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-3942-warmup-'));
  const path = join(directory, 'warmup.json');
  try {
    await retainWarmup(generatorResponse, parseHosts(hosts), path);

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), generatorResponse);
  } finally { await rm(directory, { recursive: true }); }
});

test('warmup identity: wrong actual host -> rejects while preserving full response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-3942-warmup-'));
  const path = join(directory, 'warmup.json');
  const response = { ...generatorResponse, generator: { ...generatorResponse.generator, hostname: 'wrong-host' } };
  try {
    await assert.rejects(retainWarmup(response, parseHosts(hosts), path), /generator identity/);

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), response);
  } finally { await rm(directory, { recursive: true }); }
});

for (const key of ['entrySha256', 'nodeExecutableSha256', 'lockfileSha256'] as const) {
  test(`generator authentication: same-length valid JSON ${key} tamper -> rejects observed identity`, () => {
    const wire = JSON.stringify(generatorResponse);
    const original = generatorResponse.generator[key];
    const tamperedWire = wire.replace(original, 'f'.repeat(64));
    assert.equal(Buffer.byteLength(wire), Buffer.byteLength(tamperedWire));
    const tampered: unknown = JSON.parse(tamperedWire);

    assertGenerator(generatorResponse, parseHosts(hosts));

    assert.throws(() => assertGenerator(tampered, parseHosts(hosts)), /generator identity/);
  });
}

test('compiled generator: identity-only execution -> authenticates actual bundle executable and lock bytes', async () => {
  const entry = join(WDIR, 'dist/issue-3942/generator/load-client.mjs');
  const expected = {
    entrySha256: sha256(await readFile(entry)),
    nodeExecutableSha256: sha256(await readFile(process.execPath)),
    lockfileSha256: sha256(await readFile(join(WDIR, 'dist/issue-3942/generator/pnpm-lock.yaml'))),
  };

  const output = await promisify(execFile)(process.execPath, [entry, '--identity']);
  const observed = JSON.parse(output.stdout).generator;

  assert.equal(observed.entryPath, entry);
  assert.equal(observed.executable, process.execPath);
  for (const key of ['entrySha256', 'nodeExecutableSha256', 'lockfileSha256'] as const) {
    assert.equal(observed[key], expected[key]);
  }
});

test('host binding: missing identities and tunnels -> rejects before any traffic', () => {
  const accepted = parseHosts(hosts);

  assert.equal(accepted.generator.hostname, 'generator');
  assert.throws(() => parseHosts({ ...hosts, server: {} }), /Missing real identity/);
  assert.throws(() => parseHosts({ ...hosts, transport: 'ssh-tunnel' }), /Tunnels/);
  assert.throws(() => parseHosts({ ...hosts, generator: machine }), /Independent/);
  assert.equal(parseHosts({ ...hosts, server: { ...machine, nodeVersion: 'v24.20.0' } }).server.nodeVersion, 'v24.20.0');
  assert.throws(() => parseHosts({ ...hosts, server: { ...machine, nodeVersion: 'v23.0.0' } }), /supported Node/);
});

test('owned evidence: traversal and shared output roots -> rejects scope widening', () => {
  assert.throws(() => ownedPath('results/issue-3941/raw.json'), /inside results/);
  assert.throws(() => ownedPath('results/issue-3942/../raw.json'), /inside results/);
  assert.match(ownedPath('results/issue-3942/raw.json'), /issue-3942\/raw.json$/);
});

test('frozen schedule: accepted finite design -> retains machine parameters and rejected history', () => {
  assert.deepEqual(POLICY.timing.connections, [16, 64]);
  assert.equal(POLICY.timing.pairs, 8);
  assert.equal(POLICY.timing.captureSeconds, 40);
  assert.equal(POLICY.historical.rejectedStreamOnlyCpuRatio, 1.0508237154627784);
});

const planHash = 'e'.repeat(64);
const aaRaw = {
  kind: 'aa', planSha256: planHash, policy: POLICY, invalidAttempts: [],
  samples: POLICY.fixtures.flatMap((name) => POLICY.timing.connections.flatMap((connections) =>
    Array.from({ length: 8 }, (_, pair) => (pair % 2 === 0 ? ['a', 'b'] : ['b', 'a']).map((side) => ({
      name, connections, pair, side, workers: 1, duration: 40, warmup: 10, metrics,
    }))).flat())),
};

test('A/A evidence: complete alternating matrix -> produces ten calibrated conditions', () => {
  const verdicts = calibrationVerdicts(aaRaw, planHash);

  assert.equal(verdicts.length, 10);
  assert.ok(verdicts.every((verdict) => verdict.status === 'PASS'));
});

test('A/A evidence: interrupted, duplicated or reordered samples -> rejects profile prerequisite', () => {
  const repeated = { ...aaRaw, samples: aaRaw.samples.map(() => aaRaw.samples[0]) };
  const reordered = { ...aaRaw, samples: [...aaRaw.samples].reverse() };

  assert.throws(() => calibrationVerdicts({ ...aaRaw, invalidAttempts: [{ interrupted: true }] }, planHash), /raw samples/);
  assert.throws(() => calibrationVerdicts(repeated, planHash), /drift/);
  assert.throws(() => calibrationVerdicts(reordered, planHash), /drift/);
  assert.throws(() => calibrationVerdicts(aaRaw, 'wrong-source'), /raw samples/);
});

test('frozen manifest: source, fixture, build and policy drift -> rejects before measurements', { timeout: 30_000 }, async () => {
  const binding = await localBinding();
  const boundHosts = parseHosts({
    ...hosts,
    server: {
      ...machine, hostname: binding.hostname, nodeVersion: process.version,
      nodeExecutable: process.execPath, nodeExecutableSha256: binding.nodeExecutableSha256,
    },
  });
  const plan = frozenPlan(boundHosts, binding);

  const accepted = assertFrozen(plan, binding);

  assert.equal(accepted.server.nodeVersion, process.version);
  assert.ok(Object.hasOwn(binding.source, 'packages/platform-express/src/adapter.ts'));
  assert.ok(Object.hasOwn(binding.source, 'packages/platform-nodejs/src/node/internal-node-request.ts'));
  assert.ok(Object.hasOwn(binding.builds, 'packages/diagnostics/dist/index.js'));
  assert.ok(Object.hasOwn(binding.builds, 'packages/runtime/package.json'));
  for (const key of ['sourceSha256', 'buildSha256', 'fixtureSha256', 'rootLockfileSha256'] as const) {
    assert.throws(() => assertFrozen({ ...plan, binding: { ...plan.binding, [key]: 'f'.repeat(64) } }, binding), /drift/);
  }
  assert.throws(() => assertFrozen({ ...plan, policy: { ...POLICY, timing: { ...POLICY.timing, pairs: 9 } } }, binding), /policy drift/);
});

for (const item of FIXTURES) {
  test(`fixture ${item.name}: real Express listener -> exact status/body and native contract`, { timeout: 30_000 }, async () => {
    const responses = await smoke(item.name, 0);

    assert.equal(responses.length, item.scenario.requests.length);
    assert.deepEqual(responses.map((response) => [response.status, response.body]),
      item.scenario.requests.map((request) => [request.expectedStatus, request.expectedBody]));
  });
}
