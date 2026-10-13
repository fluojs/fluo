import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { Server } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { FIXTURE_MANIFEST, FIXTURES, ResponseModule, fixtureRequest } from '../src/issue-3939/fixtures';
import { assertGenerator } from '../src/issue-3939/experiment';
import { deriveMetrics, evaluateAA, evaluateAAIncrementally } from '../src/issue-3939/analysis';
import { assertFrozenDesign, DESIGN, DESIGN_SHA256, evaluatePairs, parseHostIdentities } from '../src/issue-3939/plan';
import { evaluateRawIndex, readRawRecords, readRawShard, writeRawShard } from '../src/issue-3939/storage';

const hash = '1'.repeat(64);
const identities = () => ({
  server: { hostname: 'server-test', os: 'WSL-test', arch: 'x64', nodeExecutable: '/actual/server/node',
    nodeVersion: 'v24.20.0', nodeExecutableSha256: hash, power: 'observed AC', network: 'observed wired LAN',
    resourceLimits: 'observed unrestricted', backgroundWorkload: 'observed idle' },
  generator: { hostname: 'generator-test', os: 'Darwin-test', arch: 'arm64', nodeExecutable: '/actual/generator/node',
    nodeVersion: 'v24.21.0', nodeExecutableSha256: hash, power: 'observed AC', network: 'observed wired LAN',
    resourceLimits: 'observed 8 CPUs', backgroundWorkload: 'observed idle', lockfileSha256: hash, clientEntrySha256: hash },
  bindHost: '192.0.2.1', serverHost: '192.0.2.1', sshHost: 'lead-configured-generator', remoteDirectory: '/prepared/3939',
});
const metrics = () => Array.from({ length: 5 }, () => ({ throughput: 1_000, cpuPerRequest: 100, p95: 1, p99: 2, rss: 1_000_000 }));

function rawFixture() {
  return {
    measurement: { result: { errors: 0, timeouts: 0, non2xx: 0, mismatches: 0, duration: 40, connections: 64,
      requests: { total: 20_000, average: 500 } }, statusMismatches: 0, latencyHistogramMicros: [[1_000, 19_600], [2_000, 400]] },
    server: { cpuSeconds: 2, cpuTimeResolutionSeconds: 0.01, peakRssBytes: 102_400,
      samples: [{ processes: [{ pid: 123, cpuSeconds: 0, rssKiB: 100 }] }, { processes: [{ pid: 123, cpuSeconds: 2, rssKiB: 100 }] }] },
  };
}

test('deriveMetrics: real counters -> CPU per validated request and histogram percentiles', () => {
  const input = rawFixture();

  const result = deriveMetrics(input.measurement, input.server, 40, 64);

  assert.deepEqual(result, { throughput: 500, cpuPerRequest: 100, p95: 1, p99: 2, rss: 102_400 });
});

test('deriveMetrics: coarse CPU precision -> inconclusive without guessed precision', () => {
  const input = rawFixture();
  input.server.cpuTimeResolutionSeconds = 1;

  const action = () => deriveMetrics(input.measurement, input.server, 40, 64);

  assert.throws(action, /INCONCLUSIVE/);
});

test('deriveMetrics: histogram count mismatch -> rejects fabricated completion denominator', () => {
  const input = rawFixture();
  input.measurement.result.requests.total -= 1;

  const action = () => deriveMetrics(input.measurement, input.server, 40, 64);

  assert.throws(action, /Completed count/);
});

test('deriveMetrics: summary differs from raw CPU endpoints -> rejects invented summary', () => {
  const input = rawFixture();
  input.server.cpuSeconds = 1;

  const action = () => deriveMetrics(input.measurement, input.server, 40, 64);

  assert.throws(action, /contradicts retained counters/);
});

test('evaluateAA: recorded invalid attempt -> fails before any calibration verdict', () => {
  const input = { phase: 'aa', manifestSha256: hash, invalidAttempts: [{ error: 'interrupted' }], records: [] };

  const action = () => evaluateAA(input, hash, hash);

  assert.throws(action, /Invalid attempts/);
});

function calibrationFixture() {
  let nonce = 0;
  return { phase: 'aa', manifestSha256: hash, invalidAttempts: [],
    records: DESIGN.fixtures.flatMap((fixture) => DESIGN.configurations.flatMap((configuration) =>
      DESIGN.connections.flatMap((connections) => DESIGN.pairOrder.flatMap((arms, repeat) =>
        arms.map((arm) => {
          const input = rawFixture();
          input.measurement.result.connections = connections;
          const identity = { status: 'authenticated', instrumentation: 'none', artifactsSha256: hash, nonce: `nonce-${nonce++}` };
          return { condition: { fixture: fixture.name, configuration, connections, repeat, arm },
            identity, identityAfter: { ...identity }, server: input.server,
            warmup: { ...input.measurement, result: { ...input.measurement.result, duration: 10 } },
            value: [input.measurement] };
        }))))),
  };
}

