import {
  assert,
  hasExactKeys,
  isMatchingWorktree,
  isNonEmptyString,
  isObject,
  isPositiveInteger,
  isSafeBranchName,
  isSha,
  parsePullRequest,
  progressStatuses,
  registerPullRequest,
} from './lane-ledger-contract.mjs';

const reviewerKeys = ['contract', 'code', 'verification'];
const completedCleanupKeys = ['status', 'worktree_removed', 'local_branch_deleted', 'remote_branch_deleted'];
const skippedCleanupKeys = ['status'];
const blockerKeys = ['reviewer', 'signature', 'evidence', 'fix_back_eligible', 'status'];
const progressKeys = new Set([
  'status',
  'branch',
  'worktree',
  'pr',
  'verification',
  'retry_count',
  'review_verdict',
  'checks',
  'reviewers',
  'reviewed_head',
  'commits',
  'merge_commit',
  'cleanup',
  'issue_state',
  'blockers',
]);
const blockerReviewers = new Set(['contract', 'code', 'verification']);
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

function validateProgressShape(path, progress) {
  assert(Object.keys(progress).every((key) => progressKeys.has(key)), path, 'issue progress contains an unknown key');
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

function validateDoneCleanup(path, cleanup, cleanupAuthority) {
  const expectedStatus = cleanupAuthority ? 'done' : 'skipped-authority';
  assert(isObject(cleanup), path, `cleanup must be ${expectedStatus} when cleanup authority is ${String(cleanupAuthority)}; ${migrationGuidance}`);
  assert(cleanup.status === expectedStatus, path, `cleanup must be ${expectedStatus} when cleanup authority is ${String(cleanupAuthority)}`);
  if (cleanupAuthority) {
    assert(
      hasExactKeys(cleanup, completedCleanupKeys),
      path,
      'cleanup done must contain exactly status/worktree_removed/local_branch_deleted/remote_branch_deleted',
    );
    assert(cleanup.worktree_removed === true, path, 'cleanup done requires worktree_removed=true');
    assert(cleanup.local_branch_deleted === true, path, 'cleanup done requires local_branch_deleted=true');
    assert(cleanup.remote_branch_deleted === true, path, 'cleanup done requires remote_branch_deleted=true');
  } else {
    assert(hasExactKeys(cleanup, skippedCleanupKeys), path, 'cleanup skipped-authority must contain exactly status');
  }
}

function validateCompletedProgress(path, progress, cleanupAuthority) {
  assert(isSafeBranchName(progress.branch), path, 'issue progress branch must be a safe non-empty branch name');
  assert(isMatchingWorktree(progress.worktree, progress.branch), path, 'worktree must match the completed progress branch under .worktrees');
  assert(isNonEmptyString(progress.verification), path, 'verification is required');
  assert(Number.isSafeInteger(progress.retry_count) && progress.retry_count >= 0, path, 'retry_count must be a non-negative safe integer');
  assert(parsePullRequest(progress.pr) !== null, path, 'pr must be a positive integer or canonical fluojs/fluo pull URL');
  assert(progress.review_verdict === 'merge', path, `review_verdict must be merge; ${migrationGuidance}`);
  assert(progress.checks === 'PASS', path, `checks must be PASS; ${migrationGuidance}`);
  assert(
    isObject(progress.reviewers) && hasExactKeys(progress.reviewers, reviewerKeys),
    path,
    `reviewers must contain exactly contract/code/verification; ${migrationGuidance}`,
  );
  assert(
    progress.reviewers.contract === 'PASS' && progress.reviewers.code === 'PASS' && progress.reviewers.verification === 'PASS',
    path,
    `reviewers must all be PASS; ${migrationGuidance}`,
  );
  assert(isSha(progress.merge_commit), path, `merge_commit must be a 40-character SHA; ${migrationGuidance}`);
  assert(progress.issue_state === 'CLOSED', path, `issue_state must be CLOSED; ${migrationGuidance}`);

  if (progress.reviewed_head !== undefined) {
    assert(isSha(progress.reviewed_head), path, 'reviewed_head must be a 40-character SHA when present');
  }
  if (progress.commits !== undefined) {
    assert(
      Array.isArray(progress.commits) &&
        progress.commits.length > 0 &&
        progress.commits.every((commit) => typeof commit === 'string' && /^[a-f0-9]{7,40}$/u.test(commit)),
      path,
      'commits must contain non-empty 7-40 character lowercase hex entries when present',
    );
  }

  if (progress.status === 'done') {
    validateDoneCleanup(path, progress.cleanup, cleanupAuthority);
  }

  if (progress.blockers !== undefined) {
    assert(progress.blockers.every((blocker) => blocker.status === 'remediated'), path, 'blockers must all be remediated');
  }
}

export function validateIssueProgress(path, ledger, prAssignments) {
  const hasDoneLane = ledger.lanes.some((lane) => lane.status === 'done');
  const issueProgress = ledger.issue_progress;
  if (hasDoneLane || ledger.status === 'done') {
    assert(isObject(issueProgress) && Object.keys(issueProgress).length > 0, path, 'done ledger must record issue_progress');
  } else if (issueProgress !== undefined) {
    assert(isObject(issueProgress), path, 'issue_progress must be an object when present');
  }

  const confirmedIssues = new Set(ledger.confirmed_issues);
  const queuedIssues = new Set(ledger.lanes.flatMap((lane) => lane.queue));
  const progressByIssue = new Map();
  const completedProgressIssues = new Set();
  for (const [issueKey, progress] of Object.entries(issueProgress ?? {})) {
    const progressPath = `${path}:issue_progress[${issueKey}]`;
    const issue = Number(issueKey);
    assert(/^[1-9]\d*$/u.test(issueKey) && isPositiveInteger(Number(issueKey)), progressPath, 'issue_progress key must be a positive integer issue number');
    assert(isObject(progress), progressPath, 'issue progress must be an object');
    validateProgressShape(progressPath, progress);
    assert(progressStatuses.has(progress.status), progressPath, `invalid issue_progress.status: ${String(progress.status)}`);
    if (progress.branch !== undefined) {
      assert(isSafeBranchName(progress.branch), progressPath, 'issue progress branch must be a safe non-empty branch name');
    }
    if (progress.worktree !== undefined) {
      assert(isSafeBranchName(progress.branch), progressPath, 'issue progress worktree requires a safe branch');
      const worktreeMessage =
        progress.status === 'done' || progress.status === 'merged'
          ? 'worktree must match the completed progress branch under .worktrees'
          : 'worktree must match the progress branch under .worktrees';
      assert(isMatchingWorktree(progress.worktree, progress.branch), progressPath, worktreeMessage);
    }
    if (progress.retry_count !== undefined) {
      assert(
        Number.isSafeInteger(progress.retry_count) && progress.retry_count >= 0,
        progressPath,
        'retry_count must be a non-negative safe integer',
      );
    }
    const cleanupStatus = isObject(progress.cleanup) ? progress.cleanup.status : progress.cleanup;
    assert(progress.status === 'done' || cleanupStatus !== 'done', progressPath, 'cleanup done is only valid for done issue_progress');
    assert(
      progress.status === 'done' || cleanupStatus !== 'skipped-authority',
      progressPath,
      'cleanup skipped-authority is only valid for done issue_progress',
    );
    assert(
      confirmedIssues.has(Number(issueKey)) && queuedIssues.has(Number(issueKey)),
      progressPath,
      'issue_progress issue must belong to confirmed_issues and a lane queue',
    );
    if (progress.pr !== undefined && progress.pr !== null) {
      registerPullRequest(prAssignments, progress.pr, issue, progressPath);
    }
    progressByIssue.set(issue, progress);
    if (progress.status === 'done' || progress.status === 'merged') {
      completedProgressIssues.add(issue);
    }
  }

  const completedIssues = new Set(ledger.completed_issues);
  const sameCompletedIssues =
    completedIssues.size === ledger.completed_issues.length &&
    completedIssues.size === completedProgressIssues.size &&
    [...completedIssues].every((issue) => completedProgressIssues.has(issue));
  assert(sameCompletedIssues, path, 'completed_issues and issue_progress must contain the same issue numbers');

  for (const issue of completedProgressIssues) {
    validateCompletedProgress(
      `${path}:issue_progress[${String(issue)}]`,
      progressByIssue.get(issue),
      ledger.authority_scope.cleanup_command_worktrees === true,
    );
  }

  return progressByIssue;
}
