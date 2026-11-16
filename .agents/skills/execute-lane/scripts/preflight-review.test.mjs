import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReviewAxes, contractDigest, createPreflight, evaluatePreflight, isRetentionProsePath, validatePreflight } from '../../issue-preflight/scripts/contracts.mjs';
import { buildReviewFact, validateReviewFact } from '../../review-head/scripts/contracts.mjs';
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
const ciObservation = (overrides = {}) => observation({
  changedFiles: ['.agents/skills/execute-lane/scripts/lane-v4.mjs'], ...overrides,
});
const reviewed = (obs, signal = 'PASS') => {
  const { policy } = evaluatePreflight(obs.preflight, obs);
  return buildReviewFact({
    head_sha: obs.headSha, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
    reviews: policy.active_axes.map((reviewer) => ({
      reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: obs.headSha, preflight_sha256: policy.sha256,
      verdict_signal: signal, blockers: [],
      evidence: [{ acceptance: 'Keep public behavior', locations: ['src/a.ts:1'] }], observations: [],
    })),
  }, obs.headSha, policy);
};
const passedCheck = (obs = observation()) => ({
  ...localCheckBinding(reviewed(obs), obs.reviewAcceptedAt),
  receiptStartedAt: '2026-01-01T00:00:01.000Z', head: obs.headSha, status: 'passed', valid: true,
  receiptPath: '.omo/verification/pass.json', receiptSha256: 'd'.repeat(64),
});

test('#4128 new review admission: unsubstantiated PASS -> rejected instead of accepted fact', () => {
  const obs = ciObservation();
  const { policy } = evaluatePreflight(obs.preflight, obs);
  const reviews = policy.active_axes.map((reviewer) => ({
    reviewer, agent: `fluo-${reviewer}-reviewer`, reviewed_head_sha: head,
    preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [],
    evidence: [], observations: [],
  }));

  assert.throws(() => buildReviewFact({ head_sha: head, preflight_sha256: policy.sha256,
    active_axes: policy.active_axes, reviews }, head, policy), TypeError);
  for (const review of reviews) { delete review.evidence; delete review.observations; }
  assert.throws(() => buildReviewFact({ head_sha: head, preflight_sha256: policy.sha256,
    active_axes: policy.active_axes, reviews }, head, policy), TypeError);
});

test('#4128 review evidence: exact structure and observations -> enforced without changing verdict', () => {
  const obs = ciObservation();
  const { policy } = evaluatePreflight(obs.preflight, obs);
  const fact = reviewed(obs);
  assert.equal(fact.verdict, 'pass');
  const gate = { head_sha: head, preflight_sha256: policy.sha256,
    active_axes: policy.active_axes, reviews: fact.reviews };
  for (const patch of [
    { evidence: undefined }, { observations: undefined }, { evidence: [] },
    { evidence: [{ acceptance: '', locations: ['src/a.ts:1'] }] },
    { evidence: [{ acceptance: 'behavior', locations: [] }] },
    { evidence: [{ acceptance: 'behavior', locations: ['/src/a.ts:1'] }] },
    { evidence: [{ acceptance: 'behavior', locations: ['../a.ts:1'] }] },
    { evidence: [{ acceptance: 'behavior', locations: ['src/a.ts:0'] }] },
    { evidence: [{ acceptance: 'behavior', locations: ['src/a.ts'] }] },
    { evidence: [{ acceptance: 'behavior', locations: ['src/a.ts:1'], extra: true }] },
    { observations: [''] }, { observations: [1] }, { observations: 'optional' },
  ]) {
    assert.throws(() => buildReviewFact({ ...gate,
      reviews: [{ ...fact.reviews[0], ...patch }, ...fact.reviews.slice(1)] }, head, policy), TypeError);
  }
  for (const signal of ['PASS', 'NEEDS-HUMAN-CHECK', 'BLOCK']) {
    const blockers = signal === 'BLOCK' ? [{ reviewer: 'contract', signature: 'regression',
      evidence: 'src/a.ts:1', fix_back_eligible: true, status: 'unresolved' }] : [];
    const reviews = [{ ...fact.reviews[0], verdict_signal: signal, blockers }, ...fact.reviews.slice(1)];
    const plain = buildReviewFact({ ...gate, reviews }, head, policy);
    const observed = buildReviewFact({ ...gate, reviews: reviews.map((review) => ({
      ...review, observations: ['Unrelated baseline behavior remains unchanged'],
    })) }, head, policy);
    assert.equal(observed.verdict, plain.verdict);
    assert.deepEqual(observed.blockers, plain.blockers);
    assert.throws(() => buildReviewFact({ ...gate, reviews: [{ ...reviews[0],
      observations: [null] }, ...reviews.slice(1)] }, head, policy), TypeError);
  }
});

