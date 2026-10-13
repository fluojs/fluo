import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { sha256 } from '../src/profile-report.js';
import { assessPairs, evaluate, metrics, pairedInterval, requireCalibration } from '../results/issue-3940/gates.mjs';
import { assertPriorLimits, design, designSha256, frozenManifest, identities, scenarios, schedule } from '../results/issue-3940/plan.mjs';
import { readEvidence, shardedJournal } from '../results/issue-3940/storage.mjs';

const digest = 'a'.repeat(64);
function observedIdentities() {
  return {
    server: { hostname: 'fixture-server', runtime: '1.4.2', executable: '/fixture/bun', executableSha256: digest,
      address: '192.0.2.1', bindHost: '0.0.0.0', port: 33919, hostConfigurationSha256: digest,
      cpuCounterMethod: 'fixture-counter', cpuCounterResolutionSeconds: 0.001 },
    generator: { hostname: 'fixture-generator', runtime: 'v24.21.0', executable: '/fixture/node', executableSha256: digest,
      lockfileSha256: digest, clientSha256: digest, sshHost: 'fixture-host', remoteDirectory: '/fixture/load', hostConfigurationSha256: digest },
    network: { topologySha256: digest },
    buildReceipt: { path: '/fixture/build.json', sha256: digest },
    priorPolicy: { path: '/fixture/policy.json', sha256: digest },
    headroomWorkload: 'read-search-local',
  };
}
function manifest() {
  const artifacts = { '/fixture/server.js': digest };
  return { design: structuredClone(design), designSha256, identities: observedIdentities(), prepared: {
    artifacts, artifactsSha256: sha256(JSON.stringify(artifacts)),
    source: { gitHead: '1'.repeat(40), gitStatus: '', benchmarkSourceSha256: digest,
      lockfiles: { '/fixture/root/pnpm-lock.yaml': digest, '/fixture/bench/pnpm-lock.yaml': digest } },
  } };
}
function sample(connections = 64, duration = 40, ordinal = 1) {
  return {
    result: { errors: 0, timeouts: 0, non2xx: 0, mismatches: 0, connections, duration,
      requests: { total: 20_000, average: 500 } },
    statusMismatches: 0, latencyHistogramMicros: [[1000, 20_000]],
    generator: { ...observedIdentities().generator, pid: ordinal + 1000, nonce: `generator-${ordinal}` },
    server: { rootPid: ordinal + 10, subject: 'server-process-tree', method: 'fixture-counter',
      cpuTimeResolutionSeconds: 0.001, cpuSeconds: 2, wallSeconds: 40, peakRssBytes: 102400,
      samples: [
        { wallMs: 1, cpuTimeResolutionSeconds: 0.001, processes: [{ pid: ordinal + 10, cpuSeconds: 10, rssKiB: 100 }] },
        { wallMs: 40001, cpuTimeResolutionSeconds: 0.001, processes: [{ pid: ordinal + 10, cpuSeconds: 12, rssKiB: 100 }] },
      ] },
  };
}
function evidence() {
  const declared = manifest();
  return { phase: 'AA', manifestSha256: sha256(JSON.stringify(declared)), invalidAttempts: [] as unknown[],
    records: schedule().map((condition, ordinal) => ({
      condition, warmup: sample(condition.connections, 10, ordinal + 500),
      raw: sample(condition.connections, 40, ordinal),
      servingIdentity: { status: 'authenticated', instrumentation: 'none', target: 'fluo-bun',
        nonce: `server-${ordinal}`, pid: ordinal + 10, launcherPid: ordinal + 10,
        runtime: { bun: '1.4.2' }, executable: '/fixture/bun', executableSha256: digest,
        source: declared.prepared.source, artifacts: declared.prepared.artifacts },
    })) };
}

