import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReviewAxes, createPreflight, evaluatePreflight, validatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { buildReviewFact } from '../../review-head/scripts/contracts.mjs';
import { applyChildResult, decideNext, localCheckBinding } from './lane-v4.mjs';

const all = ['contract', 'code', 'verification'];
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const input = (overrides = {}) => ({
  issue: 42, issue_sha256: 'c'.repeat(64), base_sha: base,
  scope: ['docs/', 'src/', 'tests/', '.agents/'], non_scope: ['docs/private/'],
  acceptance: ['Keep public behavior'], validation: ['node --test'],
  predicted_files: ['docs/guide.md'], ...overrides,
});
const lane = { issue: 42, approvals: { merge: true } };
const observation = (overrides = {}) => ({
  issue: 42, issueState: 'OPEN', issueSha256: 'c'.repeat(64), baseSha: base,
  headSha: head, changedFiles: ['docs/guide.md'], branch: 'issue-42', worktree: '/tmp/issue-42',
  hasNewCommits: true, preflight: createPreflight(input()), localChecks: null, review: null,
  reviewAcceptedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const reviewed = (obs, signal = 'PASS') => {
  const { policy } = evaluatePreflight(obs.preflight, obs);
  return buildReviewFact({
    head_sha: obs.headSha, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
    reviews: policy.active_axes.map((reviewer) => ({
      reviewer, reviewed_head_sha: obs.headSha, preflight_sha256: policy.sha256,
      verdict_signal: signal, blockers: [],
    })),
  }, obs.headSha, policy);
};
const passedCheck = (sha = head) => ({
  ...localCheckBinding(reviewed(observation({ headSha: sha })), observation().reviewAcceptedAt),
  receiptStartedAt: '2026-01-01T00:00:01.000Z', head: sha, status: 'passed', valid: true,
  receiptPath: '.omo/verification/pass.json', receiptSha256: 'd'.repeat(64),
});

for (const [name, files, axes] of [
  ['docs', ['docs/guide.md', 'README.ko.md'], ['contract']],
  ['test', ['packages/http/src/a.test.ts', 'tests/fixture.json'], ['code', 'verification']],
  ['fixture', ['packages/http/test-fixtures/input.json'], ['code', 'verification']],
  ['mixed', ['docs/guide.md', 'src/a.test.ts'], all],
  ['runtime', ['src/a.ts'], all],
  ['unknown', ['data.bin'], all],
  ['empty', [], all],
  ['governance test', ['tooling/governance/a.test.ts'], all],
  ['contract prose', ['docs/contracts/runtime.md'], ['contract']],
  ['governance doc', ['docs/contracts/release-governance.md'], all],
  ['fixture markdown', ['tests/fixtures/README.md'], ['code', 'verification']],
  ['localized instruction', ['packages/http/CONTEXT.ko.md'], all],
  ['claude instruction', ['CLAUDE.md'], all],
  ['copilot instruction', ['.github/copilot-instructions.md'], all],
  ['standalone copilot instruction', ['copilot-instructions.md'], all],
  ['scoped instruction', ['docs/guide.instructions.md'], all],
  ['MDX executable document', ['docs/guide.mdx'], all],
  ['executable doc example', ['docs/examples/app.test.ts'], all],
  ['skill instruction', ['.agents/skills/review-head/SKILL.md'], all],
  ['agent instruction', ['packages/http/AGENTS.md'], all],
]) {
  test(`classification: ${name}`, () => assert.deepEqual(classifyReviewAxes(files), axes));
}

test('preflight includes exact omitted axes with nonempty reasons', () => {
  const value = createPreflight(input());
  assert.deepEqual(value.active_axes, ['contract']);
  assert.deepEqual(Object.keys(value.omitted_axes), ['code', 'verification']);
  for (const omitted_axes of [{}, { code: '', verification: 'no files' }, { code: 'none', verification: 'none', contract: 'none' }]) {
    assert.throws(() => createPreflight(input({ omitted_axes })));
  }
  for (const patch of [{ acceptance: [] }, { validation: [] }, { scope: ['../'] }, { active_axes: ['code'] }, { predicted_files: ['docs/private/secret.md'] }]) {
    assert.throws(() => createPreflight(input(patch)));
  }
  assert.throws(() => validatePreflight({ ...value, acceptance: ['different'] }));
});

test('mandatory preflight retries use existing attempt ceiling', () => {
  assert.equal(decideNext(lane, observation({ preflight: null, branch: null })).action, 'preflight');
  const failed = applyChildResult(lane, 'preflight', { ok: false });
  assert.equal(failed.attempts.preflight, 1);
  assert.equal(decideNext(failed, observation({ preflight: null })).action, 'preflight');
});

test('head movement preserves preflight, issue/base changes invalidate it', () => {
  const obs = observation();
  const policy = evaluatePreflight(obs.preflight, obs).policy;
  assert.deepEqual(evaluatePreflight(obs.preflight, { ...obs, headSha: 'e'.repeat(40) }).policy, policy);
  for (const patch of [{ issue: 43 }, { issueSha256: 'e'.repeat(64) }, { baseSha: 'e'.repeat(40) }]) {
    assert.equal(evaluatePreflight(obs.preflight, { ...obs, ...patch }).reason, 'stale-preflight-binding');
  }
  assert.equal(decideNext(lane, { ...obs, changedFiles: null }).action, 'preflight');
});

test('actual diff expands predicted policy without shrinking approved axes', () => {
  const obs = observation();
  const docs = evaluatePreflight(obs.preflight, obs).policy;
  const expanded = evaluatePreflight(obs.preflight, { ...obs, changedFiles: ['src/a.ts'] }).policy;
  assert.deepEqual(expanded.active_axes, all);
  assert.deepEqual(expanded.omitted_axes, {});
  assert.notEqual(expanded.sha256, docs.sha256);
  const full = createPreflight(input({ predicted_files: ['src/a.ts'] }));
  assert.deepEqual(evaluatePreflight(full, obs).policy.active_axes, all);
});

test('outside scope, excluded paths and sibling prefixes return preflight', () => {
  for (const file of ['other.ts', 'docs/private/secret.md', 'docs-other/guide.md']) {
    const decision = decideNext(lane, observation({ changedFiles: [file] }));
    assert.equal(decision.action, 'preflight');
    assert.equal(decision.reason, 'scope-expansion');
    assert.deepEqual(decision.files, [file]);
  }
});

test('contract revision invalidates review at unchanged head', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  assert.equal(decideNext(lane, obs).action, 'verify-local');
  obs.preflight = createPreflight(input({ acceptance: ['Add a second acceptance condition'] }));
  assert.equal(decideNext(lane, obs).action, 'review');
});

test('expanded actual axes invalidate earlier policy even on unchanged head', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  obs.changedFiles = ['src/a.ts'];
  const decision = decideNext(lane, obs);
  assert.equal(decision.action, 'review');
  assert.deepEqual(decision.policy.active_axes, all);
});