test('#4128 stored legacy: mixed five/six-key envelopes and nested retention -> preserved and validated', () => {
  const obs = ciObservation();
  const { policy } = evaluatePreflight(obs.preflight, obs);
  const previous = reviewed(obs);
  for (const [index, review] of previous.reviews.entries()) {
    delete review.evidence;
    delete review.observations;
    if (index === 0) delete review.agent;
  }
  const bytes = JSON.stringify(previous);
  assert.deepEqual(validateReviewFact(previous, head, policy), previous);
  const hop = (prior, nextHead) => {
    const retention = { version: 1, previous_head_sha: prior.head, new_head_sha: nextHead,
      contract_sha256: policy.contract_sha256, policy_sha256: policy.sha256,
      previous_merge_base_sha: base, new_merge_base_sha: base,
      previous_review: prior, previous_accepted_at: obs.reviewAcceptedAt,
      changed_files: ['README.md'], compared_files: [{ path: 'src/a.ts',
        axes: ['code', 'verification'], previous_sha256: 'f'.repeat(64), new_sha256: 'f'.repeat(64),
        previous_mode: '100644', new_mode: '100644' }] };
    return buildReviewFact({ head_sha: nextHead, preflight_sha256: policy.sha256,
      active_axes: all, reviews: [{ ...reviewed(obs).reviews[0], reviewed_head_sha: nextHead }] },
    nextHead, policy, retention);
  };
  const second = hop(previous, 'e'.repeat(40));
  delete second.reviews[0].evidence;
  delete second.reviews[0].observations;
  const third = hop(second, 'f'.repeat(40));
  assert.deepEqual(validateReviewFact(third, third.head, policy), third);
  assert.equal(JSON.stringify(third.retention.previous_review.retention.previous_review), bytes);
  for (const patch of [
    { evidence: [] }, { observations: [] }, { extra: true },
    { evidence: [], observations: [] },
  ]) {
    const invalid = structuredClone(third);
    Object.assign(invalid.retention.previous_review.retention.previous_review.reviews[0], patch);
    assert.throws(() => validateReviewFact(invalid, invalid.head, policy), TypeError);
  }
});

