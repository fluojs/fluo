import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ATTEMPT_CEILING,
	applyChildResult,
	decideNext,
	summarizeTransitions,
} from './lane-v4.mjs';
import { isChangesetFile, isConsumerVisibleFile } from './lane-v4-cli.mjs';

const makeLane = (overrides = {}) => ({
	issue: 3096,
	attempts: {},
	approvals: { merge: false },
	blocker: null,
	...overrides,
});

const makeObs = (overrides = {}) => ({
	issueState: 'OPEN',
	branch: 'issue-3096-http-integration-seam',
	worktree: '.worktrees/issue-3096-http-integration-seam',
	headSha: 'a'.repeat(40),
	hasNewCommits: true,
	localChecks: { status: 'passed' },
	publicPackagesTouched: true,
	changesetPresent: true,
	review: { verdict: 'merge', head: 'a'.repeat(40) },
	pr: null,
	...overrides,
});

// --- C1: resume from observed state alone (no session identity) ---

test('C1: fresh issue with no branch decides implement', () => {
	const next = decideNext(makeLane(), makeObs({ branch: null, worktree: null, headSha: null, hasNewCommits: false, localChecks: null, review: null }));
	assert.equal(next.action, 'implement');
});

test('C1: resumes mid-flight issue from observation alone -> review', () => {
	// Branch + commits + local checks passed, review not yet run.
	// No session id, run id, or journal appears anywhere in the inputs.
	const next = decideNext(makeLane(), makeObs({ review: null }));
	assert.equal(next.action, 'review');
});

test('C1: resumes with open PR and pending CI -> wait-ci', () => {
	const next = decideNext(
		makeLane(),
		makeObs({
			pr: { number: 1, state: 'OPEN', headSha: 'a'.repeat(40), mergeable: 'MERGEABLE', ciStatus: 'pending' },
		}),
	);
	assert.equal(next.action, 'wait-ci');
});

test('C1: merged PR with leftover worktree -> cleanup, then done', () => {
	const merged = { number: 1, state: 'MERGED', headSha: 'a'.repeat(40), mergeable: 'UNKNOWN', ciStatus: 'passing' };
	assert.equal(decideNext(makeLane(), makeObs({ pr: merged })).action, 'cleanup');
	assert.equal(
		decideNext(makeLane(), makeObs({ pr: merged, branch: null, worktree: null })).action,
		'done',
	);
});

// --- C2: retry-by-default, terminal only at ceiling or policy ---

test('C2: malformed child result -> retry, not terminal', () => {
	const lane = applyChildResult(makeLane(), 'implement', { ok: false, error: 'malformed output' });
	assert.equal(lane.attempts.implement, 1);
	assert.equal(lane.blocker, null);
	const next = decideNext(lane, makeObs({ hasNewCommits: false, localChecks: null, review: null }));
	assert.equal(next.action, 'implement');
});

test('C2: attempts below ceiling never set a blocker', () => {
	let lane = makeLane();
	for (let i = 1; i < ATTEMPT_CEILING; i += 1) {
		lane = applyChildResult(lane, 'implement', { ok: false, error: 'boom' });
		assert.equal(lane.blocker, null, `attempt ${i} must not terminalize`);
	}
});

test('C2: ceiling reached -> typed attempts-exhausted blocker', () => {
	let lane = makeLane();
	for (let i = 0; i < ATTEMPT_CEILING; i += 1) {
		lane = applyChildResult(lane, 'implement', { ok: false, error: 'boom' });
	}
	assert.deepEqual(lane.blocker, { type: 'attempts-exhausted', phase: 'implement' });
	assert.equal(decideNext(lane, makeObs()).action, 'blocked');
});

test('C2: success resets the attempt counter', () => {
	let lane = applyChildResult(makeLane(), 'implement', { ok: false, error: 'boom' });
	lane = applyChildResult(lane, 'implement', { ok: true });
	assert.equal(lane.attempts.implement, 0);
	assert.equal(lane.blocker, null);
});

