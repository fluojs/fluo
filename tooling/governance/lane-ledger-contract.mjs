import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const terminalStatuses = new Set([
  'done',
  'blocked-terminal',
  'needs-human-check-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
  'blocked-child-contract-error',
  'blocked-ledger-conflict',
]);

export const activeStatuses = new Set(['queued', 'running', 'in_review', 'merged']);
export const rootStatuses = new Set(['ready', 'running', ...terminalStatuses]);
export const progressStatuses = new Set(['queued', 'running', 'in_review', 'merged', ...terminalStatuses]);
export const rootMainSyncStatuses = new Set([
  'not-started',
  'done',
  'skipped-authority',
  'blocked-dirty',
  'blocked-terminal',
]);
export const allowedMergePolicies = new Set([
  'developer-final',
  'supervisor-auto',
  'supervisor-with-human-escalation',
  'supervisor-full-auto',
]);

const currentRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const worktreeMarker = `${sep}.worktrees${sep}`;
const worktreeMarkerIndex = currentRepoRoot.lastIndexOf(worktreeMarker);
export const primaryRepoRoot = worktreeMarkerIndex === -1 ? currentRepoRoot : currentRepoRoot.slice(0, worktreeMarkerIndex);

export function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

export function assert(condition, path, message) {
  if (!condition) {
    fail(path, message);
  }
}

export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

export function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

export function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function isSafeBranchName(value) {
  if (
    !isNonEmptyString(value) ||
    value === 'HEAD' ||
    value.startsWith('refs/') ||
    value.includes('..') ||
    value.includes('@{')
  ) {
    return false;
  }
  return value.split('/').every(
    (component) =>
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(component) && !component.endsWith('.') && !component.endsWith('.lock'),
  );
}

export function isMatchingWorktree(worktree, branch) {
  const relativeWorktree = join('.worktrees', ...branch.split('/'));
  return worktree === relativeWorktree || worktree === join(primaryRepoRoot, relativeWorktree);
}

export function parsePullRequest(value) {
  if (isPositiveInteger(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^https:\/\/github\.com\/fluojs\/fluo\/pull\/([1-9]\d*)$/u.exec(value);
  if (!match) {
    return null;
  }
  const pullRequest = Number(match[1]);
  return isPositiveInteger(pullRequest) ? pullRequest : null;
}

export function registerPullRequest(assignments, value, issue, path) {
  const pullRequest = parsePullRequest(value);
  assert(pullRequest !== null, path, 'pr must be a positive integer or canonical fluojs/fluo pull URL');
  const assignedIssue = assignments.get(pullRequest);
  assert(assignedIssue === undefined || assignedIssue === issue, path, `duplicate PR mapping: ${String(pullRequest)}`);
  assignments.set(pullRequest, issue);
  return pullRequest;
}