test('#4099 review retention: authenticated prose hop -> fresh contract and original retained envelopes', () => {
  const obs = observation({ changedFiles: ['src/a.ts'], preflight: createPreflight(input({ active_axes: all })) });
  const { policy } = evaluatePreflight(obs.preflight, obs);
  const previous = reviewed(obs);
  const nextHead = 'e'.repeat(40);
  const retention = {
    version: 1, previous_head_sha: head, new_head_sha: nextHead,
    contract_sha256: policy.contract_sha256, policy_sha256: policy.sha256,
    previous_merge_base_sha: base, new_merge_base_sha: base,
    previous_review: previous, previous_accepted_at: obs.reviewAcceptedAt,
    changed_files: ['docs/guides/routing.md'],
    compared_files: [{ path: 'src/a.ts', axes: ['code', 'verification'],
      previous_sha256: 'f'.repeat(64), new_sha256: 'f'.repeat(64),
      previous_mode: '100644', new_mode: '100644' }],
  };
  const fresh = { head_sha: nextHead, preflight_sha256: policy.sha256, active_axes: all,
    reviews: [{ ...previous.reviews[0], reviewed_head_sha: nextHead }] };

  const fact = buildReviewFact(fresh, nextHead, policy, retention);

  assert.equal(fact.verdict, 'pass');
  assert.deepEqual(fact.retention.previous_review, previous);
  assert.deepEqual(fact.reviews, fresh.reviews);
  assert.deepEqual(validateReviewFact(fact, nextHead, policy), fact);
  const legacy = structuredClone(previous);
  for (const envelope of legacy.reviews) {
    delete envelope.agent;
    delete envelope.evidence;
    delete envelope.observations;
  }
  const legacyBytes = JSON.stringify(legacy);
  const legacyFact = buildReviewFact(fresh, nextHead, policy, { ...retention, previous_review: legacy });
  assert.deepEqual(validateReviewFact(legacyFact, nextHead, policy), legacyFact);
  assert.equal(JSON.stringify(legacyFact.retention.previous_review), legacyBytes);
  assert.equal(decideNext(lane, { ...obs, headSha: nextHead, review: fact }).action, 'create-pr');
  assert.throws(() => buildReviewFact(fresh, nextHead, policy), TypeError);
  assert.throws(() => buildReviewFact({ ...fresh, retention }, nextHead, policy), TypeError);
  for (const mutate of [
    (r) => { r.previous_review.verdict = 'block'; },
    (r) => { r.previous_review.reviews[1].agent = 'fluo-contract-reviewer'; },
    (r) => { r.previous_review.reviews.pop(); },
    (r) => { r.previous_review.reviews.push(r.previous_review.reviews[1]); },
    (r) => { r.contract_sha256 = '0'.repeat(64); },
    (r) => { r.policy_sha256 = '0'.repeat(64); },
    (r) => { r.new_head_sha = head; },
    (r) => { r.changed_files.push(r.changed_files[0]); },
    (r) => { r.changed_files = ['docs/CONTEXT.md']; },
    (r) => { r.compared_files[0].new_sha256 = '0'.repeat(64); },
    (r) => { r.compared_files[0].new_mode = '100755'; },
    (r) => { r.compared_files.push(r.compared_files[0]); },
    (r) => { r.compared_files[0].axes = ['code', 'code']; },
  ]) {
    const invalid = structuredClone(retention);
    mutate(invalid);
    assert.throws(() => buildReviewFact(fresh, nextHead, policy, invalid), TypeError);
  }
});

test('#4099 retention classifier: closed explanatory roles -> eligibility without changing existing classification', () => {
  for (const path of ['README.md', 'README.ko.md', 'packages/http/README.md',
    'docs/guides/routing.md', 'docs/getting-started/install.ko.md', 'docs/architecture/http.md',
    'book/beginner/ch01-start.md', 'book/intermediate/ch12-routing.ko.md', 'book/advanced/ch25-final.md']) {
    assert.equal(isRetentionProsePath(path), true, path);
    assert.deepEqual(classifyReviewAxes([path]), ['contract']);
  }
  for (const path of ['docs/guide.md', 'docs/contracts/runtime.md', 'docs/guides/input.mdx',
    '.agents/guide.md', '.github/guide.md', '.claude/guide.md', '.changeset/guide.md',
    'docs/guides/AGENTS.md', 'docs/guides/CLAUDE.md', 'docs/guides/SKILL.md',
    'docs/guides/CONTEXT.ko.md', 'docs/guides/CONTRIBUTING.md', 'docs/guides/SECURITY.md',
    'docs/guides/copilot-instructions.md', 'docs/guides/test.instructions.md',
    'docs/guides/context.md', 'docs/guides/routing.test.md',
    'docs/guides/test-types/value.md', 'docs/guides/__tests__/value.md',
    'docs/guides/__fixtures__/value.md', 'docs/guides/examples/input.md',
    'docs/guides/dist/routes.md', 'docs/guides/build/routes.md',
    'docs/guides/generated.md', 'docs/guides/machine-input.md', 'docs/guides/snapshot.md',
    'docs/guides/governance.md', 'tooling/ci/README.md', 'book/beginner/toc.md', 'other/README.md',
    '../README.md', 'docs/guides/../runtime.md']) {
    assert.equal(isRetentionProsePath(path), false, path);
  }
  assert.deepEqual(classifyReviewAxes(['docs/guides/generated.md']), ['contract']);
});

