import {
  requirePrIdentity,
  requireTargetReceipt,
} from './issue-supervisor-receipts.mjs';
import { requireSha, requireString } from './transition-contracts.mjs';

const requireStatus = (state, ...allowed) => {
  if (!allowed.includes(state.status)) {
    throw new TypeError(
      `${state.status} cannot accept this transition; expected ${allowed.join(' or ')}.`,
    );
  }
};

const observePr = (state, step) => {
  requireStatus(state, 'ready-for-pr', 'ready-for-push');
  if (!state.authority_scope.pr_creation) {
    throw new TypeError('authority_scope.pr_creation is required.');
  }
  const expectedKind =
    state.status === 'ready-for-pr' ? 'pr-create' : 'pr-update';
  const receipt = requireTargetReceipt(state, step.receipt, expectedKind);
  if (
    (state.status === 'ready-for-pr' && step.action !== 'create') ||
    (state.status === 'ready-for-push' && step.action !== 'update')
  ) {
    throw new TypeError('PR observation action does not match local readiness.');
  }
  if (
    receipt.remote_head_sha !== state.head_sha ||
    receipt.pr_head_sha !== state.head_sha
  ) {
    throw new TypeError('PR receipt must bind local, remote, and PR heads.');
  }
  state.pr = requirePrIdentity(receipt, state.pr);
  state.pr.receipt = receipt;
  state.status = 'ci-pending';
};

const observeCi = (state, step) => {
  requireStatus(state, 'ci-pending');
  const receipt = requireTargetReceipt(state, step.receipt, 'ci');
  requirePrIdentity(receipt, state.pr);
  const evidence = requireString(receipt.evidence, 'ci receipt evidence');
  state.ci = { ...receipt, evidence };
  if (receipt.result === 'pass') {
    state.status = 'merge-ready';
    return;
  }
  const fixable = receipt.result === 'fixable-failure';
  if (!fixable && receipt.result !== 'external-failure') {
    throw new TypeError(
      'CI result must be pass, fixable-failure, or external-failure.',
    );
  }
  state.status = fixable ? 'ci-fix-back' : 'needs-human-check-terminal';
  state.blockers = [
    {
      reviewer: 'verification',
      signature: fixable
        ? 'ci:required-check:failed'
        : 'ci:external:blocked',
      evidence,
      fix_back_eligible: fixable,
      status: 'unresolved',
    },
  ];
};

const observeMerge = (state, step) => {
  requireStatus(state, 'merge-ready');
  if (!state.authority_scope.pr_merge) {
    throw new TypeError('authority_scope.pr_merge is required.');
  }
  const receipt = requireTargetReceipt(state, step.receipt, 'merge');
  requirePrIdentity(receipt, state.pr);
  if (
    [
      receipt.reviewed_head_sha,
      receipt.remote_head_sha,
      receipt.pr_head_sha,
      receipt.ci_head_sha,
    ].some((head) => head !== state.head_sha) ||
    receipt.merge_method !== 'squash' ||
    receipt.pr_state !== 'MERGED' ||
    receipt.issue_state !== 'CLOSED'
  ) {
    throw new TypeError(
      'merge receipt must bind reviewed, remote, PR, and CI heads.',
    );
  }
  state.merge = {
    commit_sha: requireSha(
      receipt.merge_commit_sha,
      'merge-observed.merge_commit_sha',
    ),
    head_sha: state.head_sha,
    receipt,
  };
  state.status = 'merged';
};

const observeCleanup = (state, step) => {
  requireStatus(state, 'merged');
  const receipt = requireTargetReceipt(state, step.receipt, 'cleanup');
  requirePrIdentity(receipt, state.pr);
  const authorized = state.authority_scope.cleanup_command_worktrees;
  const complete = authorized
    ?
    receipt.worktree_removed === true &&
    receipt.local_branch_deleted === true &&
      receipt.remote_branch_deleted === true
    : receipt.status === 'skipped-authority';
  state.cleanup = authorized
    ? {
        status: 'done',
        worktree_removed: receipt.worktree_removed === true,
        local_branch_deleted: receipt.local_branch_deleted === true,
        remote_branch_deleted: receipt.remote_branch_deleted === true,
        receipt,
      }
    : { status: 'skipped-authority', receipt };
  state.status = complete ? 'done' : 'blocked-terminal';
};

export const applyRemoteTransition = (state, step) => {
  switch (step.kind) {
    case 'pr-observed':
      observePr(state, step);
      return true;
    case 'ci-observed':
      observeCi(state, step);
      return true;
    case 'merge-observed':
      observeMerge(state, step);
      return true;
    case 'cleanup-observed':
      observeCleanup(state, step);
      return true;
    default:
      return false;
  }
};
