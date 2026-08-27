import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  canonicalIssueDagDefinition,
  issueDagKey,
} from './issue-dag-contracts.mjs';
import {
  canonicalNativeDagKeyPath,
  canonicalNativeDagEventPath,
  canonicalNativeDagRunPath,
} from './lane-runtime-paths.mjs';

const record = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const submittedNode = (input) => {
  const node = record(input, 'native DAG node');
  const hasCategory =
    typeof node.category === 'string' && node.category.length > 0;
  const hasAgent =
    typeof node.subagent_type === 'string' &&
    node.subagent_type.length > 0;
  const hasModel =
    typeof node.model === 'string' && node.model.length > 0;
  if (
    typeof node.id !== 'string' ||
    typeof node.label !== 'string' ||
    typeof node.description !== 'string' ||
    typeof node.task_summary !== 'string' ||
    hasCategory === hasAgent ||
    (node.model !== undefined && !hasModel) ||
    (hasCategory && hasModel) ||
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
    ...(hasCategory
      ? { category: node.category }
      : { subagent_type: node.subagent_type }),
    ...(hasModel ? { model: node.model } : {}),
    load_skills: node.load_skills,
    dependsOn: node.dependsOn,
    prompt: node.prompt,
  };
};

const authenticateKeyRecord = (repositoryRoot, run) => {
  const keyId = createHash('sha256')
    .update(`${run.parentSessionId}\0${run.runKey}`)
    .digest('hex');
  const keyRecord = JSON.parse(
    readFileSync(canonicalNativeDagKeyPath(repositoryRoot, keyId), 'utf8'),
  );
  if (
    typeof keyRecord !== 'object' ||
    keyRecord === null ||
    keyRecord.schemaVersion !== 1 ||
    keyRecord.parentSessionId !== run.parentSessionId ||
    keyRecord.runKey !== run.runKey ||
    keyRecord.runId !== run.runId ||
    keyRecord.definitionFingerprint !== run.definitionFingerprint
  ) {
    throw new TypeError('native DAG key record does not authenticate the run.');
  }
};

const nativeEvents = (repositoryRoot, runId) => {
  const events = readFileSync(
    canonicalNativeDagEventPath(repositoryRoot, runId),
    'utf8',
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  events.forEach((event, index) => {
    if (
      event.schemaVersion !== 1 ||
      event.runId !== runId ||
      event.seq !== index + 1
    ) {
      throw new TypeError('native DAG event journal is invalid.');
    }
  });
  return events;
};

const amendmentFor = (event, laneId, issueNumber) => {
  if (
    !/^[a-f0-9]{64}$/u.test(event.previousFingerprint ?? '') ||
    !/^[a-f0-9]{64}$/u.test(event.fingerprint ?? '') ||
    !Array.isArray(event.addedNodeIds) ||
    !Array.isArray(event.changedNodeIds) ||
    !Array.isArray(event.invalidatedNodeIds)
  ) {
    throw new TypeError('native DAG amendment event is invalid.');
  }
  const source = record(event.definition, 'native amended definition');
  const definition = canonicalIssueDagDefinition({
    key: source.key,
    name: source.name,
    nodes: source.nodes.map(submittedNode),
  }, laneId, issueNumber);
  return {
    event_sequence: event.seq,
    previous_fingerprint: event.previousFingerprint,
    fingerprint: event.fingerprint,
    added_node_ids: [...event.addedNodeIds],
    changed_node_ids: [...event.changedNodeIds],
    invalidated_node_ids: [...event.invalidatedNodeIds],
    definition,
    definition_sha256: payloadDigest(definition),
  };
};

export const loadIssueNativeDagRun = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  run_id: runId,
  coordinator_session_id: coordinatorSessionId,
}) => {
  const run = JSON.parse(
    readFileSync(canonicalNativeDagRunPath(repositoryRoot, runId), 'utf8'),
  );
  const expectedKey = issueDagKey(laneId, issueNumber);
  if (
    typeof run !== 'object' ||
    run === null ||
    run.schemaVersion !== 1 ||
    run.runId !== runId ||
    run.runKey !== expectedKey ||
    (coordinatorSessionId !== undefined &&
      run.parentSessionId !== coordinatorSessionId) ||
    typeof run.parentSessionId !== 'string' ||
    run.parentSessionId.length === 0 ||
    typeof run.name !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(run.definitionFingerprint ?? '') ||
    !Number.isSafeInteger(run.generation) ||
    run.generation < 1 ||
    typeof run.status !== 'string'
  ) {
    throw new TypeError(
      `native DAG run ${runId} does not match lane ${laneId} issue ${String(issueNumber)}.`,
    );
  }
  const sourceDefinition = record(run.definition, 'native DAG definition');
  if (!Array.isArray(sourceDefinition.nodes)) {
    throw new TypeError('native DAG definition nodes are missing.');
  }
  const definition = canonicalIssueDagDefinition({
    key: sourceDefinition.key,
    name: sourceDefinition.name,
    nodes: sourceDefinition.nodes.map(submittedNode),
  }, laneId, issueNumber);
  if (definition.name !== run.name) {
    throw new TypeError('native DAG run name does not match its definition.');
  }
  authenticateKeyRecord(repositoryRoot, run);
  const events = nativeEvents(repositoryRoot, runId);
  const amendments = events
    .filter((event) => event.type === 'dag.definition.amended')
    .map((event) => amendmentFor(event, laneId, issueNumber));
  if (
    amendments.length !== run.generation - 1 ||
    (amendments.length > 0 &&
      amendments.at(-1).fingerprint !== run.definitionFingerprint)
  ) {
    throw new TypeError('native DAG amendment history does not match the run.');
  }
  const taskAttachments = Object.fromEntries(
    events
      .filter((event) => event.type === 'dag.node.task-attached')
      .map((event) => [
        event.nodeId,
        {
          task_id: event.taskId,
          attempt: event.attempt,
          event_sequence: event.seq,
        },
      ]),
  );
  return {
    run_id: runId,
    run_key: run.runKey,
    parent_session_id: run.parentSessionId,
    status: run.status,
    native_generation: run.generation,
    definition,
    definition_sha256: payloadDigest(definition),
    definition_fingerprint: run.definitionFingerprint,
    nodes: structuredClone(run.nodes ?? {}),
    amendments,
    task_attachments: taskAttachments,
    events_sha256: payloadDigest(events),
  };
};
