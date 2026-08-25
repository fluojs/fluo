import { assertBlockerReconciliation } from '../../issue-to-pr/scripts/contracts.mjs';
import { aggregateReviewerGate } from '../../pr-to-merge/scripts/contracts.mjs';
import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import {
  assertIssueSupervisorState,
  requireAuthorityScope,
  requirePositiveInteger,
  requireRetryPolicy,
  requireTimestamp,
} from './issue-supervisor-contracts.mjs';
import { applyRemoteTransition } from './issue-supervisor-remote.mjs';
import {
  requireRecord,
  requireSha,
  requireString,
} from './transition-contracts.mjs';

const requireStatus = (state, ...allowed) => {
  if (!allowed.includes(state.status)) {
    throw new TypeError(
      `${state.status} cannot accept this transition; expected ${allowed.join(' or ')}.`,
    );
  }
};

const reviewerSignals = (reviews) =>
  Object.fromEntries(
    reviews.map((review) => [review.reviewer, review.verdict_signal]),
  );

const localReview = (state, step) => {
  requireStatus(state, 'local-review');
  const outcome = aggregateReviewerGate({
    head_sha: state.head_sha,
    reviews: step.reviews,
  });
  const readyVerdict = state.pr === null ? 'ready-for-pr' : 'ready-for-push';
  const verdict = {
    version: 1,
    lane_id: state.lane_id,
    issue_number: state.issue_number,
    verdict:
      outcome.verdict === 'merge' ? readyVerdict : outcome.verdict,
    head_sha: state.head_sha,
    reviewers: reviewerSignals(step.reviews),
    blockers: outcome.blockers,
  };
  assertContract('local-review-verdict', verdict);
  state.local_review = verdict;
  if (outcome.verdict === 'merge') {
    state.status = readyVerdict;
    state.blockers = [];
  } else if (outcome.verdict === 'block') {
    state.status = 'implementing';
    state.blockers = outcome.blockers;
  } else {
    state.status = 'needs-human-check-terminal';
    state.blockers = [];
  }
};

const completeImplementation = (state, step) => {
  if (step.kind === 'implementation-completed') {
    requireStatus(state, 'implementing');
    if (state.attempt !== 0 || state.blockers.length !== 0 || state.pr !== null) {
      throw new TypeError(
        'blocked implementation requires fix-completed reconciliation.',
      );
    }
  } else {
    requireStatus(state, 'implementing', 'ci-fix-back');
    if (state.blockers.length === 0) {
      throw new TypeError('fix-completed requires unresolved blockers.');
    }
    const observedAt = requireTimestamp(
      step.observed_at,
      'fix-completed.observed_at',
    );
    const elapsed = Date.parse(observedAt) - Date.parse(state.started_at);
    if (
      state.attempt >= state.retry_policy.max_same_failure_repeats ||
      elapsed > state.retry_policy.max_wall_clock_minutes * 60_000
    ) {
      state.status = 'blocked-budget-exhausted';
      return;
    }
    assertBlockerReconciliation(state.blockers, step.addressed_blockers, []);
    state.attempt += 1;
  }
  const newHead = requireSha(step.new_head, `${step.kind}.new_head`);
  if (newHead === state.head_sha) {
    throw new TypeError(`${step.kind} must produce a new head.`);
  }
  state.head_sha = newHead;
  state.verification = requireString(
    step.verification,
    `${step.kind}.verification`,
  );
  state.status = 'local-review';
  state.blockers = [];
  state.local_review = null;
  state.ci = null;
};

const parkReleaseHandoff = (state, step) => {
  requireStatus(state, 'implementing');
  if (
    state.release_handoff !== true ||
    state.lane_plan_approval_sha256 === null ||
    step.approval_sha256 !== state.lane_plan_approval_sha256
  ) {
    throw new TypeError('release handoff approval does not match the lane binding.');
  }
  state.status = 'blocked-maintainer-decision';
  state.blockers = [
    {
      reviewer: 'verification',
      signature: 'release-handoff:maintainer:required',
      evidence: step.approval_sha256,
      fix_back_eligible: false,
      status: 'unresolved',
    },
  ];
};

export const createIssueSupervisor = (input) => {
  const value = requireRecord(input, 'issue supervisor identity');
  const issueNumber = requirePositiveInteger(
    value.issue_number,
    'issue supervisor issue_number',
  );
  const state = {
    version: 1,
    lane_id: requireString(value.lane_id, 'issue supervisor lane_id'),
    issue_number: issueNumber,
    branch: requireString(value.branch, 'issue supervisor branch'),
    worktree: requireString(value.worktree, 'issue supervisor worktree'),
    starting_head_sha: requireSha(
      value.starting_head_sha,
      'issue supervisor starting_head_sha',
    ),
    head_sha: value.starting_head_sha,
    started_at: requireTimestamp(value.started_at, 'issue supervisor started_at'),
    authority_scope: requireAuthorityScope(value.authority_scope),
    retry_policy: requireRetryPolicy(value.retry_policy),
    lane_plan_approval_sha256: value.lane_plan_approval_sha256 ?? null,
    release_handoff: value.release_handoff === true,
    status: 'implementing',
    attempt: 0,
    verification: null,
    blockers: [],
    local_review: null,
    pr: null,
    ci: null,
    merge: null,
    cleanup: null,
  };
  assertIssueSupervisorState(state);
  return state;
};

export const transitionIssueSupervisor = (current, transition) => {
  assertIssueSupervisorState(current);
  const state = structuredClone(current);
  const step = requireRecord(transition, 'issue supervisor transition');
  if (step.kind === 'implementation-completed' || step.kind === 'fix-completed') {
    completeImplementation(state, step);
  } else if (step.kind === 'local-review') {
    localReview(state, step);
  } else if (step.kind === 'release-handoff') {
    parkReleaseHandoff(state, step);
  } else if (!applyRemoteTransition(state, step)) {
    throw new TypeError(
      `unknown issue supervisor transition: ${String(step.kind)}`,
    );
  }
  assertIssueSupervisorState(state);
  return state;
};
