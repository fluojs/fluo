import { resolve } from 'node:path';

import {
  assertContract,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  ensureLaneDirectory,
  loadImmutableBinding,
  persistImmutableBinding,
} from './dag-binding-files.mjs';

const bindingPath = (runtimeRoot, laneId) =>
  resolve(runtimeRoot, laneId, 'dag-binding.json');

export const createDagBinding = ({
  definition,
  lane_id,
  run_id,
  snapshot_event_hash,
}) => {
  const canonicalKey = `fluo:lane:${lane_id}:issue-supervisors:v1`;
  if (definition.key !== canonicalKey) {
    throw new TypeError('DAG definition key must be canonical for its lane.');
  }
  const binding = {
    version: 1,
    lane_id,
    dag_key: definition.key,
    run_id,
    definition_sha256: payloadDigest(definition),
    snapshot_event_hash,
    status: 'attached',
  };
  assertContract('lane-dag-binding', binding);
  return binding;
};

export const assertDagBindingMatches = (
  binding,
  { definition, lane_id, run_id, snapshot_event_hash },
) => {
  assertContract('lane-dag-binding', binding);
  if (binding.version !== 1) {
    throw new TypeError('Lane-wide DAG binding must use version 1.');
  }
  if (binding.definition_sha256 !== payloadDigest(definition)) {
    throw new TypeError('DAG binding definition digest does not match.');
  }
  if (
    binding.dag_key !==
    `fluo:lane:${binding.lane_id}:issue-supervisors:v1`
  ) {
    throw new TypeError('DAG binding key is not canonical for its lane.');
  }
  if (
    binding.lane_id !== lane_id ||
    binding.dag_key !== definition.key ||
    binding.run_id !== run_id ||
    binding.snapshot_event_hash !== snapshot_event_hash
  ) {
    throw new TypeError('DAG binding identity does not match the persisted run.');
  }
};

export const persistDagBinding = (runtimeRoot, binding) => {
  assertContract('lane-dag-binding', binding);
  if (binding.version !== 1) {
    throw new TypeError('Lane-wide DAG binding must use version 1.');
  }
  ensureLaneDirectory(runtimeRoot, binding.lane_id);
  persistImmutableBinding(
    bindingPath(runtimeRoot, binding.lane_id),
    binding,
  );
};

export const loadDagBinding = (runtimeRoot, laneId) => {
  ensureLaneDirectory(runtimeRoot, laneId);
  const binding = loadImmutableBinding(bindingPath(runtimeRoot, laneId));
  if (binding === null) {
    return null;
  }
  if (binding.version !== 1) {
    throw new TypeError('Lane-wide DAG binding path requires version 1.');
  }
  return binding;
};

export {
  assertIssueDagBindingMatches,
  createIssueDagBinding,
  loadIssueDagBinding,
  persistIssueDagBinding,
} from './issue-dag-binding.mjs';
