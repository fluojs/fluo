import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { parseSenpiFinalResponse } from './senpi-final-response.mjs';
import {
  canonicalPreflightArtifactPath,
  parseTerminalDispatch,
  parseTerminalDispatchShape,
  terminalDispatchBlock,
  terminalTaskPrompt,
} from './dispatch-authority.mjs';

const IMPLEMENTER_AGENT = 'fluo-issue-implementer';
const IMPLEMENTER_PROVIDER = 'openai-codex';
const IMPLEMENTER_MODEL = 'gpt-5.6-terra';
const IMPLEMENTER_THINKING = 'high';
const TASK_ID = /^st_[A-Za-z0-9_-]+$/u;
const IMPLEMENTER_TOOLS = Object.freeze([
  'read',
  'bash',
  'apply_patch',
]);
const ORCHESTRATION_TOOLS = new Set([
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
export const IMPLEMENTER_SCOPE = 'issue-worktree-read-write';
export const CONFLICT_IMPLEMENTER_SCOPE = 'conflict-resolution';
export const CONFLICT_IMPLEMENTER_SENTINEL = 'fluo:execute-lane:conflict-implementer:dispatch:v1';
export const CONFLICT_IMPLEMENTER_FINAL_SENTINEL = 'fluo:execute-lane:conflict-implementer:final:v1';
export const IMPLEMENTER_SENTINEL = 'fluo:execute-lane:implementer:dispatch:v1';
export const IMPLEMENTER_FINAL_SENTINEL = 'fluo:execute-lane:implementer:final:v1';
const IMPLEMENTER_FINAL_KEYS = [
  'sentinel',
  'lane_id',
  'issue_number',
  'worktree',
  'parent_session_id',
  'current_head',
  'new_head',
  'generation',
  'scope',
  'result',
  'verification',
  'addressed_blockers',
  'blocker_ledger_sha256',
  'preflight_sha256',
];
const IMPLEMENTER_RESULTS = new Set([
  'implementation-completed',
  'fix-completed',
]);

export const implementerRoute = Object.freeze({
  subagent_type: IMPLEMENTER_AGENT,
  expected_model: `${IMPLEMENTER_PROVIDER}/${IMPLEMENTER_MODEL}`,
  expected_thinking: IMPLEMENTER_THINKING,
});

export const implementerTaskName = (issueNumber, generation, currentHead) =>
  `fluo-implement-${String(issueNumber)}-g${String(generation)}-${currentHead.slice(0, 12)}`;

export const implementerPromptSentinel = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  current_head: currentHead,
  parent_session_id: parentSessionId,
  generation,
  blocker_ledger: blockerLedger,
  unresolved_blockers: unresolvedBlockers,
  blocker_ledger_sha256: blockerLedgerSha256,
  preflight_sha256: preflightSha256,
  dag_key: dagKey,
  node_id: nodeId,
}) =>
  terminalDispatchBlock({
    version: 2,
    sentinel: IMPLEMENTER_SENTINEL,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    current_head: currentHead,
    parent_session_id: parentSessionId,
    generation,
    scope: IMPLEMENTER_SCOPE,
    local_ci_role: 'focused-test-first-only',
    full_local_ci: false,
    tool_policy: {
      allowed: [...IMPLEMENTER_TOOLS],
      forbidden: ['eval', 'todo', 'task', 'dag', 'team'],
    },
    blocker_ledger_sha256: blockerLedgerSha256,
    preflight_path: canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber),
    preflight_sha256: preflightSha256,
    blocker_ledger: blockerLedger,
    unresolved_blockers: unresolvedBlockers,
    ...(dagKey === undefined ? {} : { dag_key: dagKey }),
    ...(nodeId === undefined ? {} : { node_id: nodeId }),
  });

export const implementerTaskPrompt = ({
  instructions,
  ...authority
}) =>
  terminalTaskPrompt({
    instructions: `${instructions}

DELIVERABLE:
Return exactly one machine envelope with no prose or code fence:
<${IMPLEMENTER_FINAL_SENTINEL}>{"sentinel":"${IMPLEMENTER_FINAL_SENTINEL}",...}</${IMPLEMENTER_FINAL_SENTINEL}>

The JSON object must contain exactly these fields in this order:
sentinel, lane_id, issue_number, worktree, parent_session_id, current_head,
new_head, generation, scope, result, verification, addressed_blockers,
blocker_ledger_sha256, preflight_sha256.

Copy every bound identity from the terminal dispatch, use scope
${IMPLEMENTER_SCOPE}, report the observed new head and verification result, and
do not add or omit fields.

Only read, bash, and apply_patch are available. Do not call eval, todo, task,
dag, or team tools.`,
    dispatch_block: implementerPromptSentinel(authority),
  });

