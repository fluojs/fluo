import {
  assert,
  hasExactKeys,
  isObject,
  isPositiveInteger,
} from './lane-ledger-contract.mjs';

const retryPolicyKeys = [
  'retry_count_is_terminal',
  'max_same_failure_repeats',
  'max_wall_clock_minutes',
  'stop_on_child_contract_error',
];

export function validateRetryPolicy(path, retryPolicy, mergePolicy) {
  assert(isObject(retryPolicy), path, 'retry_policy is required; migrate legacy completion evidence to canonical issue_progress');
  assert(hasExactKeys(retryPolicy, retryPolicyKeys), path, 'retry_policy must contain exactly the canonical keys');
  assert(typeof retryPolicy.retry_count_is_terminal === 'boolean', path, 'retry_policy.retry_count_is_terminal must be a boolean');
  assert(typeof retryPolicy.stop_on_child_contract_error === 'boolean', path, 'retry_policy.stop_on_child_contract_error must be a boolean');
  assert(retryPolicy.stop_on_child_contract_error === true, path, 'retry_policy.stop_on_child_contract_error must be true');
  assert(
    retryPolicy.max_same_failure_repeats === null ||
      isPositiveInteger(retryPolicy.max_same_failure_repeats),
    path,
    'retry_policy.max_same_failure_repeats must be a positive safe integer or null',
  );
  assert(
    retryPolicy.max_wall_clock_minutes === null ||
      isPositiveInteger(retryPolicy.max_wall_clock_minutes),
    path,
    'retry_policy.max_wall_clock_minutes must be a positive safe integer or null',
  );
  const bounded =
    isPositiveInteger(retryPolicy.max_same_failure_repeats) &&
    isPositiveInteger(retryPolicy.max_wall_clock_minutes);
  const adaptive =
    retryPolicy.max_same_failure_repeats === null &&
    retryPolicy.max_wall_clock_minutes === null;
  assert(bounded || adaptive, path, 'retry_policy limits must both be positive safe integers or both be null');
  if (adaptive) {
    assert(retryPolicy.retry_count_is_terminal === false, path, 'adaptive retry_policy.retry_count_is_terminal must be false');
  } else if (mergePolicy === 'supervisor-full-auto') {
    assert(retryPolicy.retry_count_is_terminal === false, path, 'retry_policy.retry_count_is_terminal must be false for supervisor-full-auto');
  } else {
    assert(retryPolicy.retry_count_is_terminal === true, path, 'bounded retry_policy.retry_count_is_terminal must be true unless merge_policy is supervisor-full-auto');
  }
}
