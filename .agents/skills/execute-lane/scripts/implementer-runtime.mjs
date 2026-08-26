import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
export const IMPLEMENTER_SCOPE = 'issue-worktree-read-write';
export const CONFLICT_IMPLEMENTER_SCOPE = 'conflict-resolution';
export const CONFLICT_IMPLEMENTER_SENTINEL = 'fluo:execute-lane:conflict-implementer:dispatch:v1';
export const CONFLICT_IMPLEMENTER_FINAL_SENTINEL = 'fluo:execute-lane:conflict-implementer:final:v1';
export const IMPLEMENTER_SENTINEL = 'fluo:execute-lane:implementer:dispatch:v1';
export const IMPLEMENTER_FINAL_SENTINEL = 'fluo:execute-lane:implementer:final:v1';

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
    blocker_ledger_sha256: blockerLedgerSha256,
    preflight_path: canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber),
    preflight_sha256: preflightSha256,
    blocker_ledger: blockerLedger,
    unresolved_blockers: unresolvedBlockers,
  });

export const implementerTaskPrompt = ({
  instructions,
  ...authority
}) =>
  terminalTaskPrompt({
    instructions,
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
    record.agent_type !== IMPLEMENTER_AGENT ||
    record.resolved_model?.source !== 'agent' ||
    record.resolved_model.provider !== IMPLEMENTER_PROVIDER ||
    record.resolved_model.model_id !== IMPLEMENTER_MODEL ||
    record.resolved_model.reasoning_effort !== IMPLEMENTER_THINKING
  ) {
    throw new TypeError(
      'implementer task metadata must resolve the configured Terra high agent.',
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

const assertActualRuntime = (events) => {
  const modelChanges = events.filter((event) => event.type === 'model_change');
  const thinkingChanges = events.filter((event) => event.type === 'thinking_level_change');
  const assistantMessages = events.filter(
    (event) => event.type === 'message' && event.message?.role === 'assistant',
  );
  if (
    modelChanges.length === 0 ||
    !modelChanges.every(
      (event) => event.provider === IMPLEMENTER_PROVIDER && event.modelId === IMPLEMENTER_MODEL,
    ) ||
    thinkingChanges.length === 0 ||
    !thinkingChanges.every((event) => event.thinkingLevel === IMPLEMENTER_THINKING) ||
    assistantMessages.length === 0 ||
    !assistantMessages.every(
      (event) =>
        event.message.provider === IMPLEMENTER_PROVIDER &&
        event.message.model === IMPLEMENTER_MODEL,
    )
  ) {
    throw new TypeError(
      'actual implementer session must use openai-codex/gpt-5.6-terra with high thinking.',
    );
  }
  return assistantMessages.length;
};

const requireFinalResponse = (record, expected) => {
  const output = parseSenpiFinalResponse(
    record.final_response,
    IMPLEMENTER_FINAL_SENTINEL,
    'implementer task final_response',
  );
  if (
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
      implementerTaskName(expected.issue_number, expected.generation, expected.current_head) ||
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
    final_response: taskRecord.final_response,
  };
  return {
    task_id: taskId,
    record_sha256: payloadDigest(completionProjection),
    output_sha256: payloadDigest(output),
    final_response: output,
    parent_session_id: parentSessionId,
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
    assistant_turns: assertActualRuntime(session.events),
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
  resolved_head: resolvedHead,
  generation,
  preflight_sha256: preflightSha256,
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
  resolved_head: resolvedHead,
  generation,
  preflight_path: canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber),
  preflight_sha256: preflightSha256,
  scope: CONFLICT_IMPLEMENTER_SCOPE,
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
    taskRecord.name !== conflictImplementerTaskName(expected.issue_number, expected.generation, expected.resolved_head) ||
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
  const assistantTurns = assertActualRuntime(session.events);
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
      final_response: taskRecord.final_response,
    }),
    output_sha256: payloadDigest(output),
    final_response: output,
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