test('C2: needs-human-check review verdict is a policy block', () => {
	const next = decideNext(makeLane(), makeObs({ review: { verdict: 'needs-human-check', head: 'a'.repeat(40) } }));
	assert.equal(next.action, 'blocked');
	assert.equal(next.reason, 'needs-human-check');
});

// --- C3: real contract gates preserved ---

test('C3: merge-ready without approval -> request-merge-approval, never merge', () => {
	const obs = makeObs({
		pr: { number: 1, state: 'OPEN', headSha: 'a'.repeat(40), mergeable: 'MERGEABLE', ciStatus: 'passing' },
	});
	const next = decideNext(makeLane(), obs);
	assert.equal(next.action, 'request-merge-approval');
});

test('C3: merge only with explicit approval + green CI + same-head review', () => {
	const obs = makeObs({
		pr: { number: 1, state: 'OPEN', headSha: 'a'.repeat(40), mergeable: 'MERGEABLE', ciStatus: 'passing' },
	});
	const lane = makeLane({ approvals: { merge: true } });
	assert.equal(decideNext(lane, obs).action, 'merge');
});

test('C3: public package change without changeset -> fix-back, never create-pr', () => {
	const next = decideNext(makeLane(), makeObs({ changesetPresent: false, review: null }));
	assert.equal(next.action, 'fix-back');
	assert.equal(next.reason, 'changeset-missing');
});

test('C3: changeset present and review passed -> create-pr', () => {
	const next = decideNext(makeLane(), makeObs());
	assert.equal(next.action, 'create-pr');
});

// --- D1: cross-issue dependency gate (multi-layer lanes) ---

test('D1: unmet dependencies -> wait-dependencies, before any other action', () => {
	const next = decideNext(
		makeLane(),
		makeObs({ unmetDependencies: [3356], branch: null, worktree: null, hasNewCommits: false, localChecks: null, review: null }),
	);
	assert.equal(next.action, 'wait-dependencies');
	assert.deepEqual(next.unmet, [3356]);
});

test('D1: unmet dependencies outrank mid-flight state too', () => {
	const next = decideNext(makeLane(), makeObs({ unmetDependencies: [3356] }));
	assert.equal(next.action, 'wait-dependencies');
});

test('D1: satisfied dependencies (empty list) proceed normally', () => {
	const next = decideNext(makeLane(), makeObs({ unmetDependencies: [], review: null }));
	assert.equal(next.action, 'review');
});

test('D1: standing blocker still outranks dependency wait', () => {
	const lane = makeLane({ blocker: { type: 'attempts-exhausted', phase: 'implement' } });
	const next = decideNext(lane, makeObs({ unmetDependencies: [3356] }));
	assert.equal(next.action, 'blocked');
});

// --- watch mode: pure transition diffing over plan-all snapshots ---

test('watch: first snapshot reports every decision as a transition from null', () => {
	const next = [{ issue: 3356, decision: { action: 'implement' } }];
	const out = summarizeTransitions(null, next);
	assert.deepEqual(out.changes, [{ issue: 3356, from: null, to: 'implement' }]);
	assert.equal(out.settled, false);
});

test('watch: only changed decisions are reported', () => {
	const prev = [
		{ issue: 3356, decision: { action: 'wait-ci' } },
		{ issue: 3357, decision: { action: 'wait-dependencies' } },
	];
	const next = [
		{ issue: 3356, decision: { action: 'wait-ci' } },
		{ issue: 3357, decision: { action: 'implement' } },
	];
	const out = summarizeTransitions(prev, next);
	assert.deepEqual(out.changes, [{ issue: 3357, from: 'wait-dependencies', to: 'implement' }]);
});

