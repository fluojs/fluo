import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertContract,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  ensureLaneDirectory,
  ensureRealDirectory,
  loadImmutableBinding,
  persistImmutableBinding,
} from './dag-binding-files.mjs';

const issueBindingPath = (runtimeRoot, laneId, issueNumber) =>
  resolve(
    runtimeRoot,
    laneId,
    'dag-bindings',
    `issue-${String(issueNumber)}.json`,
  );

const assertIssueNumber = (issueNumber) => {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new TypeError('Issue DAG binding requires a positive issue number.');
  }
};

export const createIssueDagBinding = ({
  definition,
  lane_id,
  issue_number,
  dependencies,
  run_id,
  dispatch_event_hash,
}) => {
  assertIssueNumber(issue_number);
  const canonicalKey = `fluo:lane:${lane_id}:issue-${String(issue_number)}:supervisor:v2`;
  if (definition.key !== canonicalKey) {
    throw new TypeError(
      'Issue DAG definition key must be canonical for its lane and issue.',
    );
  }
  const binding = {
    version: 2,
    lane_id,
    issue_number,
    dependencies,
    dag_key: definition.key,
    run_id,
    definition_sha256: payloadDigest(definition),
    dispatch_event_hash,
    status: 'attached',
  };
  assertContract('lane-dag-binding', binding);
  return binding;
};

export const assertIssueDagBindingMatches = (
  binding,
  {
    definition,
    lane_id,
    issue_number,
    dependencies,
    run_id,
    dispatch_event_hash,
  },
) => {
  assertContract('lane-dag-binding', binding);
  if (binding.version !== 2) {
    throw new TypeError('Issue DAG binding must use version 2.');
  }
  if (binding.definition_sha256 !== payloadDigest(definition)) {
    throw new TypeError('Issue DAG binding definition digest does not match.');
  }
  if (
    binding.lane_id !== lane_id ||
    binding.issue_number !== issue_number ||
    JSON.stringify(binding.dependencies) !== JSON.stringify(dependencies) ||
    binding.dag_key !== definition.key ||
    binding.run_id !== run_id ||
    binding.dispatch_event_hash !== dispatch_event_hash
  ) {
    throw new TypeError('Issue DAG binding identity does not match.');
  }
};

export const persistIssueDagBinding = (runtimeRoot, binding) => {
  assertContract('lane-dag-binding', binding);
  if (binding.version !== 2) {
    throw new TypeError('Issue DAG binding must use version 2.');
  }
  const directory = resolve(
    ensureLaneDirectory(runtimeRoot, binding.lane_id),
    'dag-bindings',
  );
  ensureRealDirectory(directory);
  persistImmutableBinding(
    issueBindingPath(runtimeRoot, binding.lane_id, binding.issue_number),
    binding,
  );
};

export const loadIssueDagBinding = (runtimeRoot, laneId, issueNumber) => {
  assertIssueNumber(issueNumber);
  const directory = resolve(
    ensureLaneDirectory(runtimeRoot, laneId),
    'dag-bindings',
  );
  if (!existsSync(directory)) {
    return null;
  }
  ensureRealDirectory(directory);
  const binding = loadImmutableBinding(
    issueBindingPath(runtimeRoot, laneId, issueNumber),
  );
  if (binding === null) {
    return null;
  }
  if (
    binding.version !== 2 ||
    binding.lane_id !== laneId ||
    binding.issue_number !== issueNumber
  ) {
    throw new TypeError('Issue DAG binding identity does not match its path.');
  }
  return binding;
};
