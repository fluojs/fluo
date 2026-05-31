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

function assert(condition, path, message) {
  if (!condition) {
    fail(path, message);
  }
}

function readLedger(path) {
  assert(existsSync(path), path, 'ledger file does not exist');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateLane(path, ledger, lane, laneIndex, seenPrs) {
  const lanePath = `${path}:lanes[${laneIndex}]`;
  assert(isObject(lane), lanePath, 'lane must be an object');
  assert(typeof lane.name === 'string' && lane.name.length > 0, lanePath, 'lane.name is required');
  assert(Number.isInteger(lane.current_issue), lanePath, 'lane.current_issue must be an integer issue number');
  assert(Array.isArray(lane.queue) && lane.queue.includes(lane.current_issue), lanePath, 'lane.current_issue must appear in lane.queue');
  assert(terminalStatuses.has(lane.status) || activeStatuses.has(lane.status), lanePath, `invalid lane.status: ${String(lane.status)}`);

  if (lane.pr !== undefined && lane.pr !== null) {
    assert(Number.isInteger(lane.pr), lanePath, 'lane.pr must be an integer PR number when present');
    assert(!seenPrs.has(lane.pr), lanePath, `duplicate PR mapping: ${String(lane.pr)}`);
    seenPrs.add(lane.pr);
  }

  const merge = lane.merge;
  const cleanup = lane.cleanup;
  const review = lane.review;
  const completedIssues = new Set(ledger.completed_issues ?? []);

  if (lane.status === 'done' || lane.status === 'merged') {
    assert(Number.isInteger(lane.pr), lanePath, 'done/merged lane must record pr');
    assert(isObject(review), lanePath, 'done/merged lane must record review');
    assert(review.verdict === 'merge', lanePath, 'done/merged lane review.verdict must be merge');
    assert(review.contract === 'PASS' && review.code === 'PASS' && review.verification === 'PASS', lanePath, 'done/merged lane requires PASS from contract/code/verification reviewers');
    assert(review.checks === 'PASS', lanePath, 'done/merged lane requires PASS checks');
    assert(review.merge_method === 'squash', lanePath, 'done/merged lane must record squash merge method');
    assert(isObject(merge), lanePath, 'done/merged lane must record merge object');
    assert(merge.status === 'done', lanePath, 'done/merged lane merge.status must be done');
    assert(merge.method === 'squash', lanePath, 'merge.method must be squash');
    assert(isSha(merge.merge_commit), lanePath, 'merge.merge_commit must be a 40-character SHA');
    assert(completedIssues.has(lane.current_issue), lanePath, 'done/merged lane current_issue must appear in completed_issues');
  }

  if (merge?.status === 'done') {
    assert(lane.status === 'done' || lane.status === 'merged', lanePath, 'merge.status done is only valid for done/merged lanes');
    assert(merge.method === 'squash', lanePath, 'completed merge must use squash');
    assert(isSha(merge.merge_commit), lanePath, 'completed merge must record merge_commit SHA');
  }

  if (cleanup?.status === 'done') {
    assert(merge?.status === 'done', lanePath, 'cleanup done requires merge done');
    assert(cleanup.worktree_removed === true, lanePath, 'cleanup done requires worktree_removed=true');
    assert(cleanup.local_branch_deleted === true, lanePath, 'cleanup done requires local_branch_deleted=true');
    assert(cleanup.remote_branch_deleted === true, lanePath, 'cleanup done requires remote_branch_deleted=true');
  }

  if (lane.status === 'blocked-child-contract-error') {
    assert(!merge || merge.status !== 'done', lanePath, 'blocked-child-contract-error cannot have merge.status done');
    assert(!cleanup || cleanup.status !== 'done', lanePath, 'blocked-child-contract-error cannot have cleanup.status done');
    assert(isObject(lane.current_blocker), lanePath, 'blocked-child-contract-error must record current_blocker');
  }
}

function validateLedger(path) {
  const ledger = readLedger(path);
  assert(isObject(ledger), path, 'ledger must be an object');
  assert(typeof ledger.run_id === 'string' && ledger.run_id.length > 0, path, 'run_id is required');
  assert(allowedMergePolicies.has(ledger.merge_policy), path, `invalid merge_policy: ${String(ledger.merge_policy)}`);
  assert(isObject(ledger.authority_scope), path, 'authority_scope is required');
  assert(Array.isArray(ledger.confirmed_issues), path, 'confirmed_issues must be an array');
  assert(Array.isArray(ledger.completed_issues), path, 'completed_issues must be an array');
  assert(Array.isArray(ledger.lanes), path, 'lanes must be an array');

  const seenPrs = new Set();
  for (const [index, lane] of ledger.lanes.entries()) {
    validateLane(path, ledger, lane, index, seenPrs);
  }

  const unfinished = ledger.lanes.filter((lane) => !terminalStatuses.has(lane.status));
  if (unfinished.length === 0 && ledger.root_main_sync?.status === 'done') {
    assert(isSha(ledger.root_main_sync.sha), path, 'root_main_sync done must record sha');
  }

  const supervisorMerge = ledger.merge_policy === 'supervisor-auto' || ledger.merge_policy === 'supervisor-full-auto';
  if (supervisorMerge) {
    for (const [index, lane] of ledger.lanes.entries()) {
      if (lane.status === 'done' && lane.merge?.status === 'done') {
        assert(lane.cleanup?.status === 'done', `${path}:lanes[${index}]`, 'harness-merged lanes must complete cleanup before done reporting');
      }
    }
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
