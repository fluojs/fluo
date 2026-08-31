// execute-lane v4 decision engine.
//
// Design invariants (each reverses a diagnosed v3 stall root cause):
// - No session identity: decisions derive ONLY from (lane file, observed
//   git/GitHub state). Any coordinator can resume any lane at any time.
// - Retry-by-default: a failed or malformed child result increments an
//   attempt counter and re-queues the same phase. Only two things are
//   terminal: an explicit attempt ceiling and a genuine policy blocker
//   that needs human judgment.
// - GitHub is the durable state store: branch, worktree, PR, checks and
//   merge state are observed fresh, never journaled as identity.
// - CI is a subscription (`gh pr checks --watch` in the CLI), never a
//   polling ceremony.

export const ATTEMPT_CEILING = 3;

const PHASES = new Set([
	'implement',
	'verify-local',
	'review',
	'fix-back',
	'create-pr',
	'push',
	'merge',
	'cleanup',
	'resolve-conflict',
]);

const requireRecord = (value, name) => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value;
};

/**
 * Fold one child result into the lane. Pure.
 * A well-formed success resets the phase attempt counter. Anything else
 * (failure, malformed shape) is a retry until ATTEMPT_CEILING, at which
 * point a typed, user-resumable blocker is recorded.
 */
export const applyChildResult = (lane, phase, result) => {
	requireRecord(lane, 'lane');
	if (!PHASES.has(phase)) {
		throw new TypeError(`unknown phase: ${phase}`);
	}
	const next = structuredClone(lane);
	next.attempts ??= {};
	const wellFormed =
		typeof result === 'object' && result !== null && result.ok === true;
	if (wellFormed) {
		next.attempts[phase] = 0;
		return next;
	}
	const attempts = (next.attempts[phase] ?? 0) + 1;
	next.attempts[phase] = attempts;
	if (attempts >= ATTEMPT_CEILING) {
		next.blocker = { type: 'attempts-exhausted', phase };
	}
	return next;
};

/**
 * Diff two plan-all snapshots for watch mode. Pure.
 * Returns the per-issue action transitions plus whether the lane has
 * settled (every issue done or blocked). `prev` may be null on the
 * first tick, in which case every decision reports as a transition
 * from null.
 */
export const summarizeTransitions = (prev, next) => {
	if (!Array.isArray(next)) {
		throw new TypeError('next snapshot must be an array.');
	}
	const prevByIssue = new Map(
		(Array.isArray(prev) ? prev : []).map((row) => [row.issue, row.decision.action]),
	);
	const changes = [];
	for (const row of next) {
		const from = prevByIssue.get(row.issue) ?? null;
		const to = row.decision.action;
		if (from !== to) changes.push({ issue: row.issue, from, to });
	}
	const settled = next.every((row) =>
		['done', 'blocked'].includes(row.decision.action),
	);
	return { changes, settled };
};

// Stall detection for watch. Transitions-only output reads "no change" as
// "no problem", and that assumption broke live: issue 3400 sat in `review`
// for hours after a unanimous triad because the lead never consulted `plan`
// and nothing nudged it. Terminal states never stall, and wait-dependencies
// is exempt because it is derivative waiting — the upstream issue's own stall
// fires instead.
const STALL_EXEMPT = new Set(['done', 'blocked', 'wait-dependencies']);

export const trackStalls = (counts, next, threshold) => {
	if (!Array.isArray(next)) {
		throw new TypeError('next snapshot must be an array.');
	}
	const nextCounts = {};
	const stalled = [];
	for (const row of next) {
		const key = String(row.issue);
		const action = row.decision.action;
		const prev = counts?.[key];
		const ticks = prev && prev.action === action ? prev.ticks + 1 : 1;
		nextCounts[key] = { action, ticks };
		const due = threshold > 0 && ticks >= threshold && ticks % threshold === 0;
		if (due && !STALL_EXEMPT.has(action)) {
			stalled.push({ issue: row.issue, action, ticks });
		}
	}
	return { counts: nextCounts, stalled };
};