for (const [scenario, verdict, expectedExitCode] of [
  ['incomplete', 'FAIL_EVIDENCE', 1],
  ['insufficient-requests', 'INCONCLUSIVE', 1],
  ['unstable', 'INCONCLUSIVE', 1],
  ['calibrated', 'CALIBRATED', 0],
  ['missing-shard', 'FAIL_EVIDENCE', 1],
  ['tampered-shard', 'FAIL_EVIDENCE', 1],
  ['outside-root', 'FAIL_EVIDENCE', 1],
  ['extra-shard', 'FAIL_EVIDENCE', 1],
  ['reordered-shards', 'FAIL_EVIDENCE', 1],
  ['historical', 'HISTORICAL_NOT_ESTABLISHED', 1],
] as const) {
  test(`evaluate-aa CLI: ${scenario} synthetic raw -> exit ${expectedExitCode} with report and raw retained`, { timeout: 15_000 }, async () => {
    const directory = await mkdtemp(fileURLToPath(new URL(`../results/issue-3939/cli-gate-${scenario}-`, import.meta.url)));
    const manifestPath = join(directory, 'manifest.json');
    const rawPath = join(directory, 'raw.json');
    const reportPath = join(directory, 'report.json');
    const manifestBytes = JSON.stringify({ design: DESIGN, designSha256: DESIGN_SHA256, source: { artifactsSha256: hash } });
    const raw = calibrationFixture();
    raw.manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    switch (scenario) {
      case 'incomplete': raw.records.pop(); break;
      case 'insufficient-requests':
        raw.records[0].value[0].result.requests.total -= 1;
        raw.records[0].value[0].latencyHistogramMicros[0][1] -= 1;
        break;
      case 'unstable': raw.records[0].value[0].result.requests.average *= 1.1; break;
      case 'calibrated': case 'missing-shard': case 'tampered-shard': case 'outside-root': case 'extra-shard': case 'reordered-shards': case 'historical': break;
    }
    const references = scenario === 'historical' ? [] : raw.records.map((record, ordinal) => writeRawShard(directory, `record-${ordinal}.json`, record));
    if (scenario === 'reordered-shards') [references[0], references[1]] = [references[1], references[0]];
    const rawBytes = JSON.stringify(scenario === 'historical' ? raw
      : { ...raw, kind: 'issue-3939-raw-shards-v1', issue: 3939, designSha256: DESIGN_SHA256, records: references });
    await writeFile(manifestPath, manifestBytes, { flag: 'wx' });
    await writeFile(rawPath, rawBytes, { flag: 'wx' });
    if (scenario === 'missing-shard') await rm(join(directory, references[0].path));
    if (scenario === 'tampered-shard') {
      await chmod(join(directory, references[0].path), 0o644);
      await writeFile(join(directory, references[0].path), '{"tampered":true}');
    }
    if (scenario === 'outside-root') {
      await rm(join(directory, references[0].path));
      const outside = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-external-', import.meta.url)));
      const original = join(outside, 'original.json');
      await writeFile(original, JSON.stringify(raw.records[0]));
      await symlink(original, join(directory, references[0].path));
    }
    if (scenario === 'extra-shard') writeRawShard(directory, `record-${references.length}.json`, raw.records[0]);
    const child = spawn(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL('../src/issue-3939/experiment.ts', import.meta.url)),
      'evaluate-aa', manifestPath, rawPath, reportPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, killSignal: 'SIGKILL' });
    const closed = once(child, 'close');
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (bytes: Buffer) => { stdout += bytes.toString(); });
    child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });

    const [exitCode, signal] = await closed;

    assert.equal(exitCode, expectedExitCode, stderr);
    assert.equal(signal, null);
    const reportBytes = await readFile(reportPath, 'utf8');
    assert.equal(JSON.parse(reportBytes).aa, verdict);
    assert.deepEqual(JSON.parse(stdout), JSON.parse(reportBytes));
    assert.equal(await readFile(rawPath, 'utf8'), rawBytes);
    assert.equal(await readFile(manifestPath, 'utf8'), manifestBytes);
  });
}

