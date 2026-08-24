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
  registerPullRequest,
} from './lane-ledger-contract.mjs';
import { isPostMergeCleanupFailureProgress, validateProgressShape } from './lane-ledger-progress-schema.mjs';

const reviewerKeys = ['contract', 'code', 'verification'];
const completedCleanupKeys = ['status', 'worktree_removed', 'local_branch_deleted', 'remote_branch_deleted'];
const skippedCleanupKeys = ['status'];
const requiredMergedEvidenceKeys = [
  'branch',
  'worktree',
  'pr',
  'verification',
  'retry_count',
  'review_verdict',
  'checks',
  'reviewers',
  'merge_commit',
  'issue_state',
];
const migrationGuidance = 'migrate legacy completion evidence to canonical issue_progress';

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
  assert(
    isSafeBranchName(progress.branch),
    path,
    `issue progress branch must be a safe non-empty branch name; ${migrationGuidance}`,
  );
  assert(
    isMatchingWorktree(progress.worktree, progress.branch),
    path,
    `worktree must match the completed progress branch under .worktrees; ${migrationGuidance}`,
  );
  assert(isNonEmptyString(progress.verification), path, `verification is required; ${migrationGuidance}`);
  assert(
    Number.isSafeInteger(progress.retry_count) && progress.retry_count >= 0,
    path,
    `retry_count must be a non-negative safe integer; ${migrationGuidance}`,
  );
  assert(
    parsePullRequest(progress.pr) !== null,
    path,
    `pr must be a positive integer or canonical fluojs/fluo pull URL; ${migrationGuidance}`,
  );
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
}

function validateRemediatedBlockers(path, progress) {
  if (progress.blockers !== undefined) {
    assert(progress.blockers.every((blocker) => blocker.status === 'remediated'), path, 'blockers must all be remediated');
  }
}

