import {
  activeStatuses,
  allowedMergePolicies,
  assert,
  isMatchingWorktree,
  isNonEmptyString,
  isObject,
  isPositiveInteger,
  isSafeBranchName,
  isSha,
  registerPullRequest,
  rootMainSyncStatuses,
  rootStatuses,
  terminalStatuses,
} from './lane-ledger-contract.mjs';
import { validateIssueProgress } from './lane-ledger-progress.mjs';

// allow: SIZE_OK - canonical lane-ledger state transitions form one validation boundary.

const authorityScopeKeys = [
  'issue_creation',
  'pr_creation',
  'pr_merge',
  'cleanup_command_worktrees',
  'root_main_sync_ff_only',
  'publish_via_github_actions',
];
const retryPolicyKeys = [
  'retry_count_is_terminal',
  'max_same_failure_repeats',
  'max_wall_clock_minutes',
  'stop_on_child_contract_error',
];
const executionKeys = ['status', 'last_command', 'last_updated'];

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function validateAuthorityScope(path, authorityScope) {
  assert(isObject(authorityScope), path, 'authority_scope is required');
  assert(authorityScope.pr_merge === true, path, 'authority_scope.pr_merge must be true');
  assert(authorityScope.issue_creation === false, path, 'authority_scope.issue_creation must be false');
  assert(authorityScope.pr_creation === true, path, 'authority_scope.pr_creation must be true');
  assert(authorityScope.publish_via_github_actions === false, path, 'authority_scope.publish_via_github_actions must be false');
  assert(typeof authorityScope.cleanup_command_worktrees === 'boolean', path, 'authority_scope.cleanup_command_worktrees must be a boolean');
  assert(typeof authorityScope.root_main_sync_ff_only === 'boolean', path, 'authority_scope.root_main_sync_ff_only must be a boolean');
  assert(hasExactKeys(authorityScope, authorityScopeKeys), path, 'authority_scope must contain exactly the canonical keys');
}

function validateRetryPolicy(path, retryPolicy, mergePolicy) {
  assert(isObject(retryPolicy), path, 'retry_policy is required; migrate legacy completion evidence to canonical issue_progress');
  assert(hasExactKeys(retryPolicy, retryPolicyKeys), path, 'retry_policy must contain exactly the canonical keys');
  assert(typeof retryPolicy.retry_count_is_terminal === 'boolean', path, 'retry_policy.retry_count_is_terminal must be a boolean');
  assert(typeof retryPolicy.stop_on_child_contract_error === 'boolean', path, 'retry_policy.stop_on_child_contract_error must be a boolean');
  assert(isPositiveInteger(retryPolicy.max_same_failure_repeats), path, 'retry_policy.max_same_failure_repeats must be a positive safe integer');
  assert(isPositiveInteger(retryPolicy.max_wall_clock_minutes), path, 'retry_policy.max_wall_clock_minutes must be a positive safe integer');
  if (mergePolicy === 'supervisor-full-auto') {
    assert(retryPolicy.retry_count_is_terminal === false, path, 'retry_policy.retry_count_is_terminal must be false for supervisor-full-auto');
  } else {
    assert(retryPolicy.retry_count_is_terminal === true, path, 'retry_policy.retry_count_is_terminal must be true unless merge_policy is supervisor-full-auto');
  }
}

function validateExecution(path, execution, ledgerStatus) {
  assert(isObject(execution), path, 'execution is required');
  assert(hasExactKeys(execution, executionKeys), path, 'execution must contain exactly the canonical keys');
  const expectedStatus = ledgerStatus === 'ready' ? 'not-started' : ledgerStatus;
  assert(execution.status === expectedStatus, path, `execution.status must be ${expectedStatus} for ledger status ${String(ledgerStatus)}`);
  if (execution.status === 'not-started') {
    assert(execution.last_command === null && execution.last_updated === null, path, 'not-started execution must record null last_command and last_updated');
  } else {
    assert(
      isNonEmptyString(execution.last_command) && isNonEmptyString(execution.last_updated),
      path,
      'non-ready execution must record non-empty last_command and last_updated',
    );
  }
}

function validateRootRelationship(path, ledger) {
  if (ledger.status === 'ready') {
    assert(ledger.lanes.every((lane) => lane.status === 'queued'), path, 'ready ledger requires every lane to be queued');
    assert(
      ledger.completed_issues.length === 0 && Object.keys(ledger.issue_progress ?? {}).length === 0,
      path,
      'ready ledger requires empty completed_issues and issue_progress',
    );
    assert(ledger.root_main_sync.status === 'not-started', path, 'ready ledger requires root_main_sync not-started');
  } else if (ledger.status === 'done') {
    assert(ledger.lanes.every((lane) => lane.status === 'done'), path, 'done ledger status requires every lane status to be done');
    assert(ledger.root_main_sync.status !== 'not-started', path, 'done ledger requires root_main_sync to leave not-started');
  } else if (terminalStatuses.has(ledger.status)) {
    assert(ledger.lanes.every((lane) => terminalStatuses.has(lane.status)), path, 'terminal ledger status cannot contain active lanes');
  }
}