test('#4099 fix-back: governance role case variants -> excluded while explanatory guides remain eligible', () => {
  const matrix = [
    ['docs/guides/routing.md', true],
    ['docs/guides/governance.md', false],
    ['docs/guides/GOVERNANCE.md', false],
    ['docs/guides/Governance.md', false],
    ['docs/architecture/Review-GOVERNANCE/routing.md', false],
    ['book/advanced/ch01-Governance.md', false],
    ['docs/guides/release.md', false],
    ['docs/guides/RELEASE.md', false],
    ['docs/guides/Release/checks.md', false],
    ['docs/guides/ci.md', false],
    ['docs/guides/CI.md', false],
    ['docs/guides/Ci/checks.md', false],
    ['docs/guides/policy.md', false],
    ['docs/guides/POLICY.md', false],
    ['docs/guides/Review-Policy.md', false],
    ['docs/guides/Policies/checks.md', false],
    ['docs/guides/routing.mdx', false],
    ['docs/guides/routing.MDX', false],
    ['docs/guides/routing.Mdx', false],
    ['docs/guides/agents.md', false],
    ['docs/guides/sKiLl.md', false],
    ['docs/guides/routing.INSTRUCTIONS.md', false],
    ['docs/guides/TESTS/routing.md', false],
    ['docs/guides/FIXTURES/routing.md', false],
    ['docs/guides/EXAMPLES/routing.md', false],
    ['docs/guides/GENERATED/routing.md', false],
    ['docs/guides/BUILD/routing.md', false],
    ['docs/guides/DIST/routing.md', false],
    ['docs/guides/SNAPSHOT.md', false],
    ['docs/guides/MANIFEST.md', false],
    ['docs/guides/LOCKFILE.md', false],
  ];

  for (const [path, eligible] of matrix) {
    assert.equal(isRetentionProsePath(path), eligible, path);
  }
  assert.deepEqual(classifyReviewAxes(['docs/guides/GOVERNANCE.md']), ['contract']);
});

test('#4091 review admission: assigned identities -> accepted; missing or substituted identities -> rejected', () => {
  const obs = ciObservation();
  const { policy } = evaluatePreflight(obs.preflight, obs);
  const input = { head_sha: head, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
    reviews: policy.active_axes.map((reviewer) => ({ reviewer, agent: `fluo-${reviewer}-reviewer`,
      reviewed_head_sha: head, preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [],
      evidence: [{ acceptance: 'Keep public behavior', locations: ['src/a.ts:1'] }], observations: [] })) };

  assert.equal(buildReviewFact(input, head, policy).verdict, 'pass');
  for (const agent of [undefined, 'fluo-code-reviewer', 'unregistered', 'deep-high']) {
    const invalid = structuredClone(input);
    if (agent === undefined) delete invalid.reviews[0].agent;
    else invalid.reviews[0].agent = agent;
    assert.throws(() => buildReviewFact(invalid, head, policy), TypeError);
  }
});

