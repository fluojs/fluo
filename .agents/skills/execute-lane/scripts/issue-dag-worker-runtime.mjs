import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  parseSenpiFinalResponse,
} from './senpi-final-response.mjs';
import {
  OPERATOR_FINAL_SENTINEL,
  PREFLIGHT_FINAL_SENTINEL,
} from './issue-dag-prompts.mjs';
import {
  assertReviewPreflight,
} from './review-loop-policy.mjs';

const orchestrationTools = new Set([
  'task',
  'dag',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'task_send',
  'task_output',
  'task_cancel',
  'team_create',
  'team_delete',
]);
const preflightTools = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'lsp_diagnostics',
  'lsp_find_references',
  'lsp_goto_definition',
  'lsp_symbols',
  'web_search',
  'webfetch',
]);

const canonicalFile = (path, name) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError(`${name} must be a real canonical file.`);
  }
  return readFileSync(path, 'utf8');
};

const record = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const canonicalTask = (root, taskId) => {
  const repositoryRoot = resolve(root);
  const task = record(
    JSON.parse(
      canonicalFile(
        resolve(
          repositoryRoot,
          '.omo',
          'senpi-task',
          'tasks',
          `${taskId}.json`,
        ),
        'issue DAG worker task',
      ),
    ),
    'issue DAG worker task',
  );
  return { repositoryRoot, task };
};

const sessionTools = (root, taskId) => {
  const source = canonicalFile(
    resolve(root, '.omo', 'senpi-task', 'logs', `${taskId}.jsonl`),
    'issue DAG worker session log',
  );
  return source
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === 'tool_execution')
    .map((event) => record(event.payload, 'issue DAG worker tool event'));
};

const verifyWorker = (expected, agentType, allowedTools) => {
  const { repositoryRoot, task } = canonicalTask(
    expected.repository_root,
    expected.task_id,
  );
  const owner = record(task.owner, 'issue DAG worker owner');
  if (
    task.task_id !== expected.task_id ||
    task.status !== 'completed' ||
    task.parent_session_id !== expected.parent_session_id ||
    task.name !== expected.node_id ||
    task.agent_type !== agentType ||
    task.spawn_spec?.cwd !== repositoryRoot ||
    owner.kind !== 'dag' ||
    owner.runId !== expected.dag_run_id ||
    owner.nodeId !== expected.node_id ||
    owner.fingerprint !== expected.dag_owner_fingerprint
  ) {
    throw new TypeError('Issue DAG worker provenance is invalid.');
  }
  const tools = sessionTools(repositoryRoot, expected.task_id);
  if (
    tools.some(
      ({ tool }) =>
        orchestrationTools.has(tool) ||
        (allowedTools !== null && !allowedTools.has(tool)),
    )
  ) {
    throw new TypeError('Issue DAG worker used a forbidden tool.');
  }
  return { repositoryRoot, task, tools };
};

const verifyIdentity = (output, expected) => {
  if (
    output.lane_id !== expected.lane_id ||
    output.issue_number !== expected.issue_number ||
    output.dag_key !== expected.dag_key ||
    output.node_id !== expected.node_id
  ) {
    throw new TypeError('Issue DAG worker final identity does not match.');
  }
};

export const verifyPreflightTask = (expected) => {
  const evidence = verifyWorker(
    expected,
    'fluo-issue-preflight',
    preflightTools,
  );
  const output = parseSenpiFinalResponse(
    evidence.task.final_response,
    PREFLIGHT_FINAL_SENTINEL,
    'preflight task final_response',
  );
  verifyIdentity(output, expected);
  const preflight = assertReviewPreflight(output.preflight);
  if (
    preflight.lane_id !== expected.lane_id ||
    preflight.issue_number !== expected.issue_number ||
    preflight.head_sha !== expected.head_sha
  ) {
    throw new TypeError('Preflight task result does not match its exact head.');
  }
  return {
    task_id: expected.task_id,
    record_sha256: payloadDigest(evidence.task),
    output_sha256: payloadDigest(output),
    preflight: structuredClone(preflight),
    tool_events: structuredClone(evidence.tools),
  };
};

export const verifyIssueOperatorTask = (expected) => {
  const evidence = verifyWorker(
    expected,
    'fluo-issue-operator',
    null,
  );
  const output = parseSenpiFinalResponse(
    evidence.task.final_response,
    OPERATOR_FINAL_SENTINEL,
    'issue operator task final_response',
  );
  verifyIdentity(output, expected);
  if (
    output.operation !== expected.operation ||
    output.head_sha !== expected.head_sha
  ) {
    throw new TypeError('Issue operator result does not match its operation.');
  }
  return {
    task_id: expected.task_id,
    record_sha256: payloadDigest(evidence.task),
    output_sha256: payloadDigest(output),
    final_response: output,
    tool_events: structuredClone(evidence.tools),
  };
};
