import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runComparison } from '../../../../tooling/governance/fixtures/create-lane-generated-conflicts/measure.mjs';
import { readRetroEvents, recordCiSnapshot } from '../../retrospective-lane/scripts/retro.mjs';
import { coordinateGeneratedIntegration, summarizeIntegrationMeasurements, validateGeneratedIntegration, validateStageMeasurements } from './generated-integration.mjs';
import { summarizeTransitions } from './lane-v4.mjs';
import * as integration from './generated-integration.mjs';
import { createPreflight, evaluatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { buildReviewFact } from '../../review-head/scripts/contracts.mjs';

const overlapRow = (issue, files = ['README.md'], action = 'review', patch = {}) => {
  const preflight = createPreflight({ issue, issue_sha256: 'b'.repeat(64), base_sha: 'c'.repeat(40),
    scope: ['README.md', 'docs/', 'src/', 'package.json', 'pnpm-lock.yaml', 'CONTEXT.md'],
    non_scope: [], acceptance: ['Preserve behavior'], validation: ['node --test'], predicted_files: files });
  return { issue, decision: { action, head }, obs: { issueSha256: preflight.issue_sha256,
    baseSha: preflight.base_sha, changedFiles: [], preflight, issueState: 'OPEN', branch: `issue-${issue}`,
    worktree: `worktree-${issue}`, headSha: head, hasNewCommits: true, pr: null, ...patch } };
};
const coordinate = (rows, lane = { preflight_overlap: 1 }) => {
  assert.equal(typeof integration.coordinatePreflightOverlap, 'function', 'production overlap coordinator is required');
  return integration.coordinatePreflightOverlap(lane, rows);
};

test('preflight overlap measurement: identical source and gates -> per-issue distinct review heads and CI runs', async () => {
  const path = new URL('../../../../tooling/governance/fixtures/preflight-overlap/measure.mjs', import.meta.url);
  assert.equal(existsSync(path), true, 'comparison fixture must be executable');
  const { runComparison: compare } = await import(path);

  const report = compare();
  assert.equal(report.comparable, true);
  assert.equal(report.before.initialStateSha256, report.after.initialStateSha256);
  assert.equal(report.before.finalSourceSha256, report.after.finalSourceSha256);
  assert.deepEqual(report.before.finalGateCoverage, report.after.finalGateCoverage);
  assert.deepEqual(Object.values(report.before.perIssue).map(row => [row.reviewedHeadCount, row.ciRunCount]),
    [[1, 1], [2, 2], [1, 1]]);
  assert.deepEqual(Object.values(report.after.perIssue).map(row => [row.reviewedHeadCount, row.ciRunCount]),
    [[1, 1], [1, 1], [1, 1]]);
  assert.equal(report.clock, 'simulation');
  assert.equal(report.duration, null);
  assert.equal(report.verdict, 'INCONCLUSIVE');
  assert.equal(report.after.trace.some(event => event.decision.action === 'wait-preflight-overlap'), true);
  assert.equal(report.before.trace.some(event => event.decision.action === 'resolve-conflict'), true);
  assert.equal(report.after.trace.some(event => event.decision.reason === 'preflight-overlap-base-integration'), true);
});

test('preflight overlap: legacy generated all-pairs and disjoint predictions -> exact old decisions', () => {
  const rows = Array.from({ length: 10 }, (_, i) => overlapRow(4030 + i, ['src/generated.ts']));

  assert.deepEqual(coordinate(rows, {}), rows);
  const disjoint = [overlapRow(42, ['docs/a.md']), overlapRow(43, ['docs/b.md'])];
  assert.deepEqual(coordinate(disjoint), disjoint);
});

test('preflight overlap: full overlap and every permutation -> one selected review without cyclic waits', () => {
  const rows = [overlapRow(42), overlapRow(43), overlapRow(44)];

  for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1], [1, 2, 0], [2, 0, 1]]) {
    const result = coordinate(order.map(i => rows[i])).sort((a, b) => a.issue - b.issue);
    assert.deepEqual(result.map(r => r.decision.action), ['review', 'wait-preflight-overlap', 'wait-preflight-overlap']);
    assert.deepEqual(result[1].decision.siblings.map(r => r.issue), [42]);
    assert.deepEqual(result[2].decision.siblings.map(r => r.issue), [42]);
    assert.deepEqual(result[0].decision.overlaps, [43, 44].map(issue => ({
      issue, head, pr: null, files: ['README.md'], state: 'review',
    })));
  }
  assert.deepEqual(rows.map(r => r.decision.action), ['review', 'review', 'review']);
});

test('preflight overlap: A-B B-C chain -> greedy independent set follows OPEN PR then valid PASS priority', () => {
  const rows = [overlapRow(42, ['docs/a.md']), overlapRow(43, ['docs/a.md', 'docs/c.md']), overlapRow(44, ['docs/c.md'])];

  assert.deepEqual(coordinate(rows).map(r => r.decision.action), ['review', 'wait-preflight-overlap', 'review']);
  rows[1].obs.pr = { state: 'OPEN', number: 143, headSha: head };
  assert.deepEqual(coordinate(rows).map(r => r.decision.action), ['wait-preflight-overlap', 'review', 'wait-preflight-overlap']);
  rows[1].obs.pr = null;
  const policy = evaluatePreflight(rows[1].obs.preflight, { ...rows[1].obs, issue: 43 }).policy;
  rows[1].obs.review = buildReviewFact({ head_sha: head, preflight_sha256: policy.sha256,
    active_axes: policy.active_axes, reviews: policy.active_axes.map(reviewer => ({
      reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: head,
      preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [],
    })) }, head, policy);
  rows[1].decision.action = 'create-pr';
  assert.deepEqual(coordinate(rows).map(r => r.decision.action), ['wait-preflight-overlap', 'create-pr', 'wait-preflight-overlap']);
  rows[1].obs.review.head = 'f'.repeat(40);
  assert.equal(coordinate(rows)[0].decision.action, 'review');
});

