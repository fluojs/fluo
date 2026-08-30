import {
  assertContract,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import { isStrictRfc3339DateTime } from '../../../workflow-contracts/schema-validator.mjs';
import {
  requireRecord,
  requireSha,
  requireString,
} from './transition-contracts.mjs';
import {
  assertPersistedReceipt,
  requirePrIdentity,
  requireTargetReceipt,
} from './issue-supervisor-receipts.mjs';
import {
  assertReviewBatch,
  assertReviewPreflight,
} from './review-loop-policy.mjs';
import {
  assertConflictResolutionEvidence,
  hasResolvedHeadPasses,
} from './conflict-resolution-policy.mjs';
import { assertPreflightAuthority } from './preflight-authority.mjs';
import { assertBlockerLedger } from './blocker-ledger.mjs';
import { issueDagKey } from './issue-dag-contracts.mjs';

export const issueSupervisorTerminalStatuses = Object.freeze([
  'done',
  'needs-human-check-terminal',
  'blocked-child-contract-error',
  'blocked-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
]);

const statuses = new Set([
  'preflight',
  'implementing',
  'local-review',
  'ready-for-pr',
  'ready-for-push',
  'ci-pending',
  'ci-fix-back',
  'conflict-resolution',
  'merge-ready',
  'merged',
  ...issueSupervisorTerminalStatuses,
]);

const prStatuses = new Set([
  'ready-for-push',
  'ci-pending',
  'ci-fix-back',
  'merge-ready',
  'merged',
  'done',
]);

const localReviewStatuses = new Set([
  'ready-for-pr',
  'ready-for-push',
  'ci-pending',
  'merge-ready',
  'merged',
  'done',
]);

export const requirePositiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
};

export const requireTimestamp = (value, name) => {
  const timestamp = requireString(value, name);
  if (!isStrictRfc3339DateTime(timestamp)) {
    throw new TypeError(`${name} must be a strict RFC 3339 timestamp.`);
  }
  return timestamp;
};

export const requireAuthorityScope = (value) => {
  const scope = requireRecord(value, 'issue supervisor authority_scope');
  for (const key of [
    'pr_creation',
    'pr_merge',
    'cleanup_command_worktrees',
  ]) {
    if (typeof scope[key] !== 'boolean') {
      throw new TypeError(`authority_scope.${key} must be boolean.`);
    }
  }
  return {
    pr_creation: scope.pr_creation,
    pr_merge: scope.pr_merge,
    cleanup_command_worktrees: scope.cleanup_command_worktrees,
  };
};

export const requireRetryPolicy = (value) => {
  const policy = requireRecord(value, 'issue supervisor retry_policy');
  if (
    typeof policy.retry_count_is_terminal !== 'boolean' ||
    policy.stop_on_child_contract_error !== true
  ) {
    throw new TypeError(
      'retry policy requires an explicit retry mode and terminal child contract errors.',
    );
  }
  const maxSameFailureRepeats =
    policy.max_same_failure_repeats === null
      ? null
      : requirePositiveInteger(
          policy.max_same_failure_repeats,
          'retry_policy.max_same_failure_repeats',
        );
  const maxWallClockMinutes =
    policy.max_wall_clock_minutes === null
      ? null
      : requirePositiveInteger(
          policy.max_wall_clock_minutes,
          'retry_policy.max_wall_clock_minutes',
        );
  const hasBoundedLimits =
    maxSameFailureRepeats !== null && maxWallClockMinutes !== null;
  const hasAdaptiveLimits =
    maxSameFailureRepeats === null && maxWallClockMinutes === null;
  if (
    (!hasBoundedLimits && !hasAdaptiveLimits) ||
    (policy.retry_count_is_terminal && !hasBoundedLimits)
  ) {
    throw new TypeError(
      'retry policy limits must be positive terminal bounds or null adaptive telemetry.',
    );
  }
  return {
    retry_count_is_terminal: policy.retry_count_is_terminal,
    max_same_failure_repeats: maxSameFailureRepeats,
    max_wall_clock_minutes: maxWallClockMinutes,
    stop_on_child_contract_error: true,
  };
};

export const coordinatorSessionIds = (state) =>
  state.coordinator_session_ids ?? [state.parent_session_id];

export const currentCoordinatorSessionId = (state) =>
  state.active_coordinator_session_id ?? state.parent_session_id;

