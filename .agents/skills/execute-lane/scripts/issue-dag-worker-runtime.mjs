import {
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

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
  createReviewPreflight,
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
const preflightTools = Object.freeze([
  'read',
  'todo',
]);
const operatorTools = Object.freeze([
  'read',
  'bash',
]);

const canonicalFile = (path, name) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError(`${name} must be a real canonical file.`);
  }
  return readFileSync(path, 'utf8');
};

const canonicalDirectory = (path, name) => {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(path) !== path
  ) {
    throw new TypeError(`${name} must be a real canonical directory.`);
  }
  return path;
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
  const sessionRoot = canonicalDirectory(
    resolve(
      root,
      '.omo',
      'senpi-task',
      'children',
      taskId,
      'sessions',
      taskId,
    ),
    'issue DAG worker child session',
  );
  const files = readdirSync(sessionRoot)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) {
    throw new TypeError(
      'issue DAG worker child session must contain canonical Senpi JSONL.',
    );
  }
  const tools = [];
  for (const file of files) {
    const calls = [];
    const results = new Map();
    const source = canonicalFile(
      join(sessionRoot, file),
      'issue DAG worker child session JSONL',
    );
    for (const [index, line] of source
      .split('\n')
      .filter(Boolean)
      .entries()) {
      let event;
      try {
        event = record(
          JSON.parse(line),
          `issue DAG worker session event ${String(index + 1)}`,
        );
      } catch (error) {
        throw new TypeError(
          `issue DAG worker child session JSONL is malformed: ${error.message}`,
        );
      }
      if (event.type !== 'message') continue;
      const message = record(
        event.message,
        'issue DAG worker session message',
      );
      if (message.role === 'assistant') {
        if (!Array.isArray(message.content)) {
          throw new TypeError(
            'issue DAG worker assistant message content is malformed.',
          );
        }
        for (const part of message.content) {
          if (part?.type !== 'toolCall') continue;
          if (
            typeof part.id !== 'string' ||
            typeof part.name !== 'string'
          ) {
            throw new TypeError('issue DAG worker tool call is malformed.');
          }
          calls.push({
            id: part.id,
            tool: part.name,
            arguments: record(
              part.arguments,
              'issue DAG worker tool call arguments',
            ),
          });
        }
      } else if (message.role === 'toolResult') {
        if (
          typeof message.toolCallId !== 'string' ||
          typeof message.isError !== 'boolean'
        ) {
          throw new TypeError('issue DAG worker tool result is malformed.');
        }
        results.set(message.toolCallId, message.isError);
      }
    }
    for (const call of calls) {
      if (!results.has(call.id)) {
        throw new TypeError(
          'issue DAG worker tool call is missing its canonical result.',
        );
      }
      tools.push({
        tool: call.tool,
        is_error: results.get(call.id),
        arguments: structuredClone(call.arguments),
      });
    }
  }
  return tools;
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
    task.execution_mode !== 'process' ||
    task.parent_session_id !== expected.parent_session_id ||
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
    JSON.stringify(task.tool_allow) !== JSON.stringify(allowedTools) ||
    tools.some(
      ({ tool }) =>
        orchestrationTools.has(tool) ||
        !allowedTools.includes(tool),
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

const verifyPreflightReadCoverage = (evidence, expected) => {
  const prompt = evidence.task.spawn_spec?.prompt;
  if (typeof prompt !== 'string') {
    throw new TypeError('Preflight task terminal dispatch is missing.');
  }
  const matches = [
    ...prompt.matchAll(
      /<fluo-terminal-dispatch-v1>\n([\s\S]*?)\n<\/fluo-terminal-dispatch-v1>/gu,
    ),
  ];
  if (matches.length !== 1) {
    throw new TypeError('Preflight task terminal dispatch is invalid.');
  }
  let dispatch;
  try {
    dispatch = record(
      JSON.parse(matches[0][1]),
      'preflight task terminal dispatch',
    );
  } catch {
    throw new TypeError('Preflight task terminal dispatch is invalid.');
  }
  if (
    dispatch.lane_id !== expected.lane_id ||
    dispatch.issue_number !== expected.issue_number ||
    dispatch.dag_key !== expected.dag_key ||
    dispatch.node_id !== expected.node_id ||
    resolve(dispatch.repository_root) !== evidence.repositoryRoot ||
    dispatch.starting_head_sha !== expected.head_sha ||
    dispatch.lane_ledger_path !== expected.lane_ledger_path ||
    dispatch.issue_store_path !== expected.issue_store_path ||
    JSON.stringify(dispatch.evidence_paths) !==
      JSON.stringify(expected.evidence_paths) ||
    dispatch.issue_contract_sha256 !==
      expected.issue_contract_sha256 ||
    dispatch.lane_plan_approval_sha256 !==
      expected.lane_plan_approval_sha256
  ) {
    throw new TypeError(
      'Preflight task terminal dispatch does not match parent authority.',
    );
  }
  const readPaths = new Set(
    evidence.tools
      .filter(
        ({ tool, is_error, arguments: args }) =>
          tool === 'read' &&
          is_error === false &&
          args.offset === undefined &&
          args.limit === undefined,
      )
      .map(({ arguments: args }) => args.path)
      .filter((path) => typeof path === 'string')
      .map((path) => resolve(evidence.repositoryRoot, path)),
  );
  const requiredPaths = new Set([
    dispatch.lane_ledger_path,
    dispatch.issue_store_path,
    ...dispatch.evidence_paths,
  ]);
  if (
    [...requiredPaths].some(
      (path) =>
        !readPaths.has(resolve(evidence.repositoryRoot, path)),
    )
  ) {
    throw new TypeError(
      'Preflight task did not read every parent-bound artifact.',
    );
  }
};

const parsePreflightFinalResponse = (value) => {
  const output = parseSenpiFinalResponse(
    value,
    PREFLIGHT_FINAL_SENTINEL,
    'preflight task final_response',
  );
  if (
    Object.keys(output).sort().join(',') !==
      [
        'dag_key',
        'issue_number',
        'lane_id',
        'node_id',
        'preflight',
        'sentinel',
        'status',
        'version',
      ].sort().join(',')
  ) {
    throw new TypeError(
      'Preflight task final_response envelope keys are invalid.',
    );
  }
  return output;
};

export const verifyPreflightTask = (expected) => {
  const evidence = verifyWorker(
    expected,
    'fluo-issue-preflight',
    preflightTools,
  );
  verifyPreflightReadCoverage(evidence, expected);
  const output = parsePreflightFinalResponse(evidence.task.final_response);
  verifyIdentity(output, expected);
  const preflight =
    output.preflight?.sha256 === undefined
      ? createReviewPreflight(output.preflight)
      : assertReviewPreflight(output.preflight);
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
    operatorTools,
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