test('preflight overlap: explicit files of every kind -> sorted metadata, scope prefixes alone never overlap', () => {
  const files = ['src/generated.ts', 'pnpm-lock.yaml', 'package.json', 'README.md', 'CONTEXT.md'];
  const result = coordinate([overlapRow(42, files), overlapRow(43, [...files].reverse())]);

  assert.deepEqual(result[1].decision.files, [...files].sort());
  for (const patch of [{ baseSha: 'f'.repeat(40) }, { issueSha256: 'f'.repeat(64) }, { changedFiles: ['outside.ts'] }, { preflight: null }]) {
    const rows = [overlapRow(42), overlapRow(43, ['README.md'], 'review', patch)];
    assert.deepEqual(coordinate(rows), rows);
  }
});

test('preflight overlap: all non-review actions -> never replaced with the new wait', () => {
  for (const action of ['preflight', 'implement', 'fix-back', 'create-pr', 'push', 'wait-ci', 'wait-mergeability',
    'request-merge-approval', 'merge', 'cleanup', 'done', 'blocked', 'observation-failed', 'wait-dependencies', 'resolve-conflict']) {
    assert.equal(coordinate([overlapRow(42), overlapRow(43, ['README.md'], action)])[1].decision.action, action);
  }
  for (const [action, patch] of [['blocked', {}], ['done', {}], ['cleanup', {}],
    ['review', { issueState: 'CLOSED' }], ['review', { pr: { state: 'CLOSED', number: 143 } }]]) {
    assert.equal(coordinate([overlapRow(42, ['README.md'], action, patch), overlapRow(43)])[1].decision.action, 'review');
  }
});

test('preflight overlap: relevant sibling observation failure -> fail closed only on affected reviews', () => {
  const failure = { source: 'pr', subject: 'issue-42', code: 'command-failed' };
  const rows = [overlapRow(42, ['README.md'], 'observation-failed', { observationFailures: [failure] }), overlapRow(43)];

  assert.equal(coordinate(rows)[1].decision.action, 'observation-failed');
  assert.deepEqual(coordinate(rows)[1].decision.failures, [failure]);
  assert.equal(coordinate([rows[0], overlapRow(43, ['src/other.ts'])])[1].decision.action, 'review');
});

test('preflight overlap: failed issue observation loses current digest -> relevant accepted prediction still fails closed', () => {
  const failure = { source: 'issue', subject: 42, code: 'command-failed' };
  const rows = [overlapRow(42, ['README.md'], 'observation-failed',
    { issueSha256: null, observationFailures: [failure] }), overlapRow(43)];

  assert.equal(coordinate(rows)[1].decision.action, 'observation-failed');
  assert.deepEqual(coordinate(rows)[1].decision.failures, [failure]);
});

test('preflight overlap: merged sibling -> base integration only without occupants and verified ancestry', () => {
  const merged = overlapRow(42, ['README.md'], 'cleanup', { pr: { state: 'MERGED', number: 142, mergeCommit: 'd'.repeat(40) } });
  const reviewing = overlapRow(43);
  const evidence = { issue: 42, commit: 'd'.repeat(40), base: 'e'.repeat(40), inBase: true, inHead: false };
  reviewing.obs.overlapIntegrations = [evidence];

  const decision = coordinate([merged, reviewing])[1].decision;
  assert.equal(decision.action, 'resolve-conflict');
  assert.equal(decision.reason, 'preflight-overlap-base-integration');
  assert.equal(decision.base, evidence.base);
  assert.deepEqual(decision.siblings.map(s => s.commit), [evidence.commit]);
  assert.equal(Object.hasOwn(decision, 'pr'), false);
  reviewing.obs.overlapIntegrations[0].inHead = true;
  assert.equal(coordinate([merged, reviewing])[1].decision.action, 'review');
  reviewing.obs.overlapIntegrations[0].inBase = false;
  assert.equal(coordinate([merged, reviewing])[1].decision.action, 'observation-failed');
});

const digest = (text) => createHash('sha256').update(text).digest('hex');
const head = 'a'.repeat(40);
const hint = { surface: 'src/generated.ts', issues: [42, 43], generated: { command: `${process.execPath} --version` } };
const row = (issue, action, patch = {}) => ({ issue, decision: { action },
  obs: { headSha: head, pr: { number: issue, state: 'OPEN', headSha: head, mergeable: 'CONFLICTING' }, ...patch } });

test('coordination: plain or unrelated hints -> no serialization', () => {
  const rows = [row(42, 'resolve-conflict'), row(43, 'merge')];
  assert.deepEqual(coordinateGeneratedIntegration({ predicted_conflicts: [] }, rows), rows);
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
