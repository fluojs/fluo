import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EvidenceJournal } from '../src/evidence';
import type { TargetResult } from '../src/report';
import { runScenario } from '../src/run';
import { startTargets, stopTargets, type TargetConfig, waitForTarget } from '../src/targets';
import { authenticateTimingIdentity, prepareTimingIdentity, TimingIdentityFailure } from '../src/timing-identity';

const fixture = fileURLToPath(new URL('./fixtures/timing-server.mjs', import.meta.url));

async function condition() {
  const reservation = createServer();
  const listening = once(reservation, 'listening');
  reservation.listen(0, '127.0.0.1');
  await listening;
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const closed = once(reservation, 'close');
  reservation.close();
  await closed;
  const target: TargetConfig = {
    name: 'native-nodejs', platform: 'nodejs', product: 'native',
    label: 'native-nodejs', port: address.port, command: process.execPath, args: [fixture],
  };
  const directory = await mkdtemp(join(tmpdir(), 'fluo-timing-'));
  const path = join(directory, 'evidence.json');
  const samples: TargetResult[] = [];
  const journal = new EvidenceJournal(path, () => ({ samples }));
  return { target, directory, path, samples, journal };
}

test('runScenario: successful finite HTTP phases -> preserves raw warmup and serving process', { timeout: 20_000 }, async () => {
  // Given
  const setup = await condition();
  try {
    // When
    await runScenario({
      name: 'timing-fixture', description: 'finite HTTP fixture', appShape: 'read-search-local',
      requests: [{ path: '/', method: 'GET', expectedStatus: 200, expectedBody: '{"ok":true}' }],
    }, { index: 0, repeat: 0, targets: [setup.target], connections: 1, samples: setup.samples, journal: setup.journal, amount: 3 });
    setup.journal.finish();

    // Then
    const evidence = JSON.parse(await readFile(setup.path, 'utf8'));
    const sample = evidence.samples[0];
    assert.equal(evidence.invalidAttempts.length, 0);
    assert.ok(sample.warmup, 'successful warmup must retain its raw Measurement');
    assert.equal(sample.warmup.result.requests.total, 3);
    assert.equal(sample.warmup.statusMismatches, 0);
    assert.equal(sample.warmup.latencyHistogramMicros.reduce((sum: number, row: number[]) => sum + row[1], 0), 3);
    assert.ok(sample.warmup.clientCpu.wallMicros > 0);
    assert.ok(sample.servingIdentity, 'timing must identify the actual serving process');
    assert.equal(sample.servingIdentity.status, 'authenticated');
    assert.equal(sample.servingIdentity.pid, sample.server.rootPid);
    assert.equal(sample.servingIdentity.runtime.node, process.versions.node);
    assert.equal(sample.servingIdentity.instrumentation, 'none');
    assert.equal(sample.coldStart.firstRequest.result.requests.total, 1);
    assert.equal(sample.result.requests.total, 3);
  } finally {
    setup.journal.finish();
    await rm(setup.directory, { recursive: true, force: true });
  }
});

for (const defect of ['missing', 'nonce', 'pid', 'runtime', 'build', 'instrumented', 'endpoint'] as const) {
  test(`authenticateTimingIdentity: real HTTP with ${defect} identity -> rejects the subject`, { timeout: 20_000 }, async () => {
    // Given
    const setup = await condition();
    const prepared = await prepareTimingIdentity(setup.target);
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') throw new Error('Unexpected unsupported Node identity');
    let stdout = '';
    const target = defect === 'instrumented'
      ? { ...setup.target, args: ['--inspect=127.0.0.1:0', ...setup.target.args] } : setup.target;
    const children = startTargets('read-search-local', [target], {
      timingIdentity: defect !== 'missing', quiet: true,
      env: { ...prepared.env, BENCH_TIMING_NONCE: prepared.nonce },
      onOutput: (_target, stream, bytes) => { if (stream === 'stdout') stdout += String(bytes); },
    });
    try {
      await waitForTarget(children[0]);
      const response = await fetch(`http://127.0.0.1:${target.port}`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(await response.text(), '{"ok":true}');
      const pid = children[0].pid;
      assert.ok(pid);
      if (defect !== 'missing' && defect !== 'instrumented') {
        const line = stdout.split('\n').find((line) => line.startsWith('BENCH_TIMING_IDENTITY '));
        assert.ok(line);
        const identity = JSON.parse(line.slice('BENCH_TIMING_IDENTITY '.length));
        if (defect === 'nonce') identity.nonce = 'other-launch';
        if (defect === 'pid') identity.pid = process.pid;
        if (defect === 'runtime') identity.runtime = { host: 'collector' };
        if (defect === 'build') identity.artifactsSha256 = '0'.repeat(64);
        stdout = `BENCH_TIMING_IDENTITY ${JSON.stringify(identity)}\n`;
      }

      // When / Then
      await assert.rejects(authenticateTimingIdentity(prepared, stdout, pid, target.port, defect === 'endpoint' ? '192.0.2.1' : '127.0.0.1'), TimingIdentityFailure);
    } finally {
      await stopTargets(children);
      setup.journal.finish();
      await rm(setup.directory, { recursive: true, force: true });
    }
  });
}

test('runScenario: failed measurement after successful HTTP warmup -> retains the warmup in invalid evidence', { timeout: 20_000 }, async () => {
  // Given
  const setup = await condition();
  const target = { ...setup.target, args: [...setup.target.args, 'fail-measurement'] };
  try {
    // When
    await assert.rejects(runScenario({
      name: 'timing-fixture', description: 'finite HTTP fixture', appShape: 'read-search-local',
      requests: [{ path: '/', method: 'GET', expectedStatus: 200, expectedBody: '{"ok":true}' }],
    }, { index: 0, repeat: 0, targets: [target], connections: 1, samples: setup.samples, journal: setup.journal, amount: 3 }));
    setup.journal.finish();

    // Then
    const evidence = JSON.parse(await readFile(setup.path, 'utf8'));
    assert.equal(evidence.samples.length, 0);
    assert.equal(evidence.invalidAttempts.length, 1);
    assert.equal(evidence.invalidAttempts[0].condition.warmup.result.requests.total, 3);
    assert.equal(evidence.invalidAttempts[0].condition.firstRequest.result.requests.total, 1);
    assert.equal(evidence.invalidAttempts[0].condition.servingIdentity.status, 'authenticated');
    assert.ok(evidence.invalidAttempts[0].error.cause.traffic.result.non2xx > 0);
  } finally {
    setup.journal.finish();
    await rm(setup.directory, { recursive: true, force: true });
  }
});
