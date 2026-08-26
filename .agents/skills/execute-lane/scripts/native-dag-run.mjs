import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import {
  canonicalNativeDagKeyPath,
  canonicalNativeDagRunPath,
} from './lane-runtime-paths.mjs';

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const submittedNode = (node) => {
  if (
    !isRecord(node) ||
    typeof node.id !== 'string' ||
    typeof node.label !== 'string' ||
    typeof node.description !== 'string' ||
    typeof node.task_summary !== 'string' ||
    typeof node.category !== 'string' ||
    !Array.isArray(node.load_skills) ||
    !Array.isArray(node.dependsOn) ||
    typeof node.prompt !== 'string'
  ) {
    throw new TypeError('native DAG definition contains an invalid node.');
  }
  return {
    id: node.id,
    label: node.label,
    description: node.description,
    task_summary: node.task_summary,
    category: node.category,
    load_skills: node.load_skills,
    dependsOn: node.dependsOn,
    prompt: node.prompt,
  };
};

export const loadLaneNativeDagRun = ({
  repository_root,
  lane_id,
  run_id,
}) => {
  const path = canonicalNativeDagRunPath(repository_root, run_id);
  const run = JSON.parse(readFileSync(path, 'utf8'));
  const expectedKey = `fluo:lane:${lane_id}:issue-supervisors:v2`;
  if (
    !isRecord(run) ||
    run.schemaVersion !== 1 ||
    run.runId !== run_id ||
    run.runKey !== expectedKey ||
    typeof run.parentSessionId !== 'string' ||
    !/^[a-z0-9-]{20,}$/u.test(run.parentSessionId) ||
    typeof run.name !== 'string' ||
    typeof run.definitionFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(run.definitionFingerprint) ||
    !isRecord(run.definition) ||
    run.definition.key !== expectedKey ||
    run.definition.name !== run.name ||
    !Array.isArray(run.definition.nodes)
  ) {
    throw new TypeError(
      `native DAG run ${run_id} does not match lane ${lane_id}.`,
    );
  }
  const keyId = createHash('sha256')
    .update(`${run.parentSessionId}\0${run.runKey}`)
    .digest('hex');
  const keyPath = canonicalNativeDagKeyPath(repository_root, keyId);
  const keyRecord = JSON.parse(readFileSync(keyPath, 'utf8'));
  if (
    !isRecord(keyRecord) ||
    keyRecord.schemaVersion !== 1 ||
    keyRecord.parentSessionId !== run.parentSessionId ||
    keyRecord.runKey !== run.runKey ||
    keyRecord.runId !== run.runId ||
    keyRecord.definitionFingerprint !== run.definitionFingerprint
  ) {
    throw new TypeError(
      'native DAG key record does not authenticate the run.',
    );
  }
  const definition = {
    key: run.definition.key,
    name: run.definition.name,
    nodes: run.definition.nodes.map(submittedNode),
  };
  return {
    run_id,
    definition,
    definition_sha256: payloadDigest(definition),
    definition_fingerprint: run.definitionFingerprint,
  };
};
