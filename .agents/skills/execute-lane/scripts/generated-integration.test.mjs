import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runComparison } from '../../../../tooling/governance/fixtures/create-lane-generated-conflicts/measure.mjs';
import { readRetroEvents, recordCiSnapshot } from '../../retrospective-lane/scripts/retro.mjs';
import { coordinateGeneratedIntegration, summarizeIntegrationMeasurements, validateGeneratedIntegration, validateStageMeasurements } from './generated-integration.mjs';
import { summarizeTransitions } from './lane-v4.mjs';

const digest = (text) => createHash('sha256').update(text).digest('hex');
const head = 'a'.repeat(40);
const hint = { surface: 'src/generated.ts', issues: [42, 43], generated: { command: `${process.execPath} --version` } };
const row = (issue, action, patch = {}) => ({ issue, decision: { action },
  obs: { headSha: head, pr: { number: issue, state: 'OPEN', headSha: head, mergeable: 'CONFLICTING' }, ...patch } });

test('coordination: plain or unrelated hints -> no serialization', () => {
  const rows = [row(42, 'resolve-conflict'), row(43, 'merge')];
  assert.deepEqual(coordinateGeneratedIntegration({ predicted_conflicts: [{ surface: hint.surface, issues: hint.issues }] }, rows), rows);
  assert.deepEqual(coordinateGeneratedIntegration({ predicted_conflicts: [{ ...hint, issues: [43, 44] }] }, rows), rows);
});

test('coordination: invalid target review on real conflicting head -> wait then integrate without old-head PASS reuse', () => {
  const rows = [row(42, 'review'), row(43, 'merge')];
  const lane = { predicted_conflicts: [hint] };
  assert.equal(coordinateGeneratedIntegration(lane, rows)[0].decision.action, 'wait-generated-integration');
  assert.equal(coordinateGeneratedIntegration(lane, [rows[0], row(43, 'review')])[0].decision.action, 'resolve-conflict');
  assert.equal(coordinateGeneratedIntegration(lane, [row(42, 'preflight'), rows[1]])[0].decision.action, 'preflight');
});

test('watch: unchanged wait action with changed ready sibling head -> observable coordination transition', () => {
  const previous = [{ issue: 42, decision: { action: 'wait-generated-integration', siblings: [{ issue: 43, head }] } }];
  const next = [{ issue: 42, decision: { action: 'wait-generated-integration', siblings: [{ issue: 44, head }] } }];
  assert.deepEqual(summarizeTransitions(previous, next).changes,
    [{ issue: 42, from: 'wait-generated-integration', to: 'wait-generated-integration', reason: 'coordination-targets-changed' }]);
});

const receiptFixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-generated-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, '.omo/generated-integration'), { recursive: true });
  const expected = `{"sourceFingerprint":"${'b'.repeat(64)}","whole":{"value":7}}\n`;
  const artifact = `{"sourceFingerprint":"${'c'.repeat(64)}","whole":{"value":7}}\n`;
  writeFileSync(join(root, '.omo/generated-integration/expected.ts'), expected);
  writeFileSync(join(root, 'src/generated.ts'), artifact);
  const log = 'Synthetic fixture gate evidence; not a real browser/CI verdict.\n';
  writeFileSync(join(root, '.omo/generated-integration/check.log'), log);
  const value = { head, outputs: [{ surface: hint.surface, expectedPath: '.omo/generated-integration/expected.ts',
    expectedSha256: digest(expected), artifactSha256: digest(artifact), command: hint.generated.command,
    exitCode: 0, normalizeSourceFingerprint: true }],
    checks: ['focused', 'browser'].map((kind) => ({ kind, head, command: `fixture ${kind}`,
      exitCode: 0, logPath: '.omo/generated-integration/check.log', logSha256: digest(log) })) };
  return { root, value, context: { head, hints: [hint], execute: true } };
};

test('generated receipt: normalized fingerprint and full byte equality -> current-head admission', (t) => {
  const f = receiptFixture(t);
  assert.equal(validateGeneratedIntegration(f.root, f.context, f.value), f.value);
  f.value.outputs[0].normalizeSourceFingerprint = false;
  assert.throws(() => validateGeneratedIntegration(f.root, f.context, f.value), /full byte equality/u);
});

test('generated receipt: non-fingerprint content difference -> rejected even with fresh digest', (t) => {
  const f = receiptFixture(t);
  const artifact = `{"sourceFingerprint":"${'c'.repeat(64)}","whole":{"value":8}}\n`;
  writeFileSync(join(f.root, 'src/generated.ts'), artifact);
  f.value.outputs[0].artifactSha256 = digest(artifact);
  assert.throws(() => validateGeneratedIntegration(f.root, f.context, f.value), /full byte equality/u);
});

test('generated receipt: missing browser, stale head, failed generation and tampered logs -> rejected', (t) => {
  const f = receiptFixture(t);
  const missing = structuredClone(f.value);
  missing.checks.pop();
  assert.throws(() => validateGeneratedIntegration(f.root, f.context, missing), /browser/u);
  assert.throws(() => validateGeneratedIntegration(f.root, { ...f.context, head: 'f'.repeat(40) }, f.value), /current-head/u);
  const failed = structuredClone(f.value);
  failed.outputs[0].exitCode = 1;
  assert.throws(() => validateGeneratedIntegration(f.root, f.context, failed), /authoritative/u);
  writeFileSync(join(f.root, '.omo/generated-integration/check.log'), 'tampered\n');
  assert.throws(() => validateGeneratedIntegration(f.root, f.context, f.value), /tampered/u);
});

