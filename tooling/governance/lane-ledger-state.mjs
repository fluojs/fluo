import {
  activeStatuses,
  assert,
  isObject,
  isPositiveInteger,
  isSha,
  parsePullRequest,
  terminalStatuses,
} from './lane-ledger-contract.mjs';
import { validateIssueProgress } from './lane-ledger-progress.mjs';
import { isPostMergeCleanupFailureProgress } from './lane-ledger-progress-schema.mjs';
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

function findTerminalIssue(lane, progressByIssue) {
  return lane.queue.find((issue) => progressByIssue.get(issue)?.status === lane.status);
}

function validateLaneProgressRelationship(lanePath, lane, validation) {
  if (activeStatuses.has(lane.status)) {
    const progress = validation.progressByIssue.get(lane.current_issue);
    if (lane.status === 'queued') {
      assert(progress === undefined || progress.status === 'queued', lanePath, 'queued lane issue_progress must be absent or queued');
      if (progress === undefined) {
        assert(lane.retry_count === 0, lanePath, 'queued lane without issue progress requires retry_count 0');
        assert(
          lane.branch == null && lane.worktree == null && lane.pr == null,
          lanePath,
          'queued lane without issue progress requires null branch, worktree, and PR',
        );
      }
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
      const lanePullRequest = lane.pr === null ? null : parsePullRequest(lane.pr);
      const progressPullRequest = progress.pr === undefined || progress.pr === null ? null : parsePullRequest(progress.pr);
      assert(
        lanePullRequest === progressPullRequest,
        lanePath,
        'current lane and issue progress PR must both be absent or normalize to the same pull request',
      );
      if (lane.status === 'in_review' || lane.status === 'merged') {
        assert(lanePullRequest !== null, lanePath, `${lane.status} lane requires matching canonical PR evidence`);
      }
      assert(lane.retry_count === progress.retry_count, lanePath, 'current lane and issue progress retry_count must be equal');
    }
  } else if (lane.status !== 'done') {
    const terminalIssue = findTerminalIssue(lane, validation.progressByIssue);
    const progress = validation.progressByIssue.get(terminalIssue);
    assert(
      terminalIssue !== undefined && progress?.status === lane.status,
      lanePath,
      'non-done terminal lane requires matching terminal progress for the first unfinished issue',
    );
    if (isPostMergeCleanupFailureProgress(progress)) {
      assert(
        lane.current_issue === null && lane.branch == null && lane.worktree == null && lane.pr == null,
        lanePath,
        'terminal post-merge cleanup failure requires null lane cursor and dispatch identity',
      );
    }
    assert(lane.retry_count === progress.retry_count, lanePath, 'terminal lane retry_count must match first unfinished issue progress');
  } else {
    assert(lane.retry_count === 0, lanePath, 'done lane requires retry_count 0');
  }
}

function classifyQueueEntry(lane, index, validation) {
  if (lane.status === 'done') {
    return 'done';
  }
  const currentIndex = activeStatuses.has(lane.status)
    ? lane.queue.indexOf(lane.current_issue)
    : lane.queue.indexOf(findTerminalIssue(lane, validation.progressByIssue));
  if (index < currentIndex) {
    return 'previous';
  }
  return index === currentIndex ? 'current' : 'later';
}

function validateSequentialProgress(lanePath, lane, validation) {
  for (const [index, issue] of lane.queue.entries()) {
    const position = classifyQueueEntry(lane, index, validation);
    const progress = validation.progressByIssue.get(issue);
    if (position === 'done') {
      assert(progress?.status === 'done', lanePath, 'done lane queue issues must have done issue_progress');
    } else if (position === 'previous') {
      assert(progress?.status === 'done', lanePath, 'queue entries before current must have done issue progress');
    } else if (position === 'current' && lane.status === 'merged') {
      assert(validation.completedIssues.has(issue), lanePath, 'merged lane current_issue must appear in completed_issues');
    } else if (position === 'later') {
      const terminalIssue = activeStatuses.has(lane.status)
        ? undefined
        : findTerminalIssue(lane, validation.progressByIssue);
      const terminalProgress = validation.progressByIssue.get(terminalIssue);
      assert(
        progress === undefined || progress.status === 'queued',
        lanePath,
        isPostMergeCleanupFailureProgress(terminalProgress)
          ? 'terminal post-merge cleanup failure must not dispatch a later same-lane issue'
          : 'queue entries after current must be absent or queued',
      );
    }
  }
}

function validateReleaseHandoffs(path, ledger, progressByIssue) {
  const completedIssues = new Set(ledger.completed_issues);
  for (const issue of ledger.release_handoffs) {
    const lane = ledger.lanes.find((candidate) => candidate.queue.includes(issue));
    assert(lane?.queue.length === 1, path, 'release handoff must occupy a dedicated single-issue lane');
    const progress = progressByIssue.get(issue);
    assert(
      !completedIssues.has(issue) && progress?.status !== 'merged' && progress?.status !== 'done' && lane.status !== 'merged' && lane.status !== 'done',
      path,
      'release handoff must never be completed, merged, or done',
    );
    assert(
      lane.branch == null && lane.worktree == null && lane.pr == null && progress?.branch == null && progress?.worktree == null && progress?.pr == null,
      path,
      'release handoff must not record branch, worktree, or PR evidence',
    );
    if (ledger.status === 'ready') {
      assert(lane.status === 'queued' && progress === undefined, path, 'ready release handoff must remain queued without issue progress');
    } else {
      assert(
        lane.status === 'blocked-maintainer-decision' && progress?.status === 'blocked-maintainer-decision',
        path,
        'non-ready release handoff requires blocked-maintainer-decision lane and progress',
      );
    }
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
  validateReleaseHandoffs(path, ledger, progressByIssue);
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLaneProgressRelationship(`${path}:lanes[${index}]`, lane, relationshipValidation);
    validateSequentialProgress(`${path}:lanes[${index}]`, lane, relationshipValidation);
    if (lane.status === 'done') {
      for (const issue of lane.queue) {
        assert(completedIssues.has(issue), `${path}:lanes[${index}]`, 'done lane queue issues must appear in completed_issues');
        assert(progressByIssue.get(issue)?.status === 'done', `${path}:lanes[${index}]`, 'done lane queue issues must have done issue_progress');
      }
    }
  }

}