test('raw shards: large original -> immutable full bytes with bounded index', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-full-', import.meta.url)));
  const original = { ...calibrationFixture().records[0], extraRaw: 'x'.repeat(1_310_000) };

  const reference = writeRawShard(directory, 'record-0.json', original);
  const retained = await readRawShard(directory, reference);

  assert.deepEqual(retained, original);
  assert.ok(JSON.stringify(reference).length < 200);
  assert.throws(() => writeRawShard(directory, 'record-0.json', { overwritten: true }), /EEXIST/);
});

test('raw shards: next record tampered after iterator starts -> detects original incrementally', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-incremental-', import.meta.url)));
  const records = calibrationFixture().records.slice(0, 2).map((record, ordinal) => writeRawShard(directory, `record-${ordinal}.json`, record));
  const iterator = readRawRecords(join(directory, 'raw.json'), { records });
  await iterator.next();
  await chmod(join(directory, records[1].path), 0o644);
  await writeFile(join(directory, records[1].path), '{}');

  const action = iterator.next();

  await assert.rejects(action, /Tampered raw shard/);
});

test('raw shards: outside-root relative reference -> rejects original path', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-path-', import.meta.url)));
  const reference = { path: '../record-0.json', bytes: 2, sha256: hash };

  const action = readRawShard(directory, reference);

  await assert.rejects(action, /outside-root/);
});

test('raw shards: retained full failure -> authenticates original and rejects calibration', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-failure-', import.meta.url)));
  const failure = { error: { traffic: rawFixture(), stdout: 'x'.repeat(1_310_000) } };
  const reference = writeRawShard(directory, 'failure-0.json', failure);
  const path = join(directory, 'raw.json');
  await writeFile(path, JSON.stringify({ kind: 'issue-3939-raw-shards-v1', issue: 3939, designSha256: DESIGN_SHA256, phase: 'aa', manifestSha256: hash,
    invalidAttempts: [{ condition: { fixture: 'utf8-large' }, error: { name: 'Error', message: 'failure', code: reference } }], records: [] }));

  const action = evaluateRawIndex(path, hash, hash);

  await assert.rejects(action, /Invalid attempts/);
  assert.deepEqual(await readRawShard(directory, reference), failure);
});

test('raw shards: tampered retained failure -> rejects original diagnostics hash', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-failure-tampered-', import.meta.url)));
  const reference = writeRawShard(directory, 'failure-0.json', { error: { traffic: rawFixture() } });
  const path = join(directory, 'raw.json');
  await writeFile(path, JSON.stringify({ kind: 'issue-3939-raw-shards-v1', issue: 3939, designSha256: DESIGN_SHA256, phase: 'aa', manifestSha256: hash,
    invalidAttempts: [{ condition: { fixture: 'utf8-large' }, error: { name: 'Error', message: 'failure', code: reference } }], records: [] }));
  await chmod(join(directory, reference.path), 0o644);
  await writeFile(join(directory, reference.path), '{}');

  const action = evaluateRawIndex(path, hash, hash);

  await assert.rejects(action, /Tampered raw shard/);
});

test('raw shards: evaluator consumes each original before next yield -> retains metrics rather than all full raw', async () => {
  const input = calibrationFixture();
  async function* originals() {
    for (const record of input.records) {
      yield record;
      record.identity.status = 'released-after-consume';
      record.value[0].result.requests.total = 0;
    }
  }

  const result = await evaluateAAIncrementally(originals(), hash, hash);

  assert.equal(result.aa, 'CALIBRATED');
  assert.equal(result.observations.length, 44);
});

test('raw shards: historical successful synthetic raw -> readable but never promoted to current calibration', async () => {
  const directory = await mkdtemp(fileURLToPath(new URL('../results/issue-3939/shard-historical-', import.meta.url)));
  const path = join(directory, 'raw.json');
  const bytes = JSON.stringify(calibrationFixture());
  await writeFile(path, bytes);

  const result = await evaluateRawIndex(path, hash, hash);

  assert.equal(result.aa, 'HISTORICAL_NOT_ESTABLISHED');
  assert.equal(await readFile(path, 'utf8'), bytes);
});

test('evaluateAA: complete stable finite matrix -> calibrates without claiming headroom', () => {
  const input = calibrationFixture();

  const result = evaluateAA(input, hash, hash);

  assert.equal(result.aa, 'CALIBRATED');
  assert.equal(result.headroom, 'NOT_ESTABLISHED');
  assert.equal(result.observations.length, 44);
});

test('evaluateAA: missing finite-matrix arm -> rejects incomplete calibration', () => {
  const input = calibrationFixture();
  input.records.pop();

  const action = () => evaluateAA(input, hash, hash);

  assert.throws(action, /finite-matrix/);
});

