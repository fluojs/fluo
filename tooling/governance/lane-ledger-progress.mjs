import {
  assert,
  isNonEmptyString,
  isObject,
  isPositiveInteger,
  isPullRequest,
  isSha,
} from './lane-ledger-contract.mjs';

function validateCompletedProgress(path, progress, cleanupAuthority) {
  assert(isNonEmptyString(progress.branch), path, 'branch is required');
  assert(isNonEmptyString(progress.worktree), path, 'worktree is required');
  assert(isNonEmptyString(progress.verification), path, 'verification is required');
  assert(Number.isInteger(progress.retry_count) && progress.retry_count >= 0, path, 'retry_count must be a non-negative integer');
  assert(isPullRequest(progress.pr), path, 'pr must be a positive integer or GitHub pull URL');
  assert(progress.review_verdict === 'merge', path, 'review_verdict must be merge');
  assert(isSha(progress.merge_commit), path, 'merge_commit must be a 40-character SHA');
  assert(progress.issue_state === 'CLOSED', path, 'issue_state must be CLOSED');

  if (progress.status === 'done') {
    if (cleanupAuthority) {
      assert(progress.cleanup === 'done', path, 'cleanup must be done when cleanup authority is true');
    } else {
      assert(progress.cleanup === 'skipped-authority', path, 'cleanup must be skipped-authority when cleanup authority is false');
    }
  }

  if (progress.reviewers !== undefined) {
    assert(isObject(progress.reviewers), path, 'reviewers must be an object when present');
    assert(
      progress.reviewers.contract === 'PASS' && progress.reviewers.code === 'PASS' && progress.reviewers.verification === 'PASS',
      path,
      'reviewers must all be PASS',
    );
  }

  if (progress.blockers !== undefined) {
    assert(Array.isArray(progress.blockers), path, 'blockers must be an array when present');
    assert(progress.blockers.every((blocker) => isObject(blocker) && blocker.status === 'remediated'), path, 'blockers must all be remediated');
  }
}

export function validateIssueProgress(path, ledger) {
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
  const seenPrs = new Set();
  for (const [issueKey, progress] of Object.entries(issueProgress ?? {})) {
    const progressPath = `${path}:issue_progress[${issueKey}]`;
    assert(/^[1-9]\d*$/u.test(issueKey) && isPositiveInteger(Number(issueKey)), progressPath, 'issue_progress key must be a positive integer issue number');
    assert(isObject(progress), progressPath, 'issue progress must be an object');
    assert(
      confirmedIssues.has(Number(issueKey)) && queuedIssues.has(Number(issueKey)),
      progressPath,
      'issue_progress issue must belong to confirmed_issues and a lane queue',
    );
    if (progress.pr !== undefined) {
      assert(isPullRequest(progress.pr), progressPath, 'pr must be a positive integer or GitHub pull URL');
      assert(!seenPrs.has(progress.pr), progressPath, `duplicate PR mapping: ${String(progress.pr)}`);
      seenPrs.add(progress.pr);
    }
    progressByIssue.set(Number(issueKey), progress);
    if (progress.status === 'done' || progress.status === 'merged') {
      completedProgressIssues.add(Number(issueKey));
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