const requireCanonicalIdentity = (state) => {
  const issueNumber = requirePositiveInteger(
    state.issue_number,
    'issue supervisor issue_number',
  );
  const branch = requireString(state.branch, 'issue supervisor branch');
  const branchPattern = new RegExp(
    `^issue-${String(issueNumber)}-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`,
    'u',
  );
  if (!branchPattern.test(branch)) {
    throw new TypeError('issue supervisor branch must use the canonical issue branch.');
  }
  if (state.worktree !== `.worktrees/${branch}`) {
    throw new TypeError('issue supervisor worktree must match its branch.');
  }
};

export const assertIssueSupervisorState = (input) => {
  const state = requireRecord(input, 'issue supervisor state');
  if (state.version !== 2 || !statuses.has(state.status)) {
    throw new TypeError('issue supervisor state invariant failed: version or status.');
  }
  requireString(state.lane_id, 'issue supervisor lane_id');
  requireCanonicalIdentity(state);
  requireSha(state.starting_head_sha, 'issue supervisor starting_head_sha');
  requireSha(state.head_sha, 'issue supervisor head_sha');
  requireTimestamp(state.started_at, 'issue supervisor started_at');
  requireTimestamp(state.last_observed_at, 'issue supervisor last_observed_at');
  if (
    Date.parse(state.last_observed_at) < Date.parse(state.started_at) ||
    !Number.isSafeInteger(state.last_observed_event_sequence) ||
    state.last_observed_event_sequence < 1
  ) {
    throw new TypeError('issue supervisor state invariant failed: observation sequence.');
  }
  requireString(state.repository_root, 'issue supervisor repository_root');
  requireString(state.parent_session_id, 'issue supervisor parent_session_id');
  const sessionIds = coordinatorSessionIds(state);
  const activeSessionId = currentCoordinatorSessionId(state);
  if (
    !Array.isArray(sessionIds) ||
    sessionIds.length === 0 ||
    sessionIds.some(
      (sessionId) =>
        typeof sessionId !== 'string' || sessionId.length === 0,
    ) ||
    new Set(sessionIds).size !== sessionIds.length ||
    sessionIds[0] !== state.parent_session_id ||
    !sessionIds.includes(activeSessionId)
  ) {
    throw new TypeError(
      'issue supervisor coordinator session history is invalid.',
    );
  }
  if (typeof state.release_handoff !== 'boolean') {
    throw new TypeError(
      'issue supervisor state invariant failed: release_handoff.',
    );
  }
  const authority = requireAuthorityScope(state.authority_scope);
  const retryPolicy = requireRetryPolicy(state.retry_policy);
  if (
      state.review_policy !== 'preflight-v1' ||
      typeof state.issue_contract_revision !== 'string' ||
      state.issue_contract_revision.length === 0 ||
      !/^[a-f0-9]{64}$/u.test(state.issue_contract_sha256 ?? '') ||
      !/^[a-f0-9]{64}$/u.test(state.lane_plan_approval_sha256 ?? '') ||
      !Number.isSafeInteger(state.implementer_generation) ||
      state.implementer_generation < 1 ||
      !Number.isSafeInteger(state.blocked_heads_since_refresh) ||
      state.blocked_heads_since_refresh < 0 ||
      !Array.isArray(state.blocker_ledger) ||
      !Array.isArray(state.implementer_tasks)
  ) {
    throw new TypeError(
      'issue supervisor state invariant failed: review loop telemetry.',
    );
  }
  if (state.review_preflight !== null) {
    assertBlockerLedger(state);
  } else if (state.blocker_ledger.length !== 0) {
    throw new TypeError('preflight state cannot contain blocker history.');
  }
  if (state.preflight_authority !== null) {
    const authority = assertPreflightAuthority(state.preflight_authority);
    if (
      authority.lane_id !== state.lane_id ||
      authority.issue_number !== state.issue_number ||
      authority.issue_contract_revision !== state.issue_contract_revision ||
      authority.issue_contract_sha256 !== state.issue_contract_sha256 ||
      authority.lane_plan_approval_sha256 !== state.lane_plan_approval_sha256
    ) {
      throw new TypeError('issue supervisor state invariant failed: preflight authority.');
    }
  }
  const taskIds = new Set();
  for (const task of state.implementer_tasks) {
      if (
        typeof task?.task_id !== 'string' ||
        !/^st_[A-Za-z0-9_-]+$/u.test(task.task_id) ||
        taskIds.has(task.task_id) ||
        task.provider !== 'openai-codex' ||
        task.model_id !== 'gpt-5.6-terra' ||
        task.thinking_level !== 'high' ||
        !Number.isSafeInteger(task.generation) ||
        task.generation < 1 ||
        !/^[a-f0-9]{64}$/u.test(task.record_sha256 ?? '') ||
        !/^[a-f0-9]{64}$/u.test(task.output_sha256 ?? '') ||
        !/^[a-f0-9]{64}$/u.test(task.session_sha256 ?? '') ||
        payloadDigest(task.final_response) !== task.output_sha256 ||
        task.lane_id !== state.lane_id ||
        task.issue_number !== state.issue_number ||
        task.worktree !== state.worktree ||
        !sessionIds.includes(task.parent_session_id) ||
        task.dag_key !== issueDagKey(state.lane_id, state.issue_number) ||
        typeof task.dag_run_id !== 'string' ||
        typeof task.dag_node_id !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(task.dag_owner_fingerprint ?? '') ||
        !Array.isArray(task.blocker_ledger) ||
        !Array.isArray(task.unresolved_blockers) ||
        payloadDigest(task.blocker_ledger) !== task.blocker_ledger_sha256
      ) {
        throw new TypeError('issue supervisor state invariant failed: implementer task evidence.');
      }
      taskIds.add(task.task_id);
  }
  if (state.review_preflight === null) {
    if (state.status !== 'preflight') {
      throw new TypeError(
        'issue supervisor state invariant failed: review preflight required.',
      );
    }
  } else {
    assertReviewPreflight(state.review_preflight);
    if (
        state.review_preflight.lane_id !== state.lane_id ||
        state.review_preflight.issue_number !== state.issue_number ||
        state.review_preflight.issue_contract_revision !==
          state.issue_contract_revision ||
        state.review_preflight.issue_contract_sha256 !==
          state.issue_contract_sha256 ||
        state.review_preflight.head_sha !== state.starting_head_sha ||
        state.review_preflight.lane_plan_approval_sha256 !==
          state.lane_plan_approval_sha256 ||
        (state.preflight_authority !== null &&
          (JSON.stringify(state.review_preflight.acceptance_row_ids) !==
            JSON.stringify(state.preflight_authority.canonical_acceptance_ids) ||
            JSON.stringify(state.review_preflight.rows.map(({ id }) => id)) !==
              JSON.stringify(state.preflight_authority.canonical_acceptance_ids) ||
            state.preflight_authority.canonical_sources.some((canonical) =>
              !state.review_preflight.approved_sources.some(
                (source) => JSON.stringify(source) === JSON.stringify(canonical),
              ),
            ))) ||
        state.status === 'preflight'
    ) {
      throw new TypeError(
        'issue supervisor state invariant failed: review preflight binding.',
      );
    }
  }
  if (
    !Number.isSafeInteger(state.attempt) ||
    state.attempt < 0 ||
    (retryPolicy.max_same_failure_repeats !== null &&
      state.attempt > retryPolicy.max_same_failure_repeats)
  ) {
    throw new TypeError('issue supervisor state invariant failed: attempt.');
  }
  if (!Array.isArray(state.blockers)) {
    throw new TypeError('issue supervisor state invariant failed: blockers.');
  }
  if (
    state.status === 'blocked-child-contract-error' &&
    (state.blockers.length !== 1 ||
      state.blockers[0]?.reviewer !== 'verification' ||
      typeof state.blockers[0]?.signature !== 'string' ||
      state.blockers[0].signature.length === 0 ||
      typeof state.blockers[0]?.evidence !== 'string' ||
      state.blockers[0].evidence.length === 0 ||
      state.blockers[0]?.fix_back_eligible !== false ||
      state.blockers[0]?.status !== 'unresolved')
  ) {
    throw new TypeError(
      'issue supervisor state invariant failed: child contract blocker.',
    );
  }
  if (state.local_review !== null) {
    assertContract('local-review-verdict', state.local_review);
    assertReviewBatch({
      head_sha: state.local_review.head_sha,
      preflight: state.review_preflight,
      reviews: state.local_review.reviews,
      review_batch: state.local_review.review_batch,
    });
    for (const receipt of Object.values(state.local_review.review_batch.reviewer_receipts)) {
      if (
        !sessionIds.includes(receipt.parent_session_id) ||
        receipt.lane_id !== state.lane_id ||
        receipt.issue_number !== state.issue_number ||
        receipt.worktree !== state.worktree
      ) {
        throw new TypeError('issue supervisor state invariant failed: reviewer provenance receipt.');
      }
    }
    if (
      state.local_review.head_sha !== state.head_sha &&
      !(
        hasResolvedHeadPasses(state) &&
        state.conflict_resolution.previously_reviewed_head ===
          state.local_review.head_sha
      )
    ) {
      throw new TypeError('issue supervisor state invariant failed: local review head.');
    }
  } else if (
    localReviewStatuses.has(state.status) &&
    !(state.status === 'ci-pending' && hasResolvedHeadPasses(state))
  ) {
    throw new TypeError('issue supervisor state invariant failed: local review required.');
  }
  if (
    state.status === 'conflict-resolution' &&
    (state.conflict_receipt === null || state.conflict_receipt.head_sha !== state.head_sha)
  ) {
    throw new TypeError('issue supervisor state invariant failed: conflict receipt required.');
  }
  if (state.conflict_resolution != null) {
    if (state.conflict_receipt !== null) {
      throw new TypeError('issue supervisor state invariant failed: resolved conflict review evidence.');
    }
    assertConflictResolutionEvidence(state);
    assertPersistedReceipt(state, state.conflict_resolution.conflict_receipt);
  }
  if (prStatuses.has(state.status) && state.pr === null) {
    throw new TypeError('issue supervisor state invariant failed: PR required.');
  }
  if (state.pr !== null) {
    const prReceipt = requireTargetReceipt(
      { ...state, head_sha: state.pr.receipt?.head_sha },
      state.pr.receipt,
      state.pr.receipt?.kind,
    );
    requirePrIdentity(prReceipt, state.pr);
    if (prReceipt.kind === 'pr-adopt' && prReceipt.pr_state !== 'OPEN') {
      throw new TypeError('adopted PR must be OPEN.');
    }
    if (
      prReceipt.kind === 'pr-adopt' &&
      prReceipt.pr_head_ref_name !== state.branch
    ) {
      throw new TypeError('adopted PR must match the supervisor branch.');
    }
    if (
      !['pr-adopt', 'pr-create', 'pr-update'].includes(prReceipt.kind) ||
      (['ci-pending', 'ci-fix-back', 'merge-ready', 'merged', 'done'].includes(
        state.status,
      ) &&
        (prReceipt.remote_head_sha !== state.head_sha ||
          prReceipt.pr_head_sha !== state.head_sha))
    ) {
      throw new TypeError('issue supervisor state invariant failed: PR receipt.');
    }
  }
  if (state.ci !== null) {
    const ciReceipt = requireTargetReceipt(state, state.ci, 'ci');
    requirePrIdentity(ciReceipt, state.pr);
    if (!['pass', 'fixable-failure', 'external-failure'].includes(ciReceipt.result)) {
      throw new TypeError('issue supervisor state invariant failed: CI receipt.');
    }
  }
  if (
    ['merge-ready', 'merged', 'done'].includes(state.status) &&
    (state.ci === null ||
      state.ci.result !== 'pass' ||
      state.ci.head_sha !== state.head_sha)
  ) {
    throw new TypeError('issue supervisor state invariant failed: passing CI required.');
  }
  if (['merged', 'done'].includes(state.status) && state.merge === null) {
    throw new TypeError('issue supervisor state invariant failed: merge required.');
  }
  if (state.merge !== null) {
    const mergeReceipt = requireTargetReceipt(
      state,
      state.merge.receipt,
      'merge',
    );
    requirePrIdentity(mergeReceipt, state.pr);
    if (
      mergeReceipt.merge_commit_sha !== state.merge.commit_sha ||
      [
        mergeReceipt.reviewed_head_sha,
        mergeReceipt.remote_head_sha,
        mergeReceipt.pr_head_sha,
        mergeReceipt.ci_head_sha,
      ].some((head) => head !== state.head_sha)
    ) {
      throw new TypeError('issue supervisor state invariant failed: merge receipt.');
    }
  }
  if (state.cleanup !== null) {
    const cleanupReceipt = requireTargetReceipt(
      state,
      state.cleanup.receipt,
      'cleanup',
    );
    requirePrIdentity(cleanupReceipt, state.pr);
  }
  if (
    state.status === 'done' &&
    (state.cleanup === null ||
      (authority.cleanup_command_worktrees
        ? state.cleanup.status !== 'done' ||
          !state.cleanup.worktree_removed ||
          !state.cleanup.local_branch_deleted ||
          !state.cleanup.remote_branch_deleted
        : state.cleanup.status !== 'skipped-authority'))
  ) {
    throw new TypeError('issue supervisor state invariant failed: cleanup required.');
  }
  return { state, authority, retryPolicy };
};