const assertRegularFile = (path) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const assertDirectory = (path) => {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new TypeError(`${path} must be a real directory.`);
  }
};

const parseJson = (source, path) => {
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`${path} must contain valid JSON.`);
  }
};

const assertTaskRecord = (record) => {
  if (
    record.status !== 'completed' ||
    record.execution_mode !== 'process' ||
    record.agent_type !== IMPLEMENTER_AGENT ||
    record.resolved_model?.source !== 'agent' ||
    record.resolved_model.provider !== IMPLEMENTER_PROVIDER ||
    record.resolved_model.model_id !== IMPLEMENTER_MODEL ||
    record.resolved_model.reasoning_effort !== IMPLEMENTER_THINKING ||
    JSON.stringify(record.tool_allow) !==
      JSON.stringify(IMPLEMENTER_TOOLS)
  ) {
    throw new TypeError(
      'implementer task metadata must match the configured process-mode Terra high agent and tool policy.',
    );
  }
};

const readSessionEvents = (sessionRoot) => {
  assertDirectory(sessionRoot);
  const files = readdirSync(sessionRoot).filter((name) => name.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    throw new TypeError('implementer task must persist a child session.');
  }
  const sources = [];
  const events = files.flatMap((name) => {
    const path = join(sessionRoot, name);
    assertRegularFile(path);
    const text = readFileSync(path, 'utf8');
    sources.push({ name, sha256: payloadDigest({ text }) });
    return text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => parseJson(line, path));
  });
  return { events, session_sha256: payloadDigest(sources) };
};

const inside = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${sep}`);

const safeGitCommand = (command) => {
  if (
    /(?:^|\s)(?:-C|--git-dir|--work-tree|--exec-path)(?:=|\s)/u.test(
      command,
    ) ||
    /\s--amend(?:\s|$)/u.test(command)
  ) {
    return false;
  }
  return /^(?:add|commit|diff|log|ls-files|merge-base|rev-parse|show|status)(?:\s|$)/u.test(
    command,
  );
};

const safePnpmCommand = (command) => {
  if (
    /(?:^|\s)(?:--dir|-C)(?:=|\s)/u.test(command)
  ) {
    return false;
  }
  if (
    /^(?:build|check|lint|test|typecheck|verify)(?:\s|$)/u.test(
      command,
    ) ||
    /^run\s+(?:build|check|lint|test|typecheck|verify)(?:\s|$)/u.test(
      command,
    ) ||
    /^exec\s+vitest(?:\s|$)/u.test(command)
  ) {
    return true;
  }
  if (/^exec\s+biome(?:\s|$)/u.test(command)) {
    return !/(?:^|\s)--(?:fix|write)(?:\s|$)/u.test(command);
  }
  if (/^exec\s+tsc(?:\s|$)/u.test(command)) {
    return /(?:^|\s)--noEmit(?:\s|$)/u.test(command);
  }
  return false;
};

const assertMutationToolScope = (
  toolCalls,
  repositoryRoot,
  worktree,
) => {
  const worktreeRoot = resolve(repositoryRoot, worktree);
  for (const call of toolCalls) {
    if (call.name === 'bash') {
      const command = call.arguments?.command;
      const match =
        typeof command === 'string' &&
        !/[\n;&|`$<>]/u.test(command)
          ? /^(git -C|pnpm (?:--dir|-C))\s+([^\s]+)\s+(.+)$/u.exec(
              command,
            )
          : null;
      if (
        match === null ||
        !inside(
          worktreeRoot,
          resolve(repositoryRoot, match[2]),
        ) ||
        (match[1] === 'git -C'
          ? !safeGitCommand(match[3])
          : !safePnpmCommand(match[3]))
      ) {
        throw new TypeError(
          'implementer shell commands must target only the issue worktree.',
        );
      }
    }
    if (call.name === 'apply_patch') {
      const patch = Object.values(call.arguments ?? {}).find(
        (value) => typeof value === 'string',
      );
      const paths =
        typeof patch === 'string'
          ? [...patch.matchAll(
              /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu,
            )].map((match) => match[1])
          : [];
      if (
        paths.length === 0 ||
        paths.some(
          (path) =>
            !inside(
              worktreeRoot,
              resolve(repositoryRoot, path),
            ),
        )
      ) {
        throw new TypeError(
          'implementer patches must target only the issue worktree.',
        );
      }
    }
  }
};

