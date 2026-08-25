import {
  requireRecord,
  requireString,
} from './transition-contracts.mjs';

const requirePositiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
};

const requireTimestamp = (value, name) => {
  const timestamp = requireString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new TypeError(`${name} must be an ISO timestamp.`);
  }
  return timestamp;
};

export const requireTargetReceipt = (state, value, kind) => {
  const receipt = requireRecord(value, `${kind} receipt`);
  if (
    receipt.kind !== kind ||
    receipt.authority !== 'issue-supervisor' ||
    receipt.lane_id !== state.lane_id ||
    receipt.issue_number !== state.issue_number ||
    receipt.branch !== state.branch ||
    receipt.worktree !== state.worktree ||
    receipt.head_sha !== state.head_sha
  ) {
    throw new TypeError(
      `${kind} receipt must bind supervisor identity and current head.`,
    );
  }
  requireTimestamp(receipt.observed_at, `${kind} receipt observed_at`);
  return receipt;
};

export const requirePrIdentity = (receipt, existingPr = null) => {
  const number = requirePositiveInteger(receipt.pr_number, 'receipt pr_number');
  const url = requireString(receipt.pr_url, 'receipt pr_url');
  const match =
    /^https:\/\/github\.com\/fluojs\/fluo\/pull\/([1-9]\d*)$/u.exec(url);
  if (
    match === null ||
    Number(match[1]) !== number ||
    (existingPr !== null &&
      (existingPr.number !== number || existingPr.url !== url))
  ) {
    throw new TypeError('receipt must preserve canonical PR identity.');
  }
  return { number, url };
};

export const assertPersistedReceipt = (supervisor, value) => {
  const receipt = requireRecord(value, 'persisted supervisor receipt');
  const historicalState = { ...supervisor, head_sha: receipt.head_sha };
  requireTargetReceipt(historicalState, receipt, receipt.kind);
  if (
    !['pr-create', 'pr-update', 'ci', 'merge', 'cleanup'].includes(receipt.kind)
  ) {
    throw new TypeError('persisted supervisor receipt kind is invalid.');
  }
  requirePrIdentity(receipt);
  if (
    ['pr-create', 'pr-update'].includes(receipt.kind) &&
    (receipt.remote_head_sha !== receipt.head_sha ||
      receipt.pr_head_sha !== receipt.head_sha)
  ) {
    throw new TypeError('persisted PR receipt heads must match.');
  }
  if (
    receipt.kind === 'merge' &&
    [
      receipt.reviewed_head_sha,
      receipt.remote_head_sha,
      receipt.pr_head_sha,
      receipt.ci_head_sha,
    ].some((head) => head !== receipt.head_sha)
  ) {
    throw new TypeError('persisted merge receipt heads must match.');
  }
  if (
    receipt.kind === 'merge' &&
    (receipt.merge_method !== 'squash' ||
      receipt.pr_state !== 'MERGED' ||
      receipt.issue_state !== 'CLOSED' ||
      !/^[a-f0-9]{40}$/u.test(receipt.merge_commit_sha))
  ) {
    throw new TypeError('persisted merge receipt outcome is invalid.');
  }
  if (
    receipt.kind === 'cleanup' &&
    receipt.status !== 'skipped-authority' &&
    (receipt.worktree_removed !== true ||
      receipt.local_branch_deleted !== true ||
      receipt.remote_branch_deleted !== true)
  ) {
    throw new TypeError('persisted cleanup receipt is incomplete.');
  }
};