test('evaluateAA: reused serving nonce -> rejects same process identity', () => {
  const input = calibrationFixture();
  input.records[1].identity.nonce = input.records[0].identity.nonce;
  input.records[1].identityAfter.nonce = input.records[0].identity.nonce;

  const action = () => evaluateAA(input, hash, hash);

  assert.throws(action, /reused or drifting/);
});

test('evaluateAA: failed warmup -> rejects otherwise stable ordinary matrix', () => {
  const input = calibrationFixture();
  input.records[0].warmup.result.mismatches = 1;

  const action = () => evaluateAA(input, hash, hash);

  assert.throws(action, /Invalid warmup/);
});

test('freeze: altered fixture or threshold -> rejects before execution', () => {
  const changed = structuredClone(DESIGN);
  Object.assign(changed.regression, { throughput: 0.04 });

  const action = () => assertFrozenDesign({ design: changed, designSha256: DESIGN_SHA256 });

  assert.throws(action, /design or fixture identity changed/);
});

for (const field of ['hostname', 'nodeVersion', 'nodeExecutableSha256', 'power', 'network', 'resourceLimits', 'backgroundWorkload']) {
  test(`identity: missing generator ${field} -> rejects unobserved host`, () => {
    const input = identities();
    Reflect.deleteProperty(input.generator, field);

    const action = () => parseHostIdentities(input);

    assert.throws(action);
  });
}

test('identity: generator aliases server -> rejects nonindependent load host', () => {
  const input = identities();
  input.generator.hostname = input.server.hostname;

  const action = () => parseHostIdentities(input);

  assert.throws(action, /Independent generator/);
});

test('generator: changed actual runtime -> rejects declaration-only identity', () => {
  const expected = parseHostIdentities(identities()).generator;
  const response = { generator: { ...expected, pid: 123, nodeVersion: 'v24.19.0' } };

  const action = () => assertGenerator(response, expected);

  assert.throws(action, /Generator identity drift/);
});

test('evaluatePairs: unstable same-source throughput -> remains inconclusive', () => {
  const before = metrics();
  const after = metrics();
  after[0].throughput = 1_100;
  after[1].throughput = 900;

  const result = evaluatePairs(before, after, 'aa');

  assert.equal(result.verdict, 'INCONCLUSIVE');
});

test('evaluatePairs: missing pair -> rejects without estimating omitted sample', () => {
  const before = metrics();
  const after = metrics().slice(1);

  const action = () => evaluatePairs(before, after, 'ab', true);

  assert.throws(action, /Exactly five/);
});

test('evaluatePairs: significant primary CPU benefit with stable controls -> meets declared gate only', () => {
  const before = metrics();
  const after = metrics().map((sample) => ({ ...sample, cpuPerRequest: 90 }));

  const result = evaluatePairs(before, after, 'ab', true);

  assert.equal(result.verdict, 'WITHIN_DECLARED_GATE');
});

test('evaluatePairs: mean benefit but regression CI overlaps budget -> inconclusive', () => {
  const before = metrics();
  const after = metrics().map((sample, index) => ({ ...sample, cpuPerRequest: 90, p99: [1.8, 2.2, 2, 1.9, 2.1][index] }));

  const result = evaluatePairs(before, after, 'ab', true);

  assert.equal(result.verdict, 'INCONCLUSIVE');
});

test('evaluatePairs: latency regression despite CPU improvement -> rejects candidate', () => {
  const before = metrics();
  const after = metrics().map((sample) => ({ ...sample, cpuPerRequest: 90, p99: 2.2 }));

  const result = evaluatePairs(before, after, 'ab', true);

  assert.equal(result.verdict, 'REJECT');
});

test('ResponseModule: frozen fixtures -> real Factory serves exact status and bytes', { timeout: 20_000 }, async () => {
  const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
  const app = await FluoFactory.create(ResponseModule, { adapter });
  await app.listen();
  const server = adapter.getServer();
  assert.ok(server instanceof Server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    for (const fixture of FIXTURE_MANIFEST) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}${fixture.path}`, { signal: AbortSignal.timeout(5_000) });
      const bytes = Buffer.from(await response.arrayBuffer());

      assert.equal(response.status, fixture.status, fixture.name);
      assert.equal(bytes.length, fixture.bytes, fixture.name);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256, fixture.name);
      assert.equal(bytes.toString(), fixtureRequest(fixture.name).expectedBody, fixture.name);
    }
  } finally {
    await app.close();
  }
});

test('fixtureRequest: unknown fixture -> rejects without fallback body', () => {
  const name = 'not-a-fixture';

  const action = () => fixtureRequest(name);

  assert.throws(action, /Unknown #3939 fixture/);
  assert.equal(FIXTURES.length, 11);
});
