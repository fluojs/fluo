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
import { verifyImplementerRuntime } from './implementer-runtime.mjs';
import { applyConflictResolution } from './conflict-resolution-policy.mjs';
import {
  requireRecord,
  requireSha,
  requireString,
} from './transition-contracts.mjs';
import {
  assertReviewBatch,
  assertReviewPreflight,
  requireFreshImplementer,
} from './review-loop-policy.mjs';
import {
  appendReviewBlockers,
  blockerLedgerDigest,
  remediateCurrentBlockers,
  unresolvedBlockerLedger,
} from './blocker-ledger.mjs';

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

const localReview = (state, step, observedEventSequence) => {
  requireStatus(state, 'local-review');
  const reviewBatch = assertReviewBatch({
    head_sha: state.head_sha,
    preflight: state.review_preflight,
    reviews: step.reviews,
    review_batch: step.review_batch,
    provenance: {
      repository_root: state.repository_root,
      parent_session_id: state.parent_session_id,
      lane_id: state.lane_id,
      issue_number: state.issue_number,
      worktree: state.worktree,
      branch: state.branch,
    },
  });
  const outcome = aggregateReviewerGate({
    head_sha: state.head_sha,
    reviews: step.reviews,
  });
  const readyVerdict = state.pr === null ? 'ready-for-pr' : 'ready-for-push';
  const verdict = {
    version: 2,
    lane_id: state.lane_id,
    issue_number: state.issue_number,
    verdict:
      outcome.verdict === 'merge' ? readyVerdict : outcome.verdict,
    head_sha: state.head_sha,
    reviewers: reviewerSignals(step.reviews),
    blockers: outcome.blockers,
    reviews: structuredClone(step.reviews),
    review_batch: reviewBatch,
  };
  assertContract('local-review-verdict', verdict);
  state.local_review = verdict;
  if (outcome.blockers.length > 0) {
    appendReviewBlockers(
      state,
      step.reviews,
      reviewBatch,
      observedEventSequence,
    );
  }
  if (outcome.verdict === 'merge') {
    state.status = readyVerdict;
    state.blockers = [];
  } else if (outcome.verdict === 'block') {
    state.blocked_heads_since_refresh += 1;
    const fixable = outcome.blockers.every(
      (blocker) => blocker.fix_back_eligible === true,
    );
    state.status = fixable ? 'implementing' : 'needs-human-check-terminal';
    state.blockers = outcome.blockers;
  } else {
    state.status = 'needs-human-check-terminal';
    state.blockers = [];
  }
};