test('review precedes canonical local CI, including local-failure fix-back cycle', () => {
  const obs = observation({ hasNewCommits: false });
  assert.equal(decideNext(lane, obs).action, 'implement');
  obs.hasNewCommits = true;
  assert.equal(decideNext(lane, obs).action, 'review');
  obs.review = reviewed(obs);
  assert.equal(decideNext(lane, obs).action, 'verify-local');
  obs.localChecks = { ...passedCheck(), status: 'failed' };
  assert.equal(decideNext(lane, obs).reason, 'local-checks-failed');
  obs.headSha = 'e'.repeat(40);
  assert.equal(decideNext(lane, obs).action, 'review');
  obs.review = reviewed(obs);
  assert.equal(decideNext(lane, obs).action, 'verify-local');
  obs.localChecks = passedCheck(obs.headSha);
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  obs.pr = { number: 42, state: 'OPEN', headSha: head, ciStatus: 'passing', mergeable: 'MERGEABLE' };
  assert.equal(decideNext(lane, obs).action, 'push');
  obs.pr.headSha = obs.headSha;
  obs.pr.ciStatus = 'pending';
  assert.equal(decideNext(lane, obs).action, 'wait-ci');
  obs.pr.ciStatus = 'failing';
  assert.equal(decideNext(lane, obs).reason, 'ci-failing');
  obs.pr.ciStatus = 'passing';
  assert.equal(decideNext(lane, obs).action, 'merge');
});

test('same-head local receipts without review/policy binding cannot advance', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  obs.localChecks = passedCheck();
  delete obs.localChecks.reviewSha256;
  assert.equal(decideNext(lane, obs).action, 'verify-local');
});

test('earlier receipt and changed review acceptance cannot advance on the same head', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  obs.localChecks = passedCheck();
  obs.localChecks.receiptStartedAt = '2025-12-31T23:59:59.000Z';
  assert.equal(decideNext(lane, obs).action, 'verify-local');
  obs.localChecks = passedCheck();
  obs.reviewAcceptedAt = '2026-01-01T00:00:00.500Z';
  assert.equal(decideNext(lane, obs).action, 'verify-local');
  obs.preflight = null;
  obs.localChecks.status = 'failed';
  assert.equal(decideNext(lane, obs).action, 'preflight');
});

test('changeset gate precedes review and local CI', () => {
  const obs = observation({ publicPackagesTouched: true, changesetPresent: false });
  assert.equal(decideNext(lane, obs).reason, 'changeset-missing');
  obs.changesetPresent = true;
  assert.equal(decideNext(lane, obs).action, 'review');
});

test('stale human-check/block and arbitrary pass/merge cannot park or advance the new head', () => {
  for (const verdict of ['merge', 'pass', 'block', 'needs-human-check', 'anything']) {
    assert.equal(decideNext(lane, observation({ review: { head, verdict }, localChecks: passedCheck() })).action, 'review');
  }
  const obs = observation();
  obs.review = reviewed(obs, 'NEEDS-HUMAN-CHECK');
  assert.equal(decideNext(lane, obs).action, 'blocked');
  obs.headSha = 'e'.repeat(40);
  assert.equal(decideNext(lane, obs).action, 'review');
});

test('engine revalidates missing, duplicate, malformed and forged reviewer evidence', () => {
  const obs = observation();
  const valid = reviewed(obs);
  for (const review of [
    { ...valid, reviews: [] },
    { ...valid, reviews: [...valid.reviews, ...valid.reviews] },
    { ...valid, reviews: [{ ...valid.reviews[0], verdict_signal: 'merge' }] },
    { ...valid, verdict: 'merge' },
    { ...valid, blockers: [{ signature: 'forged' }] },
    { ...valid, preflight_sha256: 'f'.repeat(64) },
  ]) assert.equal(decideNext(lane, { ...obs, review }).action, 'review');
});

test('merged/closed external issues converge without requiring obsolete preflight', () => {
  assert.equal(decideNext(lane, observation({ preflight: null, pr: { state: 'MERGED', number: 42 } })).action, 'cleanup');
  assert.equal(decideNext(lane, observation({ preflight: null, issueState: 'CLOSED' })).action, 'done');
});