test('#4091 stored legacy review: preserved bytes and bindings -> same gates; forged evidence -> review', () => {
  const obs = ciObservation();
  const { policy } = evaluatePreflight(obs.preflight, obs);
  const legacy = { head_sha: head, preflight_sha256: policy.sha256, active_axes: policy.active_axes,
    reviews: policy.active_axes.map((reviewer) => ({ reviewer, reviewed_head_sha: head,
      preflight_sha256: policy.sha256, verdict_signal: 'PASS', blockers: [] })),
    verdict: 'pass', blockers: [], head };
  const bytes = JSON.stringify(legacy);
  const binding = localCheckBinding(legacy, obs.reviewAcceptedAt);
  obs.review = legacy;

  assert.deepEqual(validateReviewFact(legacy, head, policy), legacy);
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  for (const [verdict_signal, verdict, action] of [
    ['BLOCK', 'block', 'fix-back'], ['NEEDS-HUMAN-CHECK', 'needs-human-check', 'blocked'],
  ]) {
    const blockers = verdict === 'block' ? [{ reviewer: 'contract', signature: 'legacy:regression',
      evidence: 'src/a.ts:1', fix_back_eligible: true, status: 'unresolved' }] : [];
    const stored = { ...legacy, verdict, blockers, reviews: legacy.reviews.map((review, i) =>
      i === 0 ? { ...review, verdict_signal, blockers } : review) };
    assert.equal(decideNext(lane, { ...obs, review: stored }).action, action);
  }
  obs.localChecks = { ...binding, head, status: 'failed' };
  assert.equal(decideNext(lane, obs).reason, 'local-checks-failed');
  assert.equal(JSON.stringify(legacy), bytes);
  assert.deepEqual(localCheckBinding(validateReviewFact(legacy, head, policy), obs.reviewAcceptedAt), binding);
  for (const patch of [
    { verdict: 'merge' }, { blockers: [{ signature: 'forged' }] }, { head: base },
    { preflight_sha256: 'e'.repeat(64) }, { reviews: [] },
    { reviews: [...legacy.reviews, legacy.reviews[0]] },
    { reviews: [{ ...legacy.reviews[0], reviewed_head_sha: base }, ...legacy.reviews.slice(1)] },
    { reviews: [{ ...legacy.reviews[0], agent: 'fluo-code-reviewer' }, ...legacy.reviews.slice(1)] },
  ]) assert.equal(decideNext(lane, { ...obs, review: { ...legacy, ...patch } }).action, 'review');
  assert.throws(() => buildReviewFact({ head_sha: head, preflight_sha256: policy.sha256,
    active_axes: policy.active_axes, reviews: legacy.reviews }, head, policy), TypeError);
});

test('publication: confirmed same baseline at reviewed head -> canonical fix-back', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  obs.knownBaselines = [{ id: 'docs-baseline', status: 'still-failing',
    head: obs.headSha, companionHead: 'f'.repeat(40), evidence: 'authenticated source and completed checks' }];

  const decision = decideNext(lane, obs);

  assert.equal(decision.action, 'fix-back');
  assert.equal(decision.reason, 'known-baseline-still-failing');
});