const completeImplementation = (state, step) => {
  const newHead = requireSha(step.new_head, `${step.kind}.new_head`);
  const verification = requireString(
    step.verification,
    `${step.kind}.verification`,
  );
  if (newHead === state.head_sha) {
    throw new TypeError(`${step.kind} must produce a new head.`);
  }
  if (step.kind === 'implementation-completed') {
    requireStatus(state, 'implementing');
    if (state.attempt !== 0 || state.blockers.length !== 0 || state.pr !== null) {
      throw new TypeError(
        'blocked implementation requires fix-completed reconciliation.',
      );
    }
    if (step.implementer_generation !== state.implementer_generation) {
      throw new TypeError(
        'implementation-completed must bind the current implementer generation.',
      );
    }
    const evidence = requireRecord(
      step.implementer_evidence,
      'implementation-completed.implementer_evidence',
    );
    if (Object.keys(evidence).length !== 1) {
      throw new TypeError('implementer evidence must contain only the canonical task ID.');
    }
    const runtime = verifyImplementerRuntime({
      repository_root: state.repository_root,
      task_id: evidence.task_id,
      parent_session_id: state.parent_session_id,
      lane_id: state.lane_id,
      issue_number: state.issue_number,
      worktree: state.worktree,
      current_head: state.head_sha,
      new_head: newHead,
      generation: state.implementer_generation,
      result: step.kind,
      verification,
      addressed_blockers: [],
      blocker_ledger: state.blocker_ledger,
      unresolved_blockers: unresolvedBlockerLedger(state.blocker_ledger),
      blocker_ledger_sha256: blockerLedgerDigest(state.blocker_ledger),
      preflight_sha256: state.review_preflight.sha256,
    });
    if (state.implementer_tasks.some((task) => task.task_id === runtime.task_id)) {
      throw new TypeError('implementer task ID must not reuse persisted evidence.');
    }
    state.implementer_tasks.push(runtime);
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
      state.retry_policy.max_same_failure_repeats !== null &&
      (state.attempt >= state.retry_policy.max_same_failure_repeats ||
        elapsed > state.retry_policy.max_wall_clock_minutes * 60_000)
    ) {
      state.status = 'blocked-budget-exhausted';
      return;
    }
    assertBlockerReconciliation(state.blockers, step.addressed_blockers, []);
    const priorBlockers = structuredClone(state.blockers);
    const generation = requireFreshImplementer({
      blocked_heads_since_refresh: state.blocked_heads_since_refresh,
      implementer_generation: state.implementer_generation,
      fresh_implementer: step.fresh_implementer,
      reported_generation: step.implementer_generation,
      fresh_implementer_evidence: step.fresh_implementer_evidence,
    });
    const evidence = requireRecord(
      step.implementer_evidence ?? step.fresh_implementer_evidence,
      'fix-completed.implementer_evidence',
    );
    if (Object.keys(evidence).length !== 1) {
      throw new TypeError('implementer evidence must contain only the canonical task ID.');
    }
    const runtime = verifyImplementerRuntime({
      repository_root: state.repository_root,
      task_id: evidence.task_id,
      parent_session_id: state.parent_session_id,
      lane_id: state.lane_id,
      issue_number: state.issue_number,
      worktree: state.worktree,
      current_head: state.head_sha,
      new_head: newHead,
      generation,
      result: step.kind,
      verification,
      addressed_blockers: step.addressed_blockers,
      blocker_ledger: state.blocker_ledger,
      unresolved_blockers: unresolvedBlockerLedger(state.blocker_ledger),
      blocker_ledger_sha256: blockerLedgerDigest(state.blocker_ledger),
      preflight_sha256: state.review_preflight.sha256,
    });
    if (state.implementer_tasks.some((task) => task.task_id === runtime.task_id)) {
      throw new TypeError('implementer task ID must not reuse persisted evidence.');
    }
    state.implementer_tasks.push(runtime);
    if (generation !== state.implementer_generation) {
      state.implementer_generation = generation;
      state.blocked_heads_since_refresh = 0;
    }
    remediateCurrentBlockers(state, priorBlockers, newHead, {
      kind: step.kind,
      addressed_blockers: step.addressed_blockers,
      verification,
    });
    state.attempt += 1;
  }
  state.head_sha = newHead;
  state.verification = verification;
  state.status = 'local-review';
  state.blockers = [];
  state.local_review = null;
  state.ci = null;
};