function validatePostMergeCleanupFailure(path, progress, cleanupAuthority) {
  assert(cleanupAuthority, path, 'post-merge cleanup failure requires cleanup_command_worktrees authority');
  assert(
    requiredMergedEvidenceKeys.every((key) => Object.hasOwn(progress, key)),
    path,
    `post-merge blocked-terminal progress must preserve complete merged evidence; ${migrationGuidance}`,
  );
  validateCompletedProgress(path, progress, cleanupAuthority);
  const unresolvedBlockers = progress.blockers?.filter((blocker) => blocker.status === 'unresolved') ?? [];
  assert(
    unresolvedBlockers.length > 0,
    path,
    'post-merge blocked-terminal progress requires at least one unresolved blocker',
  );
  assert(
    unresolvedBlockers.every((blocker) => blocker.fix_back_eligible === false),
    path,
    'unresolved post-merge cleanup blockers must set fix_back_eligible false',
  );
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
  const postMergeCleanupFailureIssues = new Set();
  const branchAssignments = new Map();
  const worktreeAssignments = new Map();
  for (const [index, lane] of ledger.lanes.entries()) {
    if (lane.status === 'blocked-terminal' && lane.queue.some((issue) => isPostMergeCleanupFailureProgress(issueProgress?.[String(issue)]))) {
      continue;
    }
    const lanePath = `${path}:lanes[${String(index)}]`;
    const assignment = lane.current_issue === null ? `lane:${String(index)}` : `issue:${String(lane.current_issue)}`;
    if (lane.worktree != null) {
      const assignedOwner = worktreeAssignments.get(lane.worktree);
      assert(assignedOwner === undefined || assignedOwner === assignment, lanePath, `duplicate worktree mapping: ${lane.worktree}`);
      worktreeAssignments.set(lane.worktree, assignment);
    }
    if (lane.branch != null) {
      const assignedOwner = branchAssignments.get(lane.branch);
      assert(assignedOwner === undefined || assignedOwner === assignment, lanePath, `duplicate branch mapping: ${lane.branch}`);
      branchAssignments.set(lane.branch, assignment);
    }
  }
  for (const [issueKey, progress] of Object.entries(issueProgress ?? {})) {
    const progressPath = `${path}:issue_progress[${issueKey}]`;
    const issue = Number(issueKey);
    assert(/^[1-9]\d*$/u.test(issueKey) && isPositiveInteger(Number(issueKey)), progressPath, 'issue_progress key must be a positive integer issue number');
    assert(isObject(progress), progressPath, 'issue progress must be an object');
    validateProgressShape(progressPath, progress);
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
    assert(
      confirmedIssues.has(Number(issueKey)) && queuedIssues.has(Number(issueKey)),
      progressPath,
      'issue_progress issue must belong to confirmed_issues and a lane queue',
    );
    if (progress.pr !== undefined && progress.pr !== null) {
      registerPullRequest(prAssignments, progress.pr, issue, progressPath);
    }
    assert(
      progress.head_sha === undefined || isSha(progress.head_sha),
      progressPath,
      'head_sha must be a 40-character SHA when present',
    );
    progressByIssue.set(issue, progress);
    if (isPostMergeCleanupFailureProgress(progress)) {
      validatePostMergeCleanupFailure(
        progressPath,
        progress,
        ledger.authority_scope.cleanup_command_worktrees === true,
      );
      completedProgressIssues.add(issue);
      postMergeCleanupFailureIssues.add(issue);
    } else if (progress.status === 'done' || progress.status === 'merged') {
      completedProgressIssues.add(issue);
    }
  }

  const completedIssues = new Set(ledger.completed_issues);
  for (const issue of postMergeCleanupFailureIssues) {
    assert(completedIssues.has(issue), path, 'post-merge cleanup failure issue must remain in completed_issues');
  }
  const sameCompletedIssues =
    completedIssues.size === ledger.completed_issues.length &&
    completedIssues.size === completedProgressIssues.size &&
    [...completedIssues].every((issue) => completedProgressIssues.has(issue));
  assert(sameCompletedIssues, path, 'completed_issues and issue_progress must contain the same issue numbers');

  for (const [issue, progress] of progressByIssue.entries()) {
    const progressPath = `${path}:issue_progress[${String(issue)}]`;
    const assignment = `issue:${String(issue)}`;
    if (progress.status === 'running' || progress.status === 'in_review') {
      assert(isSafeBranchName(progress.branch), progressPath, `${progress.status} lane requires matching branch evidence`);
      assert(
        isMatchingWorktree(progress.worktree, progress.branch),
        progressPath,
        `${progress.status} lane requires matching worktree evidence`,
      );
    }
    if (progress.status === 'in_review') {
      assert(parsePullRequest(progress.pr) !== null, progressPath, 'in_review lane requires matching canonical PR evidence');
      assert(isNonEmptyString(progress.verification), progressPath, 'in_review lane requires non-empty verification evidence');
    }
    if (progress.worktree !== undefined) {
      const assignedOwner = worktreeAssignments.get(progress.worktree);
      assert(assignedOwner === undefined || assignedOwner === assignment, progressPath, `duplicate worktree mapping: ${progress.worktree}`);
      worktreeAssignments.set(progress.worktree, assignment);
    }
    if (progress.branch !== undefined) {
      const assignedOwner = branchAssignments.get(progress.branch);
      assert(assignedOwner === undefined || assignedOwner === assignment, progressPath, `duplicate branch mapping: ${progress.branch}`);
      branchAssignments.set(progress.branch, assignment);
    }
  }

  for (const issue of completedProgressIssues) {
    const progress = progressByIssue.get(issue);
    if (progress.status === 'done' || progress.status === 'merged') {
      const progressPath = `${path}:issue_progress[${String(issue)}]`;
      validateCompletedProgress(progressPath, progress, ledger.authority_scope.cleanup_command_worktrees === true);
      validateRemediatedBlockers(progressPath, progress);
    }
  }

  return progressByIssue;
}
