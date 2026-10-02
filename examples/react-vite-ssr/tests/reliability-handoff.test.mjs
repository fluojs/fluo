import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeHandoff } from './reliability-handoff.mjs';

function completeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-reliability-handoff-'));
  t.after(() => rmSync(root, { recursive: true }));
  const head = 'a'.repeat(40);
  const seed = 3886;
  // Synthetic parser fixtures are not executed browser or physical-device evidence.
  const events = [
    { seed, index: 0, phase: 'start', detail: { head, engine: 'chromium' } },
    ...['network', 'server-error', 'slow', 'payload', 'import', 'render', 'deploy']
      .map((fault) => ({ seed, index: 0, phase: 'fault-schedule', detail: { fault } })),
    ...Array.from({ length: 1070 }, (_, index) => ({ seed, index: index + 1, phase: 'action-settled' })),
    { seed, index: 1070, phase: 'measurement', detail: { warmup: false } },
    { seed, index: 1070, phase: 'workload-complete', detail: { index: 1070, elapsedMs: 1000 } },
  ];
  const runs = ['chromium', 'firefox', 'webkit', 'soak'];
  for (const name of runs) {
    mkdirSync(join(root, name));
    const engine = name === 'soak' ? 'chromium' : name;
    const elapsedMs = name === 'soak' ? 7_200_000 : 1000;
    const runEvents = events.map((event) => event.phase === 'start'
      ? { ...event, detail: { ...event.detail, engine } }
      : event.phase === 'workload-complete'
        ? { ...event, detail: { ...event.detail, elapsedMs } } : event);
    writeFileSync(join(root, name, 'events.jsonl'), `${runEvents.map((event) => JSON.stringify(event)).join('\n')}\n`);
    writeFileSync(join(root, name, 'receipt.json'), JSON.stringify({
      version: 1, issue: 3886, head, seed, engine: name === 'soak' ? 'chromium' : name,
      kind: name === 'soak' ? 'soak' : 'correctness',
      surface: 'official-example-production', actionCount: 1070, measuredActionCount: 1000,
      elapsedMs,
      status: 'passed', firstFailure: null, eventTrace: 'events.jsonl',
    }));
  }
  writeFileSync(join(root, 'synthetic-artifact.log'), 'synthetic unit fixture\n');
  const companionEvidence = [
    'build', 'source-tests', 'http', 'ownership', 'cache', 'native', 'packaged-dev',
    'packaged-production', 'docs', 'ci-plan', 'contract-review', 'code-review',
    'verification-review', 'remote-ci',
  ].map((kind) => {
    const receipt = `${kind}.json`;
    writeFileSync(join(root, receipt), JSON.stringify({ head, status: 'passed', artifact: 'synthetic-artifact.log' }));
    return { kind, head, status: 'passed', receipt };
  });
  const value = {
    version: 1, head, correctnessReceipts: runs.slice(0, 3).map((name) => `${name}/receipt.json`),
    soakReceipt: 'soak/receipt.json', companionEvidence,
    physicalDevices: ['mobile', 'tablet'].map((kind) => ({
      kind, physical: true, head, result: 'passed', model: 'synthetic fixture', os: 'fixture',
      browser: 'fixture', version: 'fixture', operator: 'unit-test',
      scenarios: ['navigation', 'search', 'row', 'history', 'fault-recovery', 'auth', 'reload', 'resource-ack'],
      artifact: 'synthetic-artifact.log',
    })),
  };
  return { root, value, events };
}

test('consumes a complete same-head parser fixture and authenticates its trace', async (t) => {
  // Given: complete synthetic files with all machine-required evidence categories.
  const { root, value } = completeFixture(t);
  // When: the real filesystem consumer reads the complete handoff.
  const result = await consumeHandoff(value, root);
  // Then: it binds the consumer and each authenticated trace to the supplied head.
  assert.equal(result.status, 'evidence-complete');
  assert.equal(result.consumer, 3879);
  assert.equal(result.head, value.head);
  assert.equal(result.correctness.length, 3);
  assert.match(result.soak.traceSha256, /^[a-f0-9]{64}$/u);
});