function validateRootMainSync(path, ledger) {
  const rootMainSync = ledger.root_main_sync;
  const everyLaneTerminal = ledger.lanes.every((lane) => terminalStatuses.has(lane.status));
  if (rootMainSync.status === 'not-started') {
    assert(rootMainSync.sha === null, path, 'root_main_sync not-started must record null sha');
  } else if (rootMainSync.status === 'done') {
    assert(everyLaneTerminal, path, 'root_main_sync done requires every lane to be terminal');
    assert(ledger.authority_scope.root_main_sync_ff_only === true, path, 'root_main_sync done requires root_main_sync_ff_only authority');
    assert(isSha(rootMainSync.sha), path, 'root_main_sync done must record sha');
  } else if (rootMainSync.status === 'skipped-authority') {
    assert(everyLaneTerminal, path, 'root_main_sync skipped-authority requires every lane to be terminal');
    assert(
      ledger.authority_scope.root_main_sync_ff_only === false,
      path,
      'root_main_sync skipped-authority requires root_main_sync_ff_only authority false',
    );
    assert(rootMainSync.sha === null, path, 'root_main_sync skipped-authority must record null sha');
  } else {
    assert(everyLaneTerminal, path, 'root_main_sync blocked-dirty requires every lane to be terminal');
    assert(
      ledger.authority_scope.root_main_sync_ff_only === true,
      path,
      'root_main_sync blocked-dirty requires root_main_sync_ff_only authority true',
    );
    assert(rootMainSync.sha === null, path, 'root_main_sync blocked-dirty must record null sha');
  }
}

function validateLaneProgressRelationship(lanePath, lane, validation) {
  if (activeStatuses.has(lane.status)) {
    const progress = validation.progressByIssue.get(lane.current_issue);
    if (lane.status === 'queued') {
      assert(progress === undefined || progress.status === 'queued', lanePath, 'queued lane issue_progress must be absent or queued');
    } else {
      assert(progress?.status === lane.status, lanePath, `${String(lane.status)} lane requires matching current issue_progress`);
    }
    if (progress !== undefined) {
      assert(
        (lane.branch ?? null) === (progress.branch ?? null),
        lanePath,
        'current lane and issue progress branch must both be absent or exactly equal',
      );
      assert(
        (lane.worktree ?? null) === (progress.worktree ?? null),
        lanePath,
        'current lane and issue progress worktree must both be absent or exactly equal',
      );
    }
  } else if (lane.status !== 'done') {
    const firstUnfinishedIssue = lane.queue.find((issue) => !validation.completedIssues.has(issue));
    assert(
      firstUnfinishedIssue !== undefined && validation.progressByIssue.get(firstUnfinishedIssue)?.status === lane.status,
      lanePath,
      'non-done terminal lane requires matching terminal progress for the first unfinished issue',
    );
  }
}

function validateLane(lanePath, lane, validation) {
  assert(isObject(lane), lanePath, 'lane must be an object');
  assert(typeof lane.name === 'string' && lane.name.length > 0, lanePath, 'lane.name is required');
  assert(Array.isArray(lane.queue) && lane.queue.every(isPositiveInteger), lanePath, 'lane.queue must contain positive integer issue numbers');

  const isActive = activeStatuses.has(lane.status);
  const isTerminal = terminalStatuses.has(lane.status);
  assert(isActive || isTerminal, lanePath, `invalid lane.status: ${String(lane.status)}`);

  if (lane.branch !== undefined && lane.branch !== null) {
    assert(isSafeBranchName(lane.branch), lanePath, 'lane branch must be a safe non-empty branch name');
  }
  if (lane.worktree !== undefined && lane.worktree !== null) {
    assert(isSafeBranchName(lane.branch), lanePath, 'lane worktree requires a safe branch');
    assert(isMatchingWorktree(lane.worktree, lane.branch), lanePath, 'lane worktree must match lane branch under .worktrees');
  }

  if (isActive) {
    assert(isPositiveInteger(lane.current_issue), lanePath, 'active lane.current_issue must be an integer issue number');
    assert(lane.queue.includes(lane.current_issue), lanePath, 'lane.current_issue must appear in lane.queue');
    if (lane.status !== 'merged') {
      const nextIssue = lane.queue.find((issue) => !validation.completedIssues.has(issue));
      assert(nextIssue !== undefined, lanePath, 'active lane.current_issue cannot remain set when all queue issues are completed');
      assert(lane.current_issue === nextIssue, lanePath, 'active lane.current_issue must be the first queue issue absent from completed_issues');
    }
  } else {
    const migrationMessage = 'terminal lane.current_issue must be null; migrate completion evidence to issue_progress';
    assert(lane.current_issue === null, lanePath, migrationMessage);
    assert(
      [lane.pr, lane.review, lane.merge, lane.cleanup].every((value) => value === undefined || value === null),
      lanePath,
      migrationMessage,
    );
  }

  if (lane.pr !== undefined && lane.pr !== null) {
    registerPullRequest(validation.prAssignments, lane.pr, lane.current_issue, lanePath);
  }

  if (lane.status === 'blocked-child-contract-error') {
    assert(isObject(lane.current_blocker), lanePath, 'blocked-child-contract-error must record current_blocker');
  }
}