const completePreflight = (state, step) => {
  requireStatus(state, 'preflight');
  const preflight = assertReviewPreflight(step.preflight);
  if (
    preflight.lane_id !== state.lane_id ||
    preflight.issue_number !== state.issue_number ||
    preflight.issue_contract_revision !== state.issue_contract_revision ||
    preflight.issue_contract_sha256 !== state.issue_contract_sha256 ||
    preflight.head_sha !== state.starting_head_sha ||
    preflight.lane_plan_approval_sha256 !== state.lane_plan_approval_sha256 ||
    (state.preflight_authority !== null &&
      (JSON.stringify(preflight.acceptance_row_ids) !==
        JSON.stringify(state.preflight_authority.canonical_acceptance_ids) ||
        JSON.stringify(preflight.rows.map(({ id }) => id)) !==
          JSON.stringify(state.preflight_authority.canonical_acceptance_ids) ||
        preflight.rows.some((row, index) => {
          const criterion = state.preflight_authority.canonical_acceptance_criteria[index];
          return row.acceptance_text !== criterion?.content ||
            row.acceptance_sha256 !== criterion?.content_sha256;
        }) ||
        state.preflight_authority.canonical_sources.some((canonical) =>
          !preflight.approved_sources.some(
            (source) => JSON.stringify(source) === JSON.stringify(canonical),
          ),
        )))
  ) {
    throw new TypeError(
      'review preflight must bind the issue contract and starting head.',
    );
  }
  state.review_preflight = preflight;
  state.status = 'implementing';
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
  if (value.review_policy !== 'preflight-v1') {
    throw new TypeError(
      'new issue supervisor state requires review_policy preflight-v1.',
    );
  }
  const issueNumber = requirePositiveInteger(
    value.issue_number,
    'issue supervisor issue_number',
  );
  const state = {
    version: 2,
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
    repository_root: requireString(value.repository_root, 'issue supervisor repository_root'),
    parent_session_id: requireString(value.parent_session_id, 'issue supervisor parent_session_id'),
    issue_contract_revision: requireString(
      value.issue_contract_revision,
      'issue supervisor issue_contract_revision',
    ),
    issue_contract_sha256: requireString(
      value.issue_contract_sha256,
      'issue supervisor issue_contract_sha256',
    ),
    preflight_authority: value.preflight_authority ?? null,
    authority_scope: requireAuthorityScope(value.authority_scope),
    retry_policy: requireRetryPolicy(value.retry_policy),
    lane_plan_approval_sha256: value.lane_plan_approval_sha256 ?? null,
    release_handoff: value.release_handoff === true,
    status: 'preflight',
    attempt: 0,
    review_policy: 'preflight-v1',
    implementer_generation: 1,
    blocked_heads_since_refresh: 0,
    review_preflight: null,
    blocker_ledger: [],
    implementer_tasks: [],
    verification: null,
    blockers: [],
    local_review: null,
    pr: null,
    ci: null,
    conflict_receipt: null,
    conflict_resolution: null,
    merge: null,
    cleanup: null,
    last_observed_at: value.started_at,
    last_observed_event_sequence: 1,
  };
  assertIssueSupervisorState(state);
  return state;
};

export const transitionIssueSupervisor = (
  current,
  transition,
  { observedEventSequence, now = Date.now() } = {},
) => {
  assertIssueSupervisorState(current);
  const state = structuredClone(current);
  const step = requireRecord(transition, 'issue supervisor transition');
  const observedAtValue = step.observed_at ?? step.receipt?.observed_at;
  if (observedAtValue !== undefined) {
    const observedAt = requireTimestamp(observedAtValue, `${String(step.kind)}.observed_at`);
    const observedTime = Date.parse(observedAt);
    const nowValue = typeof now === 'function' ? now() : now;
    if (
      observedTime < Date.parse(state.started_at) ||
      observedTime < Date.parse(state.last_observed_at) ||
      observedTime > nowValue ||
      (observedEventSequence !== undefined &&
        (!Number.isSafeInteger(observedEventSequence) ||
          observedEventSequence <= state.last_observed_event_sequence))
    ) {
      throw new TypeError('issue supervisor observation timestamp is stale, future, or out of sequence.');
    }
    state.last_observed_at = observedAt;
    if (observedEventSequence !== undefined) {
      state.last_observed_event_sequence = observedEventSequence;
    }
  }
  if (
    [
      'blocker_ledger',
      'unresolved_blockers',
      'unresolved_blocker_ledger',
      'blocker_ledger_sha256',
    ].some(
      (key) => Object.hasOwn(step, key),
    )
  ) {
    throw new TypeError(
      'caller-authored blocker ledger data is not accepted by supervisor transitions.',
    );
  }
  if (step.kind === 'preflight-completed') {
    completePreflight(state, step);
  } else if (
    step.kind === 'implementation-completed' ||
    step.kind === 'fix-completed'
  ) {
    completeImplementation(state, step);
  } else if (step.kind === 'local-review') {
    localReview(state, step, observedEventSequence);
  } else if (step.kind === 'conflict-resolved') {
    applyConflictResolution(state, step);
  } else if (step.kind === 'release-handoff') {
    parkReleaseHandoff(state, step);
  } else if (!applyRemoteTransition(state, step, observedEventSequence)) {
    throw new TypeError(
      `unknown issue supervisor transition: ${String(step.kind)}`,
    );
  }
  assertIssueSupervisorState(state);
  return state;
};
