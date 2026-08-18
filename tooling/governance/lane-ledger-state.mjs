import {
  activeStatuses,
  assert,
  isObject,
  isPositiveInteger,
  isSha,
  terminalStatuses,
} from './lane-ledger-contract.mjs';
import { validateIssueProgress } from './lane-ledger-progress.mjs';
import { validateLaneShape, validateLedgerShape } from './lane-ledger-schema.mjs';

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

export function validateLedger(path, ledger) {
  validateLedgerShape(path, ledger);
  const confirmedIssues = new Set(ledger.confirmed_issues);
  const releaseHandoffs = new Set(ledger.release_handoffs);
  assert(
    ledger.release_handoffs.every(isPositiveInteger) &&
      releaseHandoffs.size === ledger.release_handoffs.length &&
      ledger.release_handoffs.every((issue) => confirmedIssues.has(issue)),
    path,
    'release_handoffs must contain unique positive issue numbers from confirmed_issues',
  );

  const completedIssues = new Set(ledger.completed_issues);
  const prAssignments = new Map();
  const laneValidation = { completedIssues, prAssignments };
  validateRootRelationship(path, ledger);
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLaneShape(`${path}:lanes[${index}]`, lane, laneValidation);
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