const assertActualRuntime = (
  events,
  allowedTools,
  repositoryRoot,
  worktree,
) => {
  const modelChanges = events.filter((event) => event.type === 'model_change');
  const thinkingChanges = events.filter((event) => event.type === 'thinking_level_change');
  const assistantMessages = events.filter(
    (event) => event.type === 'message' && event.message?.role === 'assistant',
  );
  const toolCalls = assistantMessages.flatMap((event) =>
    (event.message.content ?? [])
      .filter((part) => part?.type === 'toolCall')
      .map((part) => ({
        name: part.name,
        arguments: part.arguments,
      })),
  );
  if (
    modelChanges.length === 0 ||
    !modelChanges.every(
      (event) => event.provider === IMPLEMENTER_PROVIDER && event.modelId === IMPLEMENTER_MODEL,
    ) ||
    thinkingChanges.length === 0 ||
    !thinkingChanges.every((event) => event.thinkingLevel === IMPLEMENTER_THINKING) ||
    assistantMessages.length === 0 ||
    toolCalls.some(
      ({ name }) =>
        typeof name !== 'string' ||
        ORCHESTRATION_TOOLS.has(name) ||
        !allowedTools.includes(name),
    ) ||
    !assistantMessages.every(
      (event) =>
        event.message.provider === IMPLEMENTER_PROVIDER &&
        event.message.model === IMPLEMENTER_MODEL,
    )
  ) {
    throw new TypeError(
      'actual implementer session must use the configured model and tool policy.',
    );
  }
  assertMutationToolScope(
    toolCalls,
    repositoryRoot,
    worktree,
  );
  return assistantMessages.length;
};

