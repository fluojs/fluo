import {
  activeStatuses,
  allowedMergePolicies,
  assert,
  isMatchingWorktree,
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
  assert(isObject(ledger.authority_scope), path, 'authority_scope is required');
  assert(ledger.authority_scope.pr_merge === true, path, 'authority_scope.pr_merge must be true');
  assert(typeof ledger.authority_scope.cleanup_command_worktrees === 'boolean', path, 'authority_scope.cleanup_command_worktrees must be a boolean');
  assert(typeof ledger.authority_scope.root_main_sync_ff_only === 'boolean', path, 'authority_scope.root_main_sync_ff_only must be a boolean');
  assert(ledger.pr_merge_method === 'squash', path, 'pr_merge_method must be squash');
  assert(Array.isArray(ledger.confirmed_issues), path, 'confirmed_issues must be an array');
  assert(ledger.confirmed_issues.every(isPositiveInteger), path, 'confirmed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.completed_issues), path, 'completed_issues must be an array');
  assert(ledger.completed_issues.every(isPositiveInteger), path, 'completed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.lanes), path, 'lanes must be an array');
  assert(isObject(ledger.root_main_sync), path, 'root_main_sync is required');
  assert(rootMainSyncStatuses.has(ledger.root_main_sync.status), path, `invalid root_main_sync.status: ${String(ledger.root_main_sync.status)}`);

  const completedIssues = new Set(ledger.completed_issues);
  const prAssignments = new Map();
  const laneValidation = { completedIssues, prAssignments };
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLane(`${path}:lanes[${index}]`, lane, laneValidation);
  }

  if (ledger.status === 'done') {
    assert(ledger.lanes.every((lane) => lane.status === 'done'), path, 'done ledger status requires every lane status to be done');
  } else if (terminalStatuses.has(ledger.status)) {
    assert(ledger.lanes.every((lane) => terminalStatuses.has(lane.status)), path, 'terminal ledger status cannot contain active lanes');
  }

  const confirmedIssues = new Set(ledger.confirmed_issues);
  const queuedIssueList = ledger.lanes.flatMap((lane) => lane.queue);
  const queuedIssues = new Set(queuedIssueList);
  const sameConfirmedQueueIssues =
    confirmedIssues.size === ledger.confirmed_issues.length &&
    queuedIssues.size === queuedIssueList.length &&
    confirmedIssues.size === queuedIssues.size &&
    [...confirmedIssues].every((issue) => queuedIssues.has(issue));
  assert(sameConfirmedQueueIssues, path, 'confirmed_issues and lane queues must contain the same unique positive issue numbers');

  const progressByIssue = validateIssueProgress(path, ledger, prAssignments);
  for (const [index, lane] of ledger.lanes.entries()) {
    if (lane.status === 'done') {
      for (const issue of lane.queue) {
        assert(completedIssues.has(issue), `${path}:lanes[${index}]`, 'done lane queue issues must appear in completed_issues');
        assert(progressByIssue.get(issue)?.status === 'done', `${path}:lanes[${index}]`, 'done lane queue issues must have done issue_progress');
      }
    }
  }

  const unfinished = ledger.lanes.filter((lane) => !terminalStatuses.has(lane.status));
  if (ledger.root_main_sync?.status === 'done') {
    assert(unfinished.length === 0, path, 'root_main_sync done requires every lane to be terminal');
    assert(ledger.authority_scope.root_main_sync_ff_only === true, path, 'root_main_sync done requires root_main_sync_ff_only authority');
    assert(isSha(ledger.root_main_sync.sha), path, 'root_main_sync done must record sha');
  }
}
