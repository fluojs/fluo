import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ATTEMPT_CEILING,
	applyChildResult,
	decideNext,
	summarizeTransitions,
	trackStalls,
} from './lane-v4.mjs';
import { isChangesetFile, isConsumerVisibleFile, laneV2ToInitSpecs } from './lane-v4-cli.mjs';

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
	assert.equal(isConsumerVisibleFile('docs/contracts/testing-guide.md'), false);
	assert.equal(isConsumerVisibleFile('tooling/governance/verify-platform-consistency-governance.mjs'), false);
});

// npm auto-includes package-root README*/LICENSE* in the tarball regardless of
// the manifest `files` field (proven live on #3347: `npm pack --dry-run` showed
// README.md and README.ko.md shipping for @fluojs/testing despite files:["dist"]).
// The old predicate excluded every .md, so a README-only change slipped the
// changeset gate until a reviewer caught it.
test('C3b: package-root README and LICENSE ship in the tarball -> consumer-visible', () => {
	assert.equal(isConsumerVisibleFile('packages/studio/README.md'), true);
	assert.equal(isConsumerVisibleFile('packages/testing/README.ko.md'), true);
	assert.equal(isConsumerVisibleFile('packages/studio/LICENSE'), true);
});

test('C3b: nested README and non-shipping package-root docs stay invisible', () => {
	// npm's auto-include applies only at the package root.
	assert.equal(isConsumerVisibleFile('packages/studio/src/README.md'), false);
	// CHANGELOG is not auto-included and files:["dist"] excludes it (verified in
	// the same #3347 pack output).
	assert.equal(isConsumerVisibleFile('packages/studio/CHANGELOG.md'), false);
});

test('C3b: changeset files are recognized, README is not', () => {
	assert.equal(isChangesetFile('.changeset/bright-suns-juggle.md'), true);
	assert.equal(isChangesetFile('.changeset/README.md'), false);
	assert.equal(isChangesetFile('packages/studio/CHANGELOG.md'), false);
});

// --- C5: watch stall detection ---
// Transitions-only output reads "no change" as "no problem"; issue 3400
// disproved that by sitting in `review` for hours after a unanimous triad
// with no nudge.
const snap = (pairs) => pairs.map(([issue, action]) => ({ issue, decision: { action } }));

test('C5: first tick starts counts at 1 and reports nothing below threshold', () => {
	const r = trackStalls(null, snap([[3400, 'review']]), 3);
	assert.deepEqual(r.counts, { 3400: { action: 'review', ticks: 1 } });
	assert.deepEqual(r.stalled, []);
});

test('C5: an unchanged decision stalls at the threshold and at every multiple', () => {
	let counts = null;
	const reported = [];
	for (let i = 0; i < 6; i++) {
		const r = trackStalls(counts, snap([[3400, 'review']]), 3);
		counts = r.counts;
		reported.push(r.stalled.length);
	}
	// ticks 1..6 -> stall fires at 3 and 6 only
	assert.deepEqual(reported, [0, 0, 1, 0, 0, 1]);
	assert.deepEqual(counts, { 3400: { action: 'review', ticks: 6 } });
});

test('C5: a decision change resets the stall counter', () => {
	let counts = trackStalls(null, snap([[3400, 'review']]), 2).counts;
	counts = trackStalls(counts, snap([[3400, 'review']]), 2).counts; // ticks 2 -> fired
	const r = trackStalls(counts, snap([[3400, 'wait-ci']]), 2);
	assert.deepEqual(r.counts, { 3400: { action: 'wait-ci', ticks: 1 } });
	assert.deepEqual(r.stalled, []);
});

test('C5: terminal and derivative-wait states never stall', () => {
	let counts = null;
	for (let i = 0; i < 4; i++) {
		const r = trackStalls(
			counts,
			snap([[1, 'done'], [2, 'blocked'], [3, 'wait-dependencies']]),
			2,
		);
		counts = r.counts;
		assert.deepEqual(r.stalled, []);
	}
});

test('C5: threshold 0 disables stall reporting', () => {
	let counts = null;
	for (let i = 0; i < 5; i++) {
		const r = trackStalls(counts, snap([[3400, 'review']]), 0);
		counts = r.counts;
		assert.deepEqual(r.stalled, []);
	}
});

test('C5: a non-array snapshot is rejected', () => {
	assert.throws(() => trackStalls(null, null, 3), TypeError);
});

// --- C4: `$create-lane` v2 ledger intake ---
// v4 consumes only the issue set and dependency edges from a v2 ledger; the rest
// of v2 describes v1 DAG/authority machinery that v4 does not have.

test('C4: v2 ledger translates to init specs with dependency edges', () => {
	const { laneId, baseBranch, specs } = laneV2ToInitSpecs({
		version: 2,
		lane_id: 'lane-3134-3268-3333-studio-runtime',
		base_branch: 'main',
		confirmed_issues: [3134, 3268, 3333],
		dependency_graph: { 3134: [3268] },
	});
	assert.equal(laneId, 'lane-3134-3268-3333-studio-runtime');
	assert.equal(baseBranch, 'main');
	assert.deepEqual(specs, [
		{ n: 3134, deps: [3268] },
		{ n: 3268, deps: [] },
		{ n: 3333, deps: [] },
	]);
});

test('C4: v2 ledger without a dependency graph yields independent issues', () => {
	const { specs } = laneV2ToInitSpecs({
		version: 2,
		lane_id: 'lane-x',
		confirmed_issues: [10, 20],
	});
	assert.deepEqual(specs, [{ n: 10, deps: [] }, { n: 20, deps: [] }]);
});

test('C4: non-v2 input is rejected', () => {
	assert.throws(() => laneV2ToInitSpecs({ version: 4, confirmed_issues: [1] }), /version.*2/);
	assert.throws(() => laneV2ToInitSpecs(null), /version.*2/);
});

test('C4: empty or malformed confirmed_issues is rejected', () => {
	assert.throws(() => laneV2ToInitSpecs({ version: 2, confirmed_issues: [] }), /confirmed_issues/);
	assert.throws(() => laneV2ToInitSpecs({ version: 2, confirmed_issues: [0] }), /confirmed_issues/);
	assert.throws(() => laneV2ToInitSpecs({ version: 2 }), /confirmed_issues/);
});

test('C4: a dependency outside the lane is rejected, not silently dropped', () => {
	assert.throws(
		() => laneV2ToInitSpecs({ version: 2, lane_id: 'l', confirmed_issues: [1, 2], dependency_graph: { 1: [99] } }),
		/dependency 99 of issue 1 is not in confirmed_issues/,
	);
});