export function validateLedger(path, ledger) {
  assert(isObject(ledger), path, 'ledger must be an object');
  assert(ledger.version !== undefined, path, 'version is required');
  assert(ledger.version === 1, path, `unsupported ledger version: ${String(ledger.version)}`);
  assert(rootStatuses.has(ledger.status), path, `invalid ledger.status: ${String(ledger.status)}`);
  assert(typeof ledger.run_id === 'string' && ledger.run_id.length > 0, path, 'run_id is required');
  assert(ledger.created_by === 'create-lane', path, 'created_by must be create-lane');
  assert(isSafeBranchName(ledger.base_branch), path, 'base_branch must be a safe non-empty branch name');
  assert(allowedMergePolicies.has(ledger.merge_policy), path, `invalid merge_policy: ${String(ledger.merge_policy)}`);
  assert(ledger.pr_merge_method === 'squash', path, 'pr_merge_method must be squash');
  validateAuthorityScope(path, ledger.authority_scope);
  validateRetryPolicy(path, ledger.retry_policy, ledger.merge_policy);
  validateExecution(path, ledger.execution, ledger.status);
  assert(Array.isArray(ledger.confirmed_issues), path, 'confirmed_issues must be an array');
  assert(ledger.confirmed_issues.every(isPositiveInteger), path, 'confirmed_issues must contain positive integer issue numbers');
  const confirmedIssues = new Set(ledger.confirmed_issues);
  assert(Array.isArray(ledger.release_handoffs), path, 'release_handoffs must be an array');
  const releaseHandoffs = new Set(ledger.release_handoffs);
  assert(
    ledger.release_handoffs.every(isPositiveInteger) &&
      releaseHandoffs.size === ledger.release_handoffs.length &&
      ledger.release_handoffs.every((issue) => confirmedIssues.has(issue)),
    path,
    'release_handoffs must contain unique positive issue numbers from confirmed_issues',
  );
  assert(Array.isArray(ledger.completed_issues), path, 'completed_issues must be an array');
  assert(ledger.completed_issues.every(isPositiveInteger), path, 'completed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.lanes), path, 'lanes must be an array');
  assert(isObject(ledger.root_main_sync), path, 'root_main_sync is required');
  assert(rootMainSyncStatuses.has(ledger.root_main_sync.status), path, `invalid root_main_sync.status: ${String(ledger.root_main_sync.status)}`);

  const completedIssues = new Set(ledger.completed_issues);
  const prAssignments = new Map();
  const laneValidation = { completedIssues, prAssignments };
  validateRootRelationship(path, ledger);
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLane(`${path}:lanes[${index}]`, lane, laneValidation);
    if (lane.status === 'merged') {
      const currentProgress = ledger.issue_progress?.[String(lane.current_issue)];
      if (currentProgress !== undefined) {
        assert(currentProgress.status === 'merged', `${path}:lanes[${index}]`, 'merged lane requires matching merged issue_progress');
        assert(completedIssues.has(lane.current_issue), `${path}:lanes[${index}]`, 'merged lane current_issue must appear in completed_issues');
      }
    }
  }
  validateRootMainSync(path, ledger);

  const queuedIssueList = ledger.lanes.flatMap((lane) => lane.queue);
  const queuedIssues = new Set(queuedIssueList);
  const sameConfirmedQueueIssues =
    confirmedIssues.size === ledger.confirmed_issues.length &&
    queuedIssues.size === queuedIssueList.length &&
    confirmedIssues.size === queuedIssues.size &&
    [...confirmedIssues].every((issue) => queuedIssues.has(issue));
  assert(sameConfirmedQueueIssues, path, 'confirmed_issues and lane queues must contain the same unique positive issue numbers');

  const progressByIssue = validateIssueProgress(path, ledger, prAssignments);
  assert(isObject(ledger.issue_progress), path, 'issue_progress must be an object');
  const relationshipValidation = { completedIssues, progressByIssue };
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLaneProgressRelationship(`${path}:lanes[${index}]`, lane, relationshipValidation);
    if (lane.status === 'done') {
      for (const issue of lane.queue) {
        assert(completedIssues.has(issue), `${path}:lanes[${index}]`, 'done lane queue issues must appear in completed_issues');
        assert(progressByIssue.get(issue)?.status === 'done', `${path}:lanes[${index}]`, 'done lane queue issues must have done issue_progress');
      }
    }
  }

}