/**
 * Decide the next action for one issue. Pure function of
 * (lane state, fresh observation). Returns { action, reason?, ... }.
 */
export const decideNext = (lane, obs) => {
	requireRecord(lane, 'lane');
	requireRecord(obs, 'obs');

	// 1. Standing typed blockers park the issue until a human acts.
	if (lane.blocker !== null && lane.blocker !== undefined) {
		return { action: 'blocked', reason: lane.blocker.type, blocker: lane.blocker };
	}
	if (obs.review?.verdict === 'needs-human-check') {
		return { action: 'blocked', reason: 'needs-human-check' };
	}

	// 2. Merged PR: converge to cleanup, then done.
	if (obs.pr?.state === 'MERGED') {
		if (obs.branch || obs.worktree) {
			return { action: 'cleanup', pr: obs.pr.number };
		}
		return { action: 'done', pr: obs.pr.number };
	}
	if (obs.issueState === 'CLOSED' && !obs.pr) {
		return { action: 'done', reason: 'issue-closed-externally' };
	}

	// 2.5 Cross-issue dependency gate: a dependent issue does nothing until
	//     every depends_on issue is observably terminal (GitHub issue CLOSED).
	//     Observed live, never journaled — release is automatic and ceremony-free.
	if (Array.isArray(obs.unmetDependencies) && obs.unmetDependencies.length > 0) {
		return { action: 'wait-dependencies', unmet: obs.unmetDependencies };
	}

	// 3. Nothing implemented yet (or implementation retry).
	if (!obs.branch || !obs.worktree || !obs.hasNewCommits) {
		return { action: 'implement' };
	}

	// 4. Local verification of the current head.
	if (obs.localChecks === null || obs.localChecks === undefined) {
		return { action: 'verify-local', head: obs.headSha };
	}
	if (obs.localChecks.status === 'failed') {
		return { action: 'fix-back', reason: 'local-checks-failed', head: obs.headSha };
	}

	// 5. Release governance: public package changes ship a changeset
	//    before review, so reviewers see the final head.
	if (obs.publicPackagesTouched === true && obs.changesetPresent !== true) {
		return { action: 'fix-back', reason: 'changeset-missing', head: obs.headSha };
	}

	// 6. Read-only review triad, bound to the exact current head.
	if (!obs.review) {
		return { action: 'review', head: obs.headSha };
	}
	if (obs.review.verdict === 'block') {
		return { action: 'fix-back', reason: 'review-block', head: obs.headSha };
	}
	if (obs.review.head !== obs.headSha) {
		return { action: 'review', reason: 'stale-review-head', head: obs.headSha };
	}

	// 7. Remote lifecycle. GitHub state is authoritative.
	if (!obs.pr) {
		return { action: 'create-pr', head: obs.headSha };
	}
	if (obs.pr.state === 'CLOSED') {
		return { action: 'blocked', reason: 'pr-closed-externally', pr: obs.pr.number };
	}
	if (obs.pr.headSha !== obs.headSha) {
		return { action: 'push', pr: obs.pr.number, head: obs.headSha };
	}
	if (obs.pr.mergeable === 'CONFLICTING') {
		return { action: 'resolve-conflict', pr: obs.pr.number };
	}
	if (obs.pr.ciStatus === 'failing') {
		return { action: 'fix-back', reason: 'ci-failing', pr: obs.pr.number };
	}
	if (obs.pr.ciStatus !== 'passing') {
		return { action: 'wait-ci', pr: obs.pr.number };
	}

	// 8. Merge gate: explicit approval is a hard contract (AGENTS.md).
	if (lane.approvals?.merge !== true) {
		return { action: 'request-merge-approval', pr: obs.pr.number };
	}
	return { action: 'merge', pr: obs.pr.number, head: obs.headSha };
};
