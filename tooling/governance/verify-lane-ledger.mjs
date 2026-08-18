#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const terminalStatuses = new Set([
  'done',
  'blocked-terminal',
  'needs-human-check-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
  'blocked-child-contract-error',
  'blocked-ledger-conflict',
]);

const activeStatuses = new Set(['queued', 'running', 'in_review', 'merged']);
const allowedMergePolicies = new Set([
  'developer-final',
  'supervisor-auto',
  'supervisor-with-human-escalation',
  'supervisor-full-auto',
]);

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPullRequest(value) {
  return (
    isPositiveInteger(value) ||
    (typeof value === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/u.test(value))
  );
}

function assert(condition, path, message) {
  if (!condition) {
    fail(path, message);
  }
}

function readLedger(path) {
  assert(existsSync(path), path, 'ledger file does not exist');
  return JSON.parse(readFileSync(path, 'utf8'));
}

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

function validateIssueProgress(path, ledger) {
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

function validateLedger(path) {
  const ledger = readLedger(path);
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

const paths = process.argv.slice(2).filter((path) => path !== '--');
if (paths.length === 0) {
  console.error('Usage: node tooling/governance/verify-lane-ledger.mjs <ledger.json> [...]');
  process.exit(2);
}

for (const path of paths) {
  validateLedger(path);
}

console.log(`Lane ledger check passed for ${String(paths.length)} file(s).`);