test('measurement: recordedAt, simulation clock or missing duration -> no invented execution elapsed', () => {
  const measurement = { runId: 'stage-1', attempt: 1, stage: 'focused', head,
    clock: 'simulation', elapsedMs: null, scope: 'stage-execution' };
  const event = { issue: 42, kind: 'stage', eventId: 'fixture', recordedAt: '2026-01-01T00:00:00Z',
    data: { head, result: { measurements: [measurement] } } };
  const report = summarizeIntegrationMeasurements([event], { 42: head });
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.counts.focused, 1);
  assert.equal(report.totalElapsedMs, null);
  assert.throws(() => validateStageMeasurements([{ ...measurement, clock: 'recordedAt' }], head), /Invalid/u);
  assert.throws(() => validateStageMeasurements([{ ...measurement, elapsedMs: -1 }], head), /Invalid/u);
  assert.equal(summarizeIntegrationMeasurements([]).status, 'inconclusive');
  const invalidClock = { issue: 42, kind: 'observation', eventId: 'fake-clock',
    data: { processId: 'fixture', clock: 'recordedAt', monotonicMs: 10, head, action: 'wait-generated-integration' } };
  assert.equal(summarizeIntegrationMeasurements([invalidClock]).status, 'inconclusive');
});

test('measurement: unique execution identity and restarted waits -> counts deduplicate while missing duration remains unknown', () => {
  const measurement = { runId: 'stage-1', attempt: 1, stage: 'ci', head,
    clock: 'monotonic', elapsedMs: 7, scope: 'stage-execution' };
  const stage = { issue: 42, kind: 'stage', eventId: 'stage', data: { head, result: { measurements: [measurement] } } };
  const observations = [
    { issue: 42, kind: 'observation', eventId: 'wait', data: { processId: 'before-restart', clock: 'monotonic', head, action: 'wait-generated-integration', monotonicMs: 10 } },
    { issue: 42, kind: 'observation', eventId: 'release', data: { processId: 'after-restart', clock: 'monotonic', head, action: 'resolve-conflict', monotonicMs: 100 } },
    { issue: 42, kind: 'observation', eventId: 'dependency', data: { processId: 'dependency', clock: 'monotonic', head, action: 'wait-dependencies', monotonicMs: 2 } },
    { issue: 42, kind: 'observation', eventId: 'dependency-release', data: { processId: 'dependency', clock: 'monotonic', head, action: 'implement', monotonicMs: 5 } },
  ];
  const report = summarizeIntegrationMeasurements([stage, stage, ...observations], { 42: 'f'.repeat(40) });
  assert.equal(report.counts.ci, 1);
  assert.equal(report.supersededValidationHeads, 1);
  assert.equal(report.waits.coordination[0].elapsedMs, null);
  assert.equal(report.waits.dependency[0].elapsedMs, 3);
  assert.equal(report.status, 'inconclusive');
});

test('measurement: actual CI recorder run/attempt -> preserved scope and counts rather than recordedAt duration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-generated-ci-measure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = { id: 12, run_attempt: 2, head_sha: head, path: 'ci.yml', html_url: 'https://example.test/run/12',
    status: 'completed', conclusion: 'success', created_at: '2026-01-01T00:00:00Z', run_started_at: '2026-01-01T00:00:10Z' };
  recordCiSnapshot(root, 'fixture', 42, run, [{ run_id: 12, run_attempt: 2, id: 34,
    status: 'completed', conclusion: 'success', completed_at: '2026-01-01T00:00:15Z' }]);
  const events = readRetroEvents(root, 'fixture');
  const report = summarizeIntegrationMeasurements(events, { 42: head });
  assert.equal(report.counts.ci, 1);
  assert.equal(report.runs[0].measurement.elapsedMs, 5000);
  assert.equal(report.runs[0].measurement.scope, 'retry-attempt-excluding-queue');
  assert.equal(report.runs[0].measurement.clock, 'github-actions');
  assert.equal(report.totalElapsedMs, null);
});

test('BEFORE/AFTER: identical inputs/final source/gates -> fewer integrations with honest INCONCLUSIVE elapsed verdict', () => {
  const report = runComparison();
  assert.equal(report.comparable, true);
  assert.equal(report.before.report.counts.integration, 3);
  assert.equal(report.after.report.counts.integration, 1);
  assert.equal(report.before.report.supersededValidationHeads, 3);
  assert.equal(report.after.report.supersededValidationHeads, 1);
  for (const stage of ['focused', 'browser', 'review:contract', 'review:code', 'review:verification', 'ci']) {
    assert.equal(report.before.report.counts[stage], 4);
    assert.equal(report.after.report.counts[stage], 2);
  }
  assert.equal(report.before.finalSourceSha256, report.after.finalSourceSha256);
  assert.deepEqual(report.before.finalGateCoverage, report.after.finalGateCoverage);
  assert.equal(report.verdict, 'INCONCLUSIVE');
});
