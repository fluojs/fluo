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
export const allowedMergePolicies = new Set([
  'developer-final',
  'supervisor-auto',
  'supervisor-with-human-escalation',
  'supervisor-full-auto',
]);

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

export function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

export function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function isPullRequest(value) {
  return (
    isPositiveInteger(value) ||
    (typeof value === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/u.test(value))
  );
}