test('watch: lane settles when every issue is done or blocked', () => {
	const next = [
		{ issue: 3356, decision: { action: 'done' } },
		{ issue: 3357, decision: { action: 'blocked' } },
	];
	assert.equal(summarizeTransitions(null, next).settled, true);
	const live = [
		{ issue: 3356, decision: { action: 'done' } },
		{ issue: 3357, decision: { action: 'wait-ci' } },
	];
	assert.equal(summarizeTransitions(null, live).settled, false);
});

// --- supporting decisions the loop relies on ---

test('stale review head triggers re-review, not merge', () => {
	const next = decideNext(makeLane(), makeObs({ review: { verdict: 'merge', head: 'b'.repeat(40) } }));
	assert.equal(next.action, 'review');
});

test('review block -> fix-back with reason', () => {
	const next = decideNext(makeLane(), makeObs({ review: { verdict: 'block', head: 'a'.repeat(40) } }));
	assert.equal(next.action, 'fix-back');
	assert.equal(next.reason, 'review-block');
});

test('failing CI -> fix-back ci-failing', () => {
	const next = decideNext(
		makeLane(),
		makeObs({ pr: { number: 1, state: 'OPEN', headSha: 'a'.repeat(40), mergeable: 'MERGEABLE', ciStatus: 'failing' } }),
	);
	assert.equal(next.action, 'fix-back');
	assert.equal(next.reason, 'ci-failing');
});

test('conflicting PR -> resolve-conflict', () => {
	const next = decideNext(
		makeLane(),
		makeObs({ pr: { number: 1, state: 'OPEN', headSha: 'a'.repeat(40), mergeable: 'CONFLICTING', ciStatus: 'pending' } }),
	);
	assert.equal(next.action, 'resolve-conflict');
});

test('PR head behind local head -> push', () => {
	const next = decideNext(
		makeLane(),
		makeObs({ pr: { number: 1, state: 'OPEN', headSha: 'c'.repeat(40), mergeable: 'MERGEABLE', ciStatus: 'passing' } }),
	);
	assert.equal(next.action, 'push');
});

// --- C3b: changeset gate file classification (observeIssue's input) ---
// decideNext only consumes publicPackagesTouched/changesetPresent; the
// classification that produces them lived inline in observeIssue and drifted
// silently, so it is pinned here directly.

test('C3b: production source under packages/ is consumer-visible', () => {
	assert.equal(isConsumerVisibleFile('packages/platform-express/src/adapter.ts'), true);
});

test('C3b: test files are not consumer-visible', () => {
	assert.equal(isConsumerVisibleFile('packages/platform-express/src/adapter.test.ts'), false);
	assert.equal(isConsumerVisibleFile('packages/testing/src/module.test-fixture.ts'), false);
});

test('C3b: test-support declarations outside src are not consumer-visible', () => {
	assert.equal(isConsumerVisibleFile('packages/platform-express/test-types/testing-http-adapter-portability.d.ts'), false);
	assert.equal(isConsumerVisibleFile('packages/platform-bun/__tests__/helpers.ts'), false);
	assert.equal(isConsumerVisibleFile('packages/platform-deno/test/helper.ts'), false);
});

test('C3b: a directory merely starting with "test" stays consumer-visible', () => {
	assert.equal(isConsumerVisibleFile('packages/testing/src/http.ts'), true);
	assert.equal(isConsumerVisibleFile('packages/platform-deno/src/testing-support.ts'), true);
});

test('C3b: docs and non-package paths are not consumer-visible', () => {
	assert.equal(isConsumerVisibleFile('packages/studio/README.md'), false);
	assert.equal(isConsumerVisibleFile('docs/contracts/testing-guide.md'), false);
	assert.equal(isConsumerVisibleFile('tooling/governance/verify-platform-consistency-governance.mjs'), false);
});

test('C3b: changeset files are recognized, README is not', () => {
	assert.equal(isChangesetFile('.changeset/bright-suns-juggle.md'), true);
	assert.equal(isChangesetFile('.changeset/README.md'), false);
	assert.equal(isChangesetFile('packages/studio/CHANGELOG.md'), false);
});