test('schedule: frozen finite design -> twenty-four conditions and five fresh pairs each', () => {
  const expectedCount = 6 * 2 * 2 * 5 * 2;

  const conditions = schedule();

  assert.equal(conditions.length, expectedCount);
  assert.equal(new Set(conditions.map((item) => JSON.stringify([item.workload, item.configuration, item.connections]))).size, 24);
  assert.deepEqual(conditions.slice(0, 4).map((item) => item.arm), ['A', 'B', 'B', 'A']);
});
test('scenarios: normalization fallback -> unchanged parameter response and canonical business fixtures', () => {
  const fixtures = scenarios();

  const fallback = fixtures.find((item) => item.name === 'normalization-fallback');

  assert.equal(fallback?.requests[0].path, '/stage//items/item-7/?value=alpha');
  assert.equal(fallback?.requests[0].expectedBody, '{"itemId":"item-7","value":"alpha"}');
  assert.equal(fixtures.length, 6);
});
test('identities: missing real host or shared host -> rejected before execution', () => {
  const declared = observedIdentities();
  declared.generator.hostname = declared.server.hostname;

  const validate = () => identities(declared);

  assert.throws(validate, /Separate server/);
  assert.throws(() => identities({}), /object|Object/);
});
test('frozenManifest: changed threshold -> rejected instead of relaxed', () => {
  const declared = manifest();
  declared.design.minimumCompletedRequests = 1;

  const validate = () => frozenManifest(declared);

  assert.throws(validate, /frozen design/);
});
test('evaluate: complete synthetic same-source raw records -> calibration gate passes', () => {
  const declared = manifest();

  const result = evaluate({ manifest: declared, evidence: evidence() });

  assert.equal(result.status, 'PASS');
});
for (const [label, mutate] of [
  ['incomplete matrix', (raw: ReturnType<typeof evidence>) => { raw.records.pop(); }],
  ['invalid attempts', (raw: ReturnType<typeof evidence>) => { raw.invalidAttempts.push({ reason: 'retained failure' }); }],
  ['reused server', (raw: ReturnType<typeof evidence>) => { raw.records[1].servingIdentity.nonce = raw.records[0].servingIdentity.nonce; }],
  ['wrong Bun', (raw: ReturnType<typeof evidence>) => { raw.records[0].servingIdentity.runtime.bun = 'fixture-other'; }],
  ['wrong generator', (raw: ReturnType<typeof evidence>) => { raw.records[0].raw.generator.hostname = 'fixture-other'; }],
  ['wrong order', (raw: ReturnType<typeof evidence>) => { raw.records.reverse(); }],
  ['CPU attribution', (raw: ReturnType<typeof evidence>) => { raw.records[0].raw.server.cpuSeconds = 3; }],
  ['histogram omission', (raw: ReturnType<typeof evidence>) => { raw.records[0].raw.latencyHistogramMicros[0][1] = 1; }],
  ['request error', (raw: ReturnType<typeof evidence>) => { raw.records[0].raw.result.errors = 1; }],
  ['early timing', (raw: ReturnType<typeof evidence>) => { raw.records[0].raw.result.duration = 1; }],
] as const) {
  test(`evaluate: ${label} -> calibration refused`, () => {
    const raw = evidence();
    mutate(raw);

    const validate = () => evaluate({ manifest: manifest(), evidence: raw });

    assert.throws(validate);
  });
}
test('evaluate: unequal same-source throughput -> INCONCLUSIVE without more runs', () => {
  const raw = evidence();
  for (const record of raw.records) if (record.condition.arm === 'B') record.raw.result.requests.average *= 1.04;

  const result = evaluate({ manifest: manifest(), evidence: raw });

  assert.equal(result.status, 'INCONCLUSIVE');
});
test('metrics: insufficient CPU precision -> cannot establish request cost', () => {
  const raw = sample();
  raw.server.cpuTimeResolutionSeconds = 1;
  raw.server.samples.forEach((item) => { item.cpuTimeResolutionSeconds = 1; });

  const validate = () => metrics(raw);

  assert.throws(validate, /Insufficient/);
});
test('pairedInterval: mixed improvement -> interval crosses zero', () => {
  const changes = [-0.1, 0.2, -0.1, 0.2, 0.05];

  const interval = pairedInterval(changes);

  assert.ok(interval.lower < 0);
  assert.ok(interval.upper > 0);
});
test('assessPairs: throughput alone improves -> candidate rejected for CPU', () => {
  const baseline = { throughput: 100, cpuPerRequest: 10, p95: 1, p99: 2, rss: 100 };
  const arms = { A: Array.from({ length: 5 }, () => baseline),
    B: Array.from({ length: 5 }, () => ({ ...baseline, throughput: 106 })) };

  const result = assessPairs(arms, true);

  assert.equal(result.status, 'FAIL');
  assert.ok(result.failures.includes('unproven gain cpuPerRequest'));
});
test('assessPairs: hit benefit with tail regression -> candidate rejected', () => {
  const baseline = { throughput: 100, cpuPerRequest: 10, p95: 1, p99: 2, rss: 100 };
  const arms = { A: Array.from({ length: 5 }, () => baseline),
    B: Array.from({ length: 5 }, () => ({ ...baseline, throughput: 106, cpuPerRequest: 9.4, p99: 2.2 })) };

  const result = assessPairs(arms, true);

  assert.equal(result.status, 'FAIL');
  assert.ok(result.failures.includes('regression p99'));
});
test('requireCalibration: scaling receipt alone -> profiling blocked', () => {
  const raw = { manifestSha256: sha256(JSON.stringify(manifest())), workload: 'read-search-local', invalidAttempts: [],
    observations: [[1, 4], [4, 1], [1, 4]].flat().map((workers, index) => ({
      workers, totalConnections: 64,
      servingIdentity: evidence().records[0].servingIdentity, server: sample(64, 40, 0).server,
      samples: Array.from({ length: workers }, (_, worker) => {
        const measured = sample(64 / workers, 10, index * 4 + worker + 1);
        measured.result.requests.average /= workers;
        return measured;
      }),
    })) };

  const validate = () => requireCalibration(manifest(), evidence(), raw);

  assert.throws(validate, /object|Object/);
});
test('assertPriorLimits: identical criteria -> accepts without changing limits', () => {
  const prior = { applicableLimits: design };

  const validate = () => assertPriorLimits(prior);

  assert.doesNotThrow(validate);
});
test('assertPriorLimits: stricter existing meaningful gain -> rejects weakened adoption', () => {
  const prior = { applicableLimits: { ...design, minimumHitImprovement: { throughput: 0.06, cpuPerRequest: 0.05 } } };

  const validate = () => assertPriorLimits(prior);

  assert.throws(validate, /Stricter prior gain/);
});
test('assertPriorLimits: stricter existing sample rule -> frozen design cannot weaken it', () => {
  const prior = { applicableLimits: { ...design, minimumCompletedRequests: 20_000 } };

  const validate = () => assertPriorLimits(prior);

  assert.throws(validate, /Stricter prior/);
});