const requireFinalResponse = (record, expected) => {
  const output = parseSenpiFinalResponse(
    record.final_response,
    IMPLEMENTER_FINAL_SENTINEL,
    'implementer task final_response',
  );
  if (
    JSON.stringify(Object.keys(output)) !==
      JSON.stringify(IMPLEMENTER_FINAL_KEYS) ||
    output.sentinel !== IMPLEMENTER_FINAL_SENTINEL ||
    typeof output.lane_id !== 'string' ||
    output.lane_id.length === 0 ||
    !Number.isSafeInteger(output.issue_number) ||
    output.issue_number < 1 ||
    typeof output.worktree !== 'string' ||
    output.worktree.length === 0 ||
    typeof output.parent_session_id !== 'string' ||
    output.parent_session_id.length === 0 ||
    !/^[a-f0-9]{40}$/u.test(output.current_head ?? '') ||
    !/^[a-f0-9]{40}$/u.test(output.new_head ?? '') ||
    output.current_head === output.new_head ||
    !Number.isSafeInteger(output.generation) ||
    output.generation < 1 ||
    output.scope !== IMPLEMENTER_SCOPE ||
    !IMPLEMENTER_RESULTS.has(output.result) ||
    typeof output.verification !== 'string' ||
    output.verification.length === 0 ||
    !Array.isArray(output.addressed_blockers) ||
    !/^[a-f0-9]{64}$/u.test(output.blocker_ledger_sha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(output.preflight_sha256 ?? '') ||
    output.lane_id !== expected.lane_id ||
    output.issue_number !== expected.issue_number ||
    output.worktree !== expected.worktree ||
    output.parent_session_id !== expected.parent_session_id ||
    output.current_head !== expected.current_head ||
    output.new_head !== expected.new_head ||
    output.generation !== expected.generation ||
    output.scope !== IMPLEMENTER_SCOPE ||
    output.result !== expected.result ||
    output.verification !== expected.verification ||
    payloadDigest(output.addressed_blockers) !==
      payloadDigest(expected.addressed_blockers) ||
    output.blocker_ledger_sha256 !== expected.blocker_ledger_sha256 ||
    output.preflight_sha256 !== expected.preflight_sha256
  ) {
    throw new TypeError(
      'implementer task final_response is malformed or does not match the implementation result.',
    );
  }
  return output;
};

export const verifyImplementerRuntime = (expected) => {
  if (
    !Array.isArray(expected.blocker_ledger) ||
    !Array.isArray(expected.unresolved_blockers) ||
    !Array.isArray(expected.addressed_blockers) ||
    !/^[a-f0-9]{64}$/u.test(expected.blocker_ledger_sha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(expected.preflight_sha256 ?? '') ||
    payloadDigest(expected.blocker_ledger) !== expected.blocker_ledger_sha256 ||
    payloadDigest(
      expected.blocker_ledger.filter(
        (entry) => entry.remediation_status === 'unresolved',
      ),
    ) !== payloadDigest(expected.unresolved_blockers)
  ) {
    throw new TypeError('implementer blocker ledger contract is stale, omitted, or malformed.');
  }
  const {
    repository_root: repositoryRoot,
    task_id: taskId,
    parent_session_id: parentSessionId,
  } = expected;
  if (!TASK_ID.test(taskId)) {
    throw new TypeError('implementer task id is malformed.');
  }
  const canonicalRoot = resolve(repositoryRoot);
  assertDirectory(canonicalRoot);
  const runtimeRoot = resolve(canonicalRoot, '.omo', 'senpi-task');
  assertDirectory(runtimeRoot);
  const taskPath = join(runtimeRoot, 'tasks', `${taskId}.json`);
  assertRegularFile(taskPath);
  const taskRecord = parseJson(readFileSync(taskPath, 'utf8'), taskPath);
  if (taskRecord.task_id !== taskId) {
    throw new TypeError('implementer task record identity does not match.');
  }
  assertTaskRecord(taskRecord);
  const dagOwned = expected.dag_run_id !== undefined;
  if (
    dagOwned &&
    (taskRecord.owner?.kind !== 'dag' ||
      taskRecord.owner.runId !== expected.dag_run_id ||
      taskRecord.owner.nodeId !== expected.node_id ||
      taskRecord.owner.fingerprint !== expected.dag_owner_fingerprint)
  ) {
    throw new TypeError('implementer task DAG owner is invalid.');
  }
  const expectedDispatch = implementerPromptSentinel(expected);
  let dispatch;
  try {
    dispatch = parseTerminalDispatch(
      taskRecord.spawn_spec?.prompt,
      IMPLEMENTER_SENTINEL,
      {
        repository_root: canonicalRoot,
        lane_id: expected.lane_id,
        issue_number: expected.issue_number,
        preflight_sha256: expected.preflight_sha256,
      },
    );
  } catch (error) {
    throw new TypeError(`implementer task spawn provenance is invalid: ${error.message}`);
  }
  if (
    taskRecord.parent_session_id !== parentSessionId ||
    taskRecord.name !==
      (dagOwned
        ? expected.node_id
        : implementerTaskName(
            expected.issue_number,
            expected.generation,
            expected.current_head,
          )) ||
    taskRecord.spawn_spec?.cwd !== canonicalRoot ||
    terminalDispatchBlock(dispatch) !== expectedDispatch
  ) {
    throw new TypeError('implementer task spawn provenance does not match the issue contract.');
  }
  const output = requireFinalResponse(taskRecord, expected);
  const session = readSessionEvents(
    join(runtimeRoot, 'children', taskId, 'sessions', taskId),
  );
  const completionProjection = {
    task_id: taskRecord.task_id,
    status: taskRecord.status,
    parent_session_id: taskRecord.parent_session_id,
    name: taskRecord.name,
    agent_type: taskRecord.agent_type,
    spawn_spec: structuredClone(taskRecord.spawn_spec),
    resolved_model: structuredClone(taskRecord.resolved_model),
    tool_allow: [...taskRecord.tool_allow],
    final_response: taskRecord.final_response,
  };
  return {
    task_id: taskId,
    record_sha256: payloadDigest(completionProjection),
    output_sha256: payloadDigest(output),
    final_response: output,
    parent_session_id: parentSessionId,
    ...(dagOwned
      ? {
          dag_run_id: expected.dag_run_id,
          dag_key: expected.dag_key,
          dag_node_id: expected.node_id,
          dag_owner_fingerprint: expected.dag_owner_fingerprint,
        }
      : {}),
    lane_id: expected.lane_id,
    issue_number: expected.issue_number,
    worktree: expected.worktree,
    current_head: expected.current_head,
    new_head: expected.new_head,
    generation: expected.generation,
    scope: IMPLEMENTER_SCOPE,
    blocker_ledger_sha256: expected.blocker_ledger_sha256,
    preflight_sha256: expected.preflight_sha256,
    blocker_ledger: structuredClone(expected.blocker_ledger),
    unresolved_blockers: structuredClone(expected.unresolved_blockers),
    provider: IMPLEMENTER_PROVIDER,
    model_id: IMPLEMENTER_MODEL,
    thinking_level: IMPLEMENTER_THINKING,
    session_sha256: session.session_sha256,
    assistant_turns: assertActualRuntime(
      session.events,
      taskRecord.tool_allow,
      canonicalRoot,
      expected.worktree,
    ),
  };
};

export const conflictImplementerTaskName = (issueNumber, generation, resolvedHead) =>
  `fluo-conflict-implement-${String(issueNumber)}-g${String(generation)}-${resolvedHead.slice(0, 12)}`;

export const conflictImplementerPromptSentinel = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  parent_session_id: parentSessionId,
  old_base: oldBase,
  previously_reviewed_head: previousHead,
  upstream_head: upstreamHead,
  generation,
  preflight_sha256: preflightSha256,
  dag_key: dagKey,
  node_id: nodeId,
}) => terminalDispatchBlock({
  version: 1,
  sentinel: CONFLICT_IMPLEMENTER_SENTINEL,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  parent_session_id: parentSessionId,
  old_base: oldBase,
  previously_reviewed_head: previousHead,
  upstream_head: upstreamHead,
  generation,
  preflight_path: canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber),
  preflight_sha256: preflightSha256,
  scope: CONFLICT_IMPLEMENTER_SCOPE,
  ...(dagKey === undefined ? {} : { dag_key: dagKey }),
  ...(nodeId === undefined ? {} : { node_id: nodeId }),
});