const rejectedFixtures = [
  ['duplicate correctness engine', (fixture) => { fixture.value.correctnessReceipts[2] = 'chromium/receipt.json'; },
    /Duplicate or missing correctness engines/u],
  ['different run head', (fixture) => changeRun(fixture, 'chromium', { head: 'b'.repeat(40) }), /Wrong run identity/u],
  ['failed run', (fixture) => changeRun(fixture, 'chromium', { status: 'failed' }), /Run failed or incomplete/u],
  ['warmup-only workload', (fixture) => changeRun(fixture, 'chromium', { measuredActionCount: 999 }),
    /Warmup cannot substitute/u],
  ['short soak', (fixture) => {
    changeRun(fixture, 'soak', { elapsedMs: 7_199_999 });
    changeTrace(fixture, fixture.events.map((event) => event.phase === 'workload-complete'
      ? { ...event, detail: { ...event.detail, elapsedMs: 7_199_999 } } : event), 'soak');
  }, /Separate two hour soak/u],
  ['packaged run replacing official correctness', (fixture) => changeRun(fixture, 'chromium', { surface: 'packaged-dev' }),
    /Duplicate or missing correctness engines/u],
  ['truncated trace', (fixture) => changeTrace(fixture, fixture.events.slice(0, -1)), /Truncated or inconsistent trace/u],
  ['missing fault schedule', (fixture) => changeTrace(fixture, fixture.events.filter((event) => event.detail?.fault !== 'deploy')),
    /Incomplete fault coverage/u],
  ['trace seed mismatch', (fixture) => changeTrace(fixture, [{ ...fixture.events[0], seed: 1 }, ...fixture.events.slice(1)]),
    /Trace seed\/index mismatch/u],
  ['page error in passed trace', (fixture) => changeTrace(fixture, [
    { seed: 3886, index: 0, phase: 'pageerror' }, ...fixture.events,
  ]), /Failure in supposedly passed trace/u],
  ['missing companion', (fixture) => { fixture.value.companionEvidence.pop(); }, /Unverified companion: remote-ci/u],
  ['unbound companion', (fixture) => {
    writeFileSync(join(fixture.root, 'build.json'), JSON.stringify({ head: 'b'.repeat(40), status: 'passed', artifact: 'synthetic-artifact.log' }));
  }, /Unbound companion: build/u],
  ['emulated mobile', (fixture) => { fixture.value.physicalDevices[0].physical = false; }, /Unverified physical mobile/u],
  ['missing tablet recovery scenario', (fixture) => { fixture.value.physicalDevices[1].scenarios.pop(); },
    /Unverified physical tablet/u],
  ['empty raw artifact', (fixture) => { writeFileSync(join(fixture.root, 'synthetic-artifact.log'), ''); },
    /Missing or empty artifact/u],
  ['missing trace start', (fixture) => changeTrace(fixture, fixture.events.slice(1)),
    /Missing or duplicate trace start/u],
  ['duplicate trace start', (fixture) => changeTrace(fixture, [fixture.events[0], ...fixture.events]),
    /Missing or duplicate trace start/u],
  ['different trace head', (fixture) => changeTrace(fixture, [
    { ...fixture.events[0], detail: { ...fixture.events[0].detail, head: 'b'.repeat(40) } }, ...fixture.events.slice(1),
  ]), /Wrong trace head/u],
  ['different trace engine', (fixture) => changeTrace(fixture, [
    { ...fixture.events[0], detail: { ...fixture.events[0].detail, engine: 'firefox' } }, ...fixture.events.slice(1),
  ]), /Wrong trace engine/u],
  ['missing trace workload duration', (fixture) => changeTrace(fixture, fixture.events.map((event) =>
    event.phase === 'workload-complete' ? { ...event, detail: { index: 1070 } } : event)),
    /Missing trace workload duration/u],
  ['short trace with long soak receipt', (fixture) => changeTrace(fixture, fixture.events, 'soak'),
    /Trace\/receipt duration mismatch/u],
  ['different trace elapsed duration', (fixture) => changeTrace(fixture, fixture.events.map((event) =>
    event.phase === 'workload-complete' ? { ...event, detail: { ...event.detail, elapsedMs: 2000 } } : event)),
    /Trace\/receipt duration mismatch/u],
];

function changeRun(fixture, name, fields) {
  const path = join(fixture.root, name, 'receipt.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...fields }));
}

function changeTrace(fixture, events, name = 'chromium') {
  writeFileSync(join(fixture.root, name, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

for (const [name, invalidate, expected] of rejectedFixtures) {
  test(`rejects ${name} instead of closing the product gate`, async (t) => {
    // Given: one invalid machine field or raw artifact in an otherwise complete fixture.
    const fixture = completeFixture(t);
    invalidate(fixture);
    // When / Then: the real consumer rejects that defect with its owning diagnostic.
    await assert.rejects(consumeHandoff(fixture.value, fixture.root), expected);
  });
}

test('retains the approved physical deferral without claiming complete device evidence', async (t) => {
  const { root, value } = completeFixture(t);
  value.physicalDevices = [];
  value.physicalDeferral = { issue: 'https://github.com/fluojs/fluo/issues/3906', status: 'deferred' };
  const result = await consumeHandoff(value, root);
  assert.equal(result.status, 'automated-evidence-complete');
  assert.deepEqual(result.physicalDevices, []);
  assert.deepEqual(result.physicalDeferral, value.physicalDeferral);
});

test('rejects an unapproved physical deferral target', async (t) => {
  const { root, value } = completeFixture(t);
  value.physicalDevices = [];
  value.physicalDeferral = { issue: 'https://github.com/fluojs/fluo/issues/1', status: 'deferred' };
  await assert.rejects(consumeHandoff(value, root), /Invalid physical deferral/u);
});

test('accepts one actual hour only for the approved lane profile', async (t) => {
  const { root, value, events } = completeFixture(t);
  value.soakProfile = 'lane-3886-one-hour';
  changeRun({ root }, 'soak', { elapsedMs: 3_600_000 });
  changeTrace({ root }, events.map((event) => event.phase === 'workload-complete'
    ? { ...event, detail: { ...event.detail, elapsedMs: 3_600_000 } } : event), 'soak');
  const result = await consumeHandoff(value, root);
  assert.equal(result.soakProfile, 'lane-3886-one-hour');
  assert.equal(result.soak.elapsedMs, 3_600_000);
  delete value.soakProfile;
  await assert.rejects(consumeHandoff(value, root), /Separate two hour soak/u);
});

test('rejects absent engine receipts before any device can be called complete', async (t) => {
  // Given: an isolated output root with no executed browser evidence.
  const root = mkdtempSync(join(tmpdir(), 'fluo-reliability-handoff-'));
  t.after(() => rmSync(root, { recursive: true }));
  // When: a caller tries to consume an incomplete exact-head handoff.
  // Then: machine-consumed missing coverage fails instead of producing evidence-complete.
  await assert.rejects(consumeHandoff({ version: 1, head: 'a'.repeat(40),
    correctnessReceipts: [], physicalDevices: [{ kind: 'mobile', physical: false }] }, root), /three correctness engines/u);
});
