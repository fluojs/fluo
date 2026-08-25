import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';

import {
  assertContract,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';

const bindingPath = (runtimeRoot, laneId) =>
  resolve(runtimeRoot, laneId, 'dag-binding.json');

const assertRealFile = (path) => {
  if (!existsSync(path)) {
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const ensureRealDirectory = (directory) => {
  if (!existsSync(directory)) {
    mkdirSync(directory);
  }
  const stat = lstatSync(directory);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(directory) !== resolve(directory)
  ) {
    throw new TypeError('DAG binding directory must be a real directory.');
  }
};

const laneDirectory = (runtimeRoot, laneId) => {
  ensureRealDirectory(runtimeRoot);
  const directory = resolve(runtimeRoot, laneId);
  if (!directory.startsWith(`${resolve(runtimeRoot)}${sep}`)) {
    throw new TypeError('DAG binding lane path must stay under runtime root.');
  }
  ensureRealDirectory(directory);
  return directory;
};

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
  laneDirectory(runtimeRoot, binding.lane_id);
  const target = bindingPath(runtimeRoot, binding.lane_id);
  assertRealFile(target);
  const acceptPersisted = () => {
    assertRealFile(target);
    const persisted = JSON.parse(readFileSync(target, 'utf8'));
    assertContract('lane-dag-binding', persisted);
    if (JSON.stringify(persisted) === JSON.stringify(binding)) {
      return;
    }
    throw new TypeError('DAG binding conflicts with the persisted run.');
  };
  if (existsSync(target)) {
    return acceptPersisted();
  }
  const candidate = `${target}.${randomUUID()}.tmp`;
  writeFileSync(candidate, `${JSON.stringify(binding, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    try {
      linkSync(candidate, target);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      return acceptPersisted();
    }
  } finally {
    if (existsSync(candidate)) {
      unlinkSync(candidate);
    }
  }
};

export const loadDagBinding = (runtimeRoot, laneId) => {
  laneDirectory(runtimeRoot, laneId);
  const target = bindingPath(runtimeRoot, laneId);
  assertRealFile(target);
  if (!existsSync(target)) {
    return null;
  }
  const binding = JSON.parse(readFileSync(target, 'utf8'));
  assertContract('lane-dag-binding', binding);
  return binding;
};