export const verifyConflictImplementerRuntime = (expected) => {
  const canonicalRoot = resolve(expected.repository_root);
  assertDirectory(canonicalRoot);
  if (!TASK_ID.test(expected.task_id)) throw new TypeError('conflict implementer task id is malformed.');
  const runtimeRoot = resolve(canonicalRoot, '.omo', 'senpi-task');
  const taskPath = join(runtimeRoot, 'tasks', `${expected.task_id}.json`);
  assertRegularFile(taskPath);
  const taskRecord = parseJson(readFileSync(taskPath, 'utf8'), taskPath);
  assertTaskRecord(taskRecord);
  const dagOwned = taskRecord.owner?.kind === 'dag';
  const expectedNodeId =
    `conflict-implement-g${String(expected.generation)}` +
    `-h${expected.previously_reviewed_head}-u${expected.upstream_head}`;
  if (
    dagOwned &&
    (
      typeof expected.dag_run_id !== 'string' ||
      taskRecord.owner.runId !== expected.dag_run_id ||
      taskRecord.owner.nodeId !== expectedNodeId ||
      !/^[a-f0-9]{64}$/u.test(taskRecord.owner.fingerprint ?? '') ||
      taskRecord.name !== expectedNodeId
    )
  ) {
    throw new TypeError(
      'conflict implementer DAG owner does not match the resolution node.',
    );
  }
  const expectedDispatch = conflictImplementerPromptSentinel(expected);
  const dispatch = parseTerminalDispatch(
    taskRecord.spawn_spec?.prompt,
    CONFLICT_IMPLEMENTER_SENTINEL,
    {
      repository_root: canonicalRoot,
      lane_id: expected.lane_id,
      issue_number: expected.issue_number,
      preflight_sha256: expected.preflight_sha256,
    },
  );
  if (
    taskRecord.task_id !== expected.task_id ||
    taskRecord.parent_session_id !== expected.parent_session_id ||
    taskRecord.name !==
      (dagOwned
        ? expectedNodeId
        : conflictImplementerTaskName(
            expected.issue_number,
            expected.generation,
            expected.resolved_head,
          )) ||
    taskRecord.spawn_spec?.cwd !== canonicalRoot ||
    terminalDispatchBlock(dispatch) !== expectedDispatch
  ) throw new TypeError('conflict implementer spawn provenance does not match the resolution contract.');
  const output = parseSenpiFinalResponse(
    taskRecord.final_response,
    CONFLICT_IMPLEMENTER_FINAL_SENTINEL,
    'conflict implementer task final_response',
  );
  for (const key of [
    'lane_id', 'issue_number', 'worktree', 'parent_session_id', 'old_base',
    'previously_reviewed_head', 'upstream_head', 'resolved_head', 'generation',
    'preflight_sha256',
  ]) {
    if (output[key] !== expected[key]) {
      throw new TypeError('conflict implementer final_response does not match the exact resolution identity.');
    }
  }
  if (
    !/^[a-f0-9]{64}$/u.test(expected.preflight_sha256 ?? '') ||
    output.sentinel !== CONFLICT_IMPLEMENTER_FINAL_SENTINEL ||
    output.scope !== CONFLICT_IMPLEMENTER_SCOPE ||
    output.result !== 'conflict-resolved'
  ) throw new TypeError('conflict implementer final_response is malformed.');
  const session = readSessionEvents(join(runtimeRoot, 'children', expected.task_id, 'sessions', expected.task_id));
  const assistantTurns = assertActualRuntime(
    session.events,
    taskRecord.tool_allow,
    canonicalRoot,
    expected.worktree,
  );
  return {
    task_id: expected.task_id,
    record_sha256: payloadDigest({
      task_id: taskRecord.task_id,
      status: taskRecord.status,
      parent_session_id: taskRecord.parent_session_id,
      name: taskRecord.name,
      agent_type: taskRecord.agent_type,
      spawn_spec: structuredClone(taskRecord.spawn_spec),
      resolved_model: structuredClone(taskRecord.resolved_model),
      tool_allow: [...taskRecord.tool_allow],
      final_response: taskRecord.final_response,
    }),
    output_sha256: payloadDigest(output),
    final_response: output,
    ...(dagOwned
      ? {
          dag_run_id: expected.dag_run_id,
          dag_key: expected.dag_key,
          dag_node_id: taskRecord.owner.nodeId,
          dag_owner_fingerprint: taskRecord.owner.fingerprint,
        }
      : {}),
    preflight_sha256: expected.preflight_sha256,
    session_sha256: session.session_sha256,
    assistant_turns: assistantTurns,
  };
};

