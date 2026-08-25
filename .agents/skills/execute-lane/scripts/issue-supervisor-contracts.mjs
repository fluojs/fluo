import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import {
  requireRecord,
  requireSha,
  requireString,
} from './transition-contracts.mjs';
import {
  requirePrIdentity,
  requireTargetReceipt,
} from './issue-supervisor-receipts.mjs';

const statuses = new Set([
  'implementing',
  'local-review',
  'ready-for-pr',
  'ready-for-push',
  'ci-pending',
  'ci-fix-back',
  'merge-ready',
  'merged',
  'done',
  'needs-human-check-terminal',
  'blocked-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
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
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new TypeError(`${name} must be an ISO timestamp.`);
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
  if (state.version !== 1 || !statuses.has(state.status)) {
    throw new TypeError('issue supervisor state invariant failed: version or status.');
  }
  requireString(state.lane_id, 'issue supervisor lane_id');
  requireCanonicalIdentity(state);
  requireSha(state.starting_head_sha, 'issue supervisor starting_head_sha');
  requireSha(state.head_sha, 'issue supervisor head_sha');
  requireTimestamp(state.started_at, 'issue supervisor started_at');
  if (typeof state.release_handoff !== 'boolean') {
    throw new TypeError(
      'issue supervisor state invariant failed: release_handoff.',
    );
  }
  const authority = requireAuthorityScope(state.authority_scope);
  const retryPolicy = requireRetryPolicy(state.retry_policy);
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
  if (state.local_review !== null) {
    assertContract('local-review-verdict', state.local_review);
    if (state.local_review.head_sha !== state.head_sha) {
      throw new TypeError('issue supervisor state invariant failed: local review head.');
    }
  } else if (localReviewStatuses.has(state.status)) {
    throw new TypeError('issue supervisor state invariant failed: local review required.');
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
    if (
      !['pr-create', 'pr-update'].includes(prReceipt.kind) ||
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
