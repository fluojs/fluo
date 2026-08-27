import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  assertIssueDagState,
} from './issue-dag-contracts.mjs';

const record = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const taskRecordFor = (records, taskId) => {
  const recordValue = records[taskId];
  if (recordValue === undefined) {
    throw new TypeError(`Issue DAG task record ${taskId} is missing.`);
  }
  return record(recordValue, 'issue DAG task record');
};

const nativeNodeFor = (nodes, nodeId) => {
  const candidate = Array.isArray(nodes)
    ? nodes.find((node) => node?.id === nodeId)
    : nodes?.[nodeId];
  if (candidate === undefined) {
    throw new TypeError(`Issue DAG native node ${nodeId} is missing.`);
  }
  return record(candidate, 'issue DAG native node');
};

export const verifyIssueDagPhaseResult = ({
  state,
  native_run: nativeRunInput,
  task_records: taskRecordsInput,
}) => {
  assertIssueDagState(state);
  const nativeRun = record(nativeRunInput, 'issue DAG native run');
  const taskRecords = record(taskRecordsInput, 'issue DAG task records');
  if (
    state.status !== 'native-completed-unverified' ||
    nativeRun.status !== 'completed'
  ) {
    throw new TypeError('Issue DAG phase is not completed.');
  }
  if (
    nativeRun.runId !== state.run_id ||
    nativeRun.runKey !== state.dag_key ||
    nativeRun.parentSessionId !== state.coordinator_session_id ||
    nativeRun.definitionFingerprint !== state.definition_fingerprint ||
    nativeRun.generation !== state.native_generation
  ) {
    throw new TypeError('Issue DAG completed run identity does not match.');
  }
  const taskIds = new Set();
  const bindings = state.active_node_ids.map((nodeId) => {
    const nativeNode = nativeNodeFor(nativeRun.nodes, nodeId);
    if (
      nativeNode.id !== nodeId ||
      nativeNode.state !== 'completed' ||
      typeof nativeNode.taskId !== 'string' ||
      taskIds.has(nativeNode.taskId)
    ) {
      throw new TypeError('Issue DAG native node completion is invalid.');
    }
    taskIds.add(nativeNode.taskId);
    const task = taskRecordFor(taskRecords, nativeNode.taskId);
    const owner = record(task.owner, 'issue DAG task owner');
    const attachment = nativeRun.task_attachments?.[nodeId];
    if (
      task.task_id !== nativeNode.taskId ||
      task.status !== 'completed' ||
      task.parent_session_id !== state.coordinator_session_id ||
      owner.kind !== 'dag' ||
      owner.runId !== state.run_id ||
      owner.nodeId !== nodeId ||
      !/^[a-f0-9]{64}$/u.test(owner.fingerprint ?? '') ||
      attachment?.task_id !== nativeNode.taskId ||
      !Number.isSafeInteger(attachment.event_sequence) ||
      attachment.event_sequence < 1
    ) {
      throw new TypeError('Issue DAG task owner does not match its native node.');
    }
    return {
      node_id: nodeId,
      task_id: nativeNode.taskId,
      attachment_event_sequence: attachment.event_sequence,
      task_record_sha256: payloadDigest(task),
      final_response_sha256: payloadDigest(task.final_response),
    };
  });
  return {
    completed_node_ids: [...state.active_node_ids],
    task_bindings: bindings,
  };
};