for (const expectedBody of ['{"ok":true}', '{"wrong":true}']) {
  test(`generator: finite real HTTP ${expectedBody === '{"ok":true}' ? 'success' : 'mismatch'} -> preserves observed identity or raw diagnostics`, async () => {
    const server = createServer((_request, response) => response.end('{"ok":true}'));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listen address');
    const payload = Buffer.from(JSON.stringify({
      url: `http://127.0.0.1:${address.port}`, connections: 1, duration: 1, amount: 3,
      requests: [{ method: 'GET', path: '/', expectedStatus: 200, expectedBody }],
    })).toString('base64');
    const cwd = fileURLToPath(new URL('../', import.meta.url));

    try {
      const outcome = await promisify(execFile)(process.execPath,
        ['--import', 'tsx', 'results/issue-3940/generator.mts', payload], { cwd, timeout: 5000 })
        .then((result) => ({ code: 0, stdout: result.stdout }), (error: unknown) => {
          if (!(error instanceof Error) || !('stdout' in error) || typeof error.stdout !== 'string') throw error;
          return { code: 1, stdout: error.stdout };
        });

      const decoded = JSON.parse(outcome.stdout);
      if (expectedBody === '{"ok":true}') {
        assert.equal(outcome.code, 0);
        assert.equal(decoded.result.requests.total, 3);
        assert.equal(decoded.generator.hostname, hostname());
        assert.equal(decoded.generator.runtime, process.version);
        assert.match(decoded.generator.clientSha256, /^[a-f0-9]{64}$/);
      } else {
        assert.equal(outcome.code, 1);
        assert.ok(decoded.diagnostics.result.mismatches > 0);
        assert.ok(Array.isArray(decoded.diagnostics.latencyHistogramMicros));
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}

test('shardedJournal: complete finite AA originals -> unchanged evaluator and bounded index', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('../results/issue-3940/storage-test-', import.meta.url)));
  const path = join(directory, 'aa.json');
  const original = evidence();
  const pending: unknown[] = [];
  const journal = shardedJournal(path, { phase: original.phase, manifestSha256: original.manifestSha256 }, pending, 'records');
  try {
    for (const record of original.records) {
      pending.push(record);
      journal.flush();
    }
    journal.finish();

    const restored = readEvidence(path);

    assert.deepEqual(restored, original);
    assert.equal(evaluate({ manifest: manifest(), evidence: restored }).status, 'PASS');
    assert.equal(pending.length, 0);
    assert.ok(readFileSync(path).length < Buffer.byteLength(JSON.stringify(original)));
  } finally {
    journal.finish();
    rmSync(directory, { recursive: true });
  }
});

test('readEvidence: equal-byte-length valid JSON tampering -> shard original hash failure', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('../results/issue-3940/storage-test-', import.meta.url)));
  const path = join(directory, 'aa.json');
  const original = evidence();
  const pending: unknown[] = [...original.records];
  const journal = shardedJournal(path, { phase: original.phase, manifestSha256: original.manifestSha256 }, pending, 'records');
  journal.finish();
  try {
    const first = join(`${path}.shards`, 'record-0.json');
    const originalBytes = readFileSync(first);
    const changed = { ...original.records[0], servingIdentity: { ...original.records[0].servingIdentity, nonce: 'server-x' } };
    const bytes = Buffer.from(`${JSON.stringify(changed)}\n`);
    assert.equal(bytes.length, originalBytes.length);
    assert.notEqual(sha256(bytes), sha256(originalBytes));
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), changed);
    // Leave the original index and reference intact so byte/order guards cannot mask a missing hash guard.
    writeFileSync(first, bytes);

    const restore = () => readEvidence(path);

    assert.throws(restore, /Identity mismatch: shard original hash/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

for (const defect of ['missing', 'reordered', 'duplicated', 'condition-order'] as const) {
  test(`readEvidence: ${defect} original -> refuses calibration`, () => {
    const directory = mkdtempSync(fileURLToPath(new URL('../results/issue-3940/storage-test-', import.meta.url)));
    const path = join(directory, 'aa.json');
    const original = evidence();
    const pending: unknown[] = [...original.records];
    const journal = shardedJournal(path, { phase: original.phase, manifestSha256: original.manifestSha256 }, pending, 'records');
    journal.finish();
    try {
      const index = JSON.parse(readFileSync(path, 'utf8'));
      const first = join(`${path}.shards`, 'record-0.json');
      switch (defect) {
        case 'missing': unlinkSync(first); break;
        case 'reordered': index.recordShards.reverse(); break;
        case 'duplicated': index.recordShards[1] = index.recordShards[0]; break;
        case 'condition-order': {
          const changed = { ...original.records[0], condition: original.records[1].condition };
          const bytes = Buffer.from(`${JSON.stringify(changed)}\n`);
          writeFileSync(first, bytes);
          index.recordShards[0].sha256 = sha256(bytes);
          index.recordShards[0].bytes = bytes.length;
          break;
        }
      }
      // Even a self-consistent modified index must not bypass order/numeric gates.
      index.indexSha256 = sha256(JSON.stringify({ recordShards: index.recordShards, failureShards: index.failureShards }));
      writeFileSync(path, JSON.stringify(index));

      const calibrate = () => evaluate({ manifest: manifest(), evidence: readEvidence(path) });

      assert.throws(calibrate);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
}

test('shardedJournal: large full original and failed attempt -> retains bytes and blocks calibration', () => {
  const directory = mkdtempSync(fileURLToPath(new URL('../results/issue-3940/storage-test-', import.meta.url)));
  const path = join(directory, 'aa.json');
  const original = evidence();
  const completeOriginal = { ...original.records[0], retainedRaw: 'x'.repeat(1_310_720) };
  const pending: unknown[] = [completeOriginal, ...original.records.slice(1)];
  const journal = shardedJournal(path, { phase: original.phase, manifestSha256: original.manifestSha256 }, pending, 'records');
  journal.current = original.records[0].condition;
  journal.fail(new Error('retained original failure'));
  journal.finish();
  try {
    const restored = readEvidence(path);

    assert.ok(restored && typeof restored === 'object' && 'records' in restored && Array.isArray(restored.records));
    assert.deepEqual(restored.records[0], completeOriginal);
    assert.ok('invalidAttempts' in restored && Array.isArray(restored.invalidAttempts));
    assert.deepEqual(restored.invalidAttempts, journal.failures);
    assert.ok(readFileSync(path).length < 100_000);
    assert.throws(() => evaluate({ manifest: manifest(), evidence: restored }), /invalid attempts/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
