import {
  activeStatuses,
  allowedMergePolicies,
  assert,
  hasExactKeys,
  isMatchingWorktree,
  isNonEmptyString,
  isObject,
  isPositiveInteger,
  isSafeBranchName,
  registerPullRequest,
  rootMainSyncStatuses,
  rootStatuses,
  terminalStatuses,
} from './lane-ledger-contract.mjs';
import { validateDependencyGraph } from './lane-ledger-dependency.mjs';
import { validateSource } from './lane-ledger-source.mjs';

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
const rootKeys = [
  'version',
  'run_id',
  'lane_id',
  'status',
  'created_by',
  'base_branch',
  'source',
  'merge_policy',
  'pr_merge_method',
  'authority_scope',
  'retry_policy',
  'execution',
  'confirmed_issues',
  'suggested_but_excluded',
  'backlog_candidates',
  'release_handoffs',
  'completed_issues',
  'issue_progress',
  'lanes',
  'dependency_graph',
  'root_main_sync',
];
const laneKeys = ['name', 'queue', 'current_issue', 'status', 'branch', 'worktree', 'pr', 'retry_count'];
const blockerKeys = ['signature', 'evidence'];
const migrationGuidance = 'migrate legacy completion evidence to canonical issue_progress';

function isSafeBasename(value) {
  return (
    isNonEmptyString(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
    !value.endsWith('.') &&
    !value.endsWith('.lock')
  );
}

function isUtcIsoTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const canonical = date.toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z');
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

export function validateLedgerShape(path, ledger) {
  assert(isObject(ledger), path, 'ledger must be an object');
  assert(ledger.version !== undefined, path, 'version is required');
  assert(ledger.version === 1 || ledger.version === 2, path, `unsupported ledger version: ${String(ledger.version)}`);
  assert(rootStatuses.has(ledger.status), path, `invalid ledger.status: ${String(ledger.status)}`);
  assert(
    isSafeBasename(ledger.run_id) && ledger.run_id === ledger.lane_id,
    path,
    'run_id and lane_id must be matching path-safe basenames',
  );
  if (ledger.created_at !== undefined) {
    assert(
      isUtcIsoTimestamp(ledger.created_at),
      path,
      `created_at must be a strict UTC ISO-8601 timestamp; ${migrationGuidance}`,
    );
  }
  if (ledger.lane_plan_approval_sha256 !== undefined) {
    assert(
      typeof ledger.lane_plan_approval_sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(ledger.lane_plan_approval_sha256),
      path,
      'lane_plan_approval_sha256 must be a lowercase SHA-256 digest',
    );
  }
  assert(ledger.created_by === 'create-lane', path, 'created_by must be create-lane');
  assert(isSafeBranchName(ledger.base_branch), path, 'base_branch must be a safe non-empty branch name');
  validateSource(path, ledger.source, ledger.version);
  assert(allowedMergePolicies.has(ledger.merge_policy), path, `invalid merge_policy: ${String(ledger.merge_policy)}`);
  assert(ledger.pr_merge_method === 'squash', path, 'pr_merge_method must be squash');
  validateAuthorityScope(path, ledger.authority_scope);
  validateRetryPolicy(path, ledger.retry_policy, ledger.merge_policy);
  validateExecution(path, ledger.execution, ledger.status);
  assert(Array.isArray(ledger.confirmed_issues), path, 'confirmed_issues must be an array');
  assert(ledger.confirmed_issues.every(isPositiveInteger), path, 'confirmed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.release_handoffs), path, 'release_handoffs must be an array');
  if (ledger.release_handoffs.length > 0) {
    assert(
      typeof ledger.lane_plan_approval_sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(ledger.lane_plan_approval_sha256),
      path,
      'non-empty release_handoffs require lane_plan_approval_sha256',
    );
  }
  assert(Array.isArray(ledger.completed_issues), path, 'completed_issues must be an array');
  assert(ledger.completed_issues.every(isPositiveInteger), path, 'completed_issues must contain positive integer issue numbers');
  assert(Array.isArray(ledger.suggested_but_excluded), path, 'suggested_but_excluded must be an array');
  assert(Array.isArray(ledger.backlog_candidates), path, 'backlog_candidates must be an array');
  const issueProgressMessage =
    ledger.status === 'ready'
      ? 'issue_progress must be an object'
      : `issue_progress must be an object; ${migrationGuidance}`;
  assert(isObject(ledger.issue_progress), path, issueProgressMessage);
  assert(isObject(ledger.dependency_graph), path, 'dependency_graph must be an object');
  validateDependencyGraph(path, ledger.dependency_graph, new Set(ledger.confirmed_issues));
  assert(Array.isArray(ledger.lanes) && ledger.lanes.length > 0, path, 'lanes must be a non-empty array');
  assert(isObject(ledger.root_main_sync), path, 'root_main_sync is required');
  assert(hasExactKeys(ledger.root_main_sync, ['status', 'sha']), path, 'root_main_sync must contain exactly status/sha');
  assert(rootMainSyncStatuses.has(ledger.root_main_sync.status), path, `invalid root_main_sync.status: ${String(ledger.root_main_sync.status)}`);
  const optionalRootKeys = [
    ...(ledger.created_at === undefined ? [] : ['created_at']),
    ...(ledger.lane_plan_approval_sha256 === undefined
      ? []
      : ['lane_plan_approval_sha256']),
  ];
  const expectedRootKeys = [...rootKeys, ...optionalRootKeys];
  assert(hasExactKeys(ledger, expectedRootKeys), path, 'ledger must contain exactly the canonical root keys');
}

export function validateLaneShape(lanePath, lane, validation) {
  assert(isObject(lane), lanePath, 'lane must be an object');
  assert(typeof lane.name === 'string' && lane.name.length > 0, lanePath, 'lane.name is required');
  assert(
    Array.isArray(lane.queue) && lane.queue.length > 0 && lane.queue.every(isPositiveInteger),
    lanePath,
    'lane.queue must contain at least one positive integer issue number',
  );
  const isActive = activeStatuses.has(lane.status);
  const isTerminal = terminalStatuses.has(lane.status);
  assert(isActive || isTerminal, lanePath, `invalid lane.status: ${String(lane.status)}`);
  if (isTerminal) {
    const hasLegacyEvidence = ['review', 'merge', 'cleanup'].some((key) => Object.hasOwn(lane, key));
    assert(
      !hasLegacyEvidence,
      lanePath,
      `terminal lane must move legacy completion evidence to issue_progress; ${migrationGuidance}`,
    );
  }
  const expectedLaneKeys = lane.status === 'blocked-child-contract-error' ? [...laneKeys, 'current_blocker'] : laneKeys;
  assert(hasExactKeys(lane, expectedLaneKeys), lanePath, 'lane must contain exactly the canonical keys for its status');
  assert(Number.isSafeInteger(lane.retry_count) && lane.retry_count >= 0, lanePath, 'lane retry_count must be a non-negative safe integer');
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
    assert([lane.pr, lane.review, lane.merge, lane.cleanup].every((value) => value === undefined || value === null), lanePath, migrationMessage);
  }
  if (lane.pr !== undefined && lane.pr !== null) {
    registerPullRequest(validation.prAssignments, lane.pr, lane.current_issue, lanePath);
  }
  if (lane.status === 'blocked-child-contract-error') {
    assert(isObject(lane.current_blocker), lanePath, 'blocked-child-contract-error must record current_blocker');
    assert(
      hasExactKeys(lane.current_blocker, blockerKeys) &&
        isNonEmptyString(lane.current_blocker.signature) &&
        isNonEmptyString(lane.current_blocker.evidence),
      lanePath,
      'current_blocker must contain exactly non-empty signature/evidence',
    );
  }
}
