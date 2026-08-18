import {
  activeStatuses,
  allowedMergePolicies,
  assert,
  isObject,
  isPositiveInteger,
  isSha,
  terminalStatuses,
} from './lane-ledger-contract.mjs';
import { validateIssueProgress } from './lane-ledger-progress.mjs';

function validateLane(path, lane, laneIndex, seenPrs) {
  const lanePath = `${path}:lanes[${laneIndex}]`;
  assert(isObject(lane), lanePath, 'lane must be an object');
  assert(typeof lane.name === 'string' && lane.name.length > 0, lanePath, 'lane.name is required');
  assert(Array.isArray(lane.queue) && lane.queue.every(isPositiveInteger), lanePath, 'lane.queue must contain positive integer issue numbers');

  const isActive = activeStatuses.has(lane.status);
  const isTerminal = terminalStatuses.has(lane.status);
  assert(isActive || isTerminal, lanePath, `invalid lane.status: ${String(lane.status)}`);

  if (isActive) {
    assert(isPositiveInteger(lane.current_issue), lanePath, 'active lane.current_issue must be an integer issue number');
    assert(lane.queue.includes(lane.current_issue), lanePath, 'lane.current_issue must appear in lane.queue');
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
    assert(isPositiveInteger(lane.pr), lanePath, 'lane.pr must be a positive integer PR number when present');
    assert(!seenPrs.has(lane.pr), lanePath, `duplicate PR mapping: ${String(lane.pr)}`);
    seenPrs.add(lane.pr);
  }

  if (lane.status === 'blocked-child-contract-error') {
    assert(isObject(lane.current_blocker), lanePath, 'blocked-child-contract-error must record current_blocker');
  }
}

export function validateLedger(path, ledger) {
  assert(isObject(ledger), path, 'ledger must be an object');
  assert(ledger.version !== undefined, path, 'version is required');
  assert(ledger.version === 1, path, `unsupported ledger version: ${String(ledger.version)}`);
  assert(typeof ledger.run_id === 'string' && ledger.run_id.length > 0, path, 'run_id is required');
  assert(allowedMergePolicies.has(ledger.merge_policy), path, `invalid merge_policy: ${String(ledger.merge_policy)}`);
  assert(isObject(ledger.authority_scope), path, 'authority_scope is required');
  assert(ledger.authority_scope.pr_merge === true, path, 'authority_scope.pr_merge must be true');
  assert(ledger.pr_merge_method === 'squash', path, 'pr_merge_method must be squash');
  assert(Array.isArray(ledger.confirmed_issues), path, 'confirmed_issues must be an array');
  assert(ledger.confirmed_issues.every(isPositiveInteger), path, 'confirmed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.completed_issues), path, 'completed_issues must be an array');
  assert(ledger.completed_issues.every(isPositiveInteger), path, 'completed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.lanes), path, 'lanes must be an array');

  const seenPrs = new Set();
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLane(path, lane, index, seenPrs);
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

  const progressByIssue = validateIssueProgress(path, ledger);
  const completedIssues = new Set(ledger.completed_issues);
  for (const [index, lane] of ledger.lanes.entries()) {
    if (lane.status === 'done') {
      for (const issue of lane.queue) {
        assert(completedIssues.has(issue), `${path}:lanes[${index}]`, 'done lane queue issues must appear in completed_issues');
        assert(progressByIssue.get(issue)?.status === 'done', `${path}:lanes[${index}]`, 'done lane queue issues must have done issue_progress');
      }
    }
  }

  const unfinished = ledger.lanes.filter((lane) => !terminalStatuses.has(lane.status));
  if (unfinished.length === 0 && ledger.root_main_sync?.status === 'done') {
    assert(isSha(ledger.root_main_sync.sha), path, 'root_main_sync done must record sha');
  }
}