test('publication baseline: fixed, absent and unresolved proof -> preserve or block exact-head gates', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  for (const knownBaselines of [[], [{ id: 'baseline', head, status: 'fixed' }]]) {
    assert.equal(decideNext(lane, { ...obs, knownBaselines }).action, 'create-pr');
  }
  for (const status of ['different-source-or-conditions', 'insufficient-evidence']) {
    const knownBaselines = [{ id: 'baseline', head, status }];
    assert.equal(decideNext(lane, { ...obs, knownBaselines }).action, 'blocked');
  }
  assert.equal(decideNext(lane, { ...obs, knownBaselines: [{ id: 'baseline', head: base, status: 'fixed' }] }).action, 'blocked');
  const knownBaselines = [{ id: 'baseline', head, status: 'still-failing' }];
  assert.equal(decideNext(lane, { ...obs, knownBaselines, review: null }).action, 'review');
  const newHead = 'e'.repeat(40);
  assert.equal(decideNext(lane, { ...obs, headSha: newHead, knownBaselines }).action, 'review');
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

const validationRequirements = () => [
  { validation: 'node --test', kind: 'local', command: 'PATH=/opt/tools:$PATH node --test',
    prerequisites: { tools: [{ name: 'node', path_dirs: ['/opt/tools'] }],
      artifacts: [{ path: 'node_modules', kind: 'directory' }, { path: 'packages/core/dist/index.js', kind: 'file' }] } },
  { validation: 'GitHub Verify', kind: 'ci-only', check: 'Verify', reason: 'Linux runner and remote artifacts required' },
];

test('#4129 preflight: optional execution requirements -> authenticated contract and unchanged legacy digest/policy', () => {
  const legacy = createPreflight(input());
  const { sha256, ...bytes } = legacy;
  assert.equal(sha256, contractDigest(bytes));
  assert.equal(Object.hasOwn(legacy, 'validation_requirements'), false);
  assert.deepEqual(createPreflight(bytes), legacy);
  const requirements = validationRequirements();

  const value = createPreflight(input({ validation: requirements.map((r) => r.validation),
    validation_requirements: requirements }));

  assert.deepEqual(validatePreflight(value).validation_requirements, requirements);
  assert.notEqual(value.sha256, legacy.sha256);
  assert.deepEqual(evaluatePreflight(legacy, observation()).policy,
    evaluatePreflight(createPreflight(bytes), observation()).policy);
  assert.throws(() => validatePreflight({ ...value, validation_requirements: [] }), TypeError);
});

for (const [name, mutate] of [
  ['missing', (r) => r.pop()],
  ['duplicate', (r) => r.push(structuredClone(r[0]))],
  ['unbound', (r) => { r[0].validation = 'other'; }],
  ['unknown-kind', (r) => { r[0].kind = 'passed'; }],
  ['missing-command', (r) => { delete r[0].command; }],
  ['relative-tool-path', (r) => { r[0].prerequisites.tools[0].path_dirs = ['bin']; }],
  ['unsafe-artifact', (r) => { r[0].prerequisites.artifacts[0].path = '../node_modules'; }],
  ['absolute-artifact', (r) => { r[0].prerequisites.artifacts[0].path = '/tmp/dist'; }],
  ['unknown-artifact-kind', (r) => { r[0].prerequisites.artifacts[0].kind = 'symlink'; }],
  ['missing-prerequisites', (r) => { delete r[0].prerequisites; }],
  ['ci-local-success', (r) => { r[1].status = 'passed'; }],
  ['missing-ci-reason', (r) => { r[1].reason = ''; }],
]) {
  test(`#4129 preflight: ${name} requirements -> rejection before digest acceptance`, () => {
    const requirements = validationRequirements();
    mutate(requirements);

    assert.throws(() => createPreflight(input({ validation: ['node --test', 'GitHub Verify'],
      validation_requirements: requirements })), TypeError);
  });
}

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

test('literal Next route brackets remain valid scoped paths', () => {
  const route = 'src/products/[sku]/page.tsx';
  const preflight = createPreflight(input({
    scope: [route],
    predicted_files: [route],
  }));
  const obs = observation({ preflight, changedFiles: [route] });
  assert.equal(evaluatePreflight(preflight, obs).valid, true);
  assert.equal(decideNext(lane, obs).action, 'review');
  assert.deepEqual(
    evaluatePreflight(preflight, { ...obs, changedFiles: ['src/products/[other]/page.tsx'] }),
    { valid: false, reason: 'scope-expansion', files: ['src/products/[other]/page.tsx'] },
  );
  assert.throws(() => createPreflight(input({ scope: ['src/products/*/page.tsx'] })));
});

test('contract revision invalidates review at unchanged head', () => {
  const obs = observation();
  obs.review = reviewed(obs);
  assert.equal(decideNext(lane, obs).action, 'create-pr');
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

test('reviewed CI changes publish without receipt, including local-failure fix-back cycle', () => {
  const obs = ciObservation({ hasNewCommits: false });
  assert.equal(decideNext(lane, obs).action, 'implement');
  obs.hasNewCommits = true;
  assert.equal(decideNext(lane, obs).action, 'review');
  obs.review = reviewed(obs);
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  obs.localChecks = { ...passedCheck(obs), status: 'failed' };
  assert.equal(decideNext(lane, obs).reason, 'local-checks-failed');
  obs.headSha = 'e'.repeat(40);
  assert.equal(decideNext(lane, obs).action, 'review');
  obs.review = reviewed(obs);
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  obs.localChecks = passedCheck(obs);
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

test('same-head unbound local evidence cannot block reviewed publication', () => {
  const obs = ciObservation();
  obs.review = reviewed(obs);
  obs.localChecks = passedCheck(obs);
  delete obs.localChecks.reviewSha256;
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  obs.localChecks.status = 'failed';
  assert.equal(decideNext(lane, obs).action, 'create-pr');
});

test('optional receipt never substitutes for accepted preflight or exact-head review', () => {
  const obs = ciObservation();
  obs.review = reviewed(obs);
  obs.localChecks = passedCheck(obs);
  obs.localChecks.receiptStartedAt = '2025-12-31T23:59:59.000Z';
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  obs.localChecks = passedCheck(obs);
  obs.reviewAcceptedAt = '2026-01-01T00:00:00.500Z';
  assert.equal(decideNext(lane, obs).action, 'create-pr');
  obs.review = null;
  assert.equal(decideNext(lane, obs).action, 'review');
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
