import {
  assert,
  hasExactKeys,
  isNonEmptyString,
  isObject,
  progressStatuses,
} from './lane-ledger-contract.mjs';

const baseKeys = ['status', 'branch', 'worktree', 'pr', 'verification', 'retry_count', 'blockers'];
const completionKeys = [
  'review_verdict',
  'checks',
  'reviewers',
  'reviewed_head',
  'commits',
  'merge_commit',
  'issue_state',
];
const reviewerKeys = ['contract', 'code', 'verification'];
const blockerKeys = ['reviewer', 'signature', 'evidence', 'fix_back_eligible', 'status'];
const blockerReviewers = new Set(['contract', 'code', 'verification']);
const baseKeySet = new Set(baseKeys);
const mergedKeySet = new Set([...baseKeys, ...completionKeys]);
const doneKeySet = new Set([...mergedKeySet, 'cleanup']);
const completionKeySet = new Set([...completionKeys, 'cleanup']);
const migrationGuidance = 'migrate legacy completion evidence to canonical issue_progress';

function validateBlockers(path, blockers) {
  assert(Array.isArray(blockers), path, 'blockers must be an array when present');
  for (const blocker of blockers) {
    assert(
      isObject(blocker) && hasExactKeys(blocker, blockerKeys),
      path,
      'blocker must contain exactly reviewer/signature/evidence/fix_back_eligible/status',
    );
    assert(blockerReviewers.has(blocker.reviewer), path, 'blocker reviewer must be contract, code, or verification');
    assert(isNonEmptyString(blocker.signature) && isNonEmptyString(blocker.evidence), path, 'blocker signature and evidence must be non-empty');
    assert(typeof blocker.fix_back_eligible === 'boolean', path, 'blocker fix_back_eligible must be boolean');
    assert(isNonEmptyString(blocker.status), path, 'blocker status must be non-empty');
  }
}

function forbiddenKeyMessage(progress, key) {
  if (key !== 'cleanup') {
    return completionKeySet.has(key)
      ? `${String(progress.status)} progress must not contain completion evidence; ${migrationGuidance}`
      : 'issue progress contains an unknown key';
  }
  const cleanupStatus = isObject(progress.cleanup) ? progress.cleanup.status : progress.cleanup;
  if (cleanupStatus === 'done') {
    return 'cleanup done is only valid for done issue_progress';
  }
  if (cleanupStatus === 'skipped-authority') {
    return 'cleanup skipped-authority is only valid for done issue_progress';
  }
  return 'cleanup evidence is only valid for done issue_progress';
}

export function validateProgressShape(path, progress) {
  assert(progressStatuses.has(progress.status), path, `invalid issue_progress.status: ${String(progress.status)}`);
  const allowedKeys = progress.status === 'done' ? doneKeySet : progress.status === 'merged' ? mergedKeySet : baseKeySet;
  const forbiddenKey = Object.keys(progress).find((key) => !allowedKeys.has(key));
  assert(forbiddenKey === undefined, path, forbiddenKeyMessage(progress, forbiddenKey));
  if (progress.reviewers !== undefined) {
    assert(
      isObject(progress.reviewers) && hasExactKeys(progress.reviewers, reviewerKeys),
      path,
      `reviewers must contain exactly contract/code/verification; ${migrationGuidance}`,
    );
  }
  if (progress.blockers !== undefined) {
    validateBlockers(path, progress.blockers);
  }
}