const cliUsage =
  'usage: implementer-runtime.mjs <runtime-root> <task-id>\n' +
  '       implementer-runtime.mjs --help';

const expectedFromTask = (runtimeRoot, taskId) => {
  const canonicalRuntimeRoot = resolve(runtimeRoot);
  const taskPath = join(canonicalRuntimeRoot, 'tasks', `${taskId}.json`);
  assertRegularFile(taskPath);
  const task = parseJson(readFileSync(taskPath, 'utf8'), taskPath);
  const prompt = task.spawn_spec?.prompt;
  const repositoryRoot = dirname(dirname(canonicalRuntimeRoot));
  const preliminary = parseTerminalDispatchShape(prompt, IMPLEMENTER_SENTINEL);
  const dispatch = parseTerminalDispatch(prompt, IMPLEMENTER_SENTINEL, {
    repository_root: repositoryRoot,
    lane_id: preliminary.lane_id,
    issue_number: preliminary.issue_number,
    preflight_sha256: preliminary.preflight_sha256,
  });
  const output = parseSenpiFinalResponse(
    task.final_response,
    IMPLEMENTER_FINAL_SENTINEL,
    'implementer task final_response',
  );
  if (resolve(repositoryRoot, '.omo', 'senpi-task') !== canonicalRuntimeRoot) {
    throw new TypeError('runtime root must be repository_root/.omo/senpi-task.');
  }
  return {
    repository_root: repositoryRoot,
    task_id: taskId,
    parent_session_id: dispatch.parent_session_id,
    lane_id: dispatch.lane_id,
    issue_number: dispatch.issue_number,
    worktree: dispatch.worktree,
    current_head: dispatch.current_head,
    new_head: output.new_head,
    generation: dispatch.generation,
    result: output.result,
    verification: output.verification,
    addressed_blockers: output.addressed_blockers,
    blocker_ledger: dispatch.blocker_ledger,
    unresolved_blockers: dispatch.unresolved_blockers,
    blocker_ledger_sha256: dispatch.blocker_ledger_sha256,
    preflight_sha256: dispatch.preflight_sha256,
  };
};

const isCli = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${cliUsage}\n`);
  } else if (args.length !== 2) {
    process.stderr.write(`${cliUsage}\n`);
    process.exitCode = 2;
  } else {
    try {
      const [runtimeRoot, taskId] = args;
      process.stdout.write(
        `${JSON.stringify(verifyImplementerRuntime(expectedFromTask(runtimeRoot, taskId)))}\n`,
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
