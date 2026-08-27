import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { parseSenpiFinalResponse } from './senpi-final-response.mjs';
import {
  canonicalPreflightArtifactPath,
  parseTerminalDispatch,
  terminalDispatchBlock,
  terminalTaskPrompt,
} from './dispatch-authority.mjs';

export const REVIEW_SENTINEL = 'fluo:execute-lane:review:read-only:v1';
export const REVIEW_FINAL_SENTINEL = 'fluo:execute-lane:review:final:v1';
export const CONFLICT_REVIEW_SENTINEL = 'fluo:execute-lane:conflict-review:read-only:v1';
export const CONFLICT_REVIEW_FINAL_SENTINEL = 'fluo:execute-lane:conflict-review:final:v1';
const axes = new Set(['contract', 'code', 'verification']);
const taskId = /^st_[A-Za-z0-9_-]+$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const readOnlyTools = new Set([
  'find',
  'grep',
  'ls',
  'read',
  'lsp_diagnostics',
  'lsp_find_references',
  'lsp_goto_definition',
  'lsp_symbols',
  'session_list',
  'session_read',
  'session_search',
]);
const knownNonToolEvents = new Set([
  'assistant_message',
  'cancelled',
  'child_error',
  'evicted',
  'reconcile_reattached',
  'revived',
  'steered',
  'suspended',
  'transition_applied',
]);

const reviewerCapabilities = (axis) => {
  if (!axes.has(axis)) {
    throw new TypeError('reviewer task identity is invalid.');
  }
  return {
    source_read_only: true,
    local_ci_role: axis === 'verification' ? 'sole-writer' : 'read-only',
    artifact_writes: axis === 'verification',
  };
};

const record = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

export const reviewerTaskName = (axis, issueNumber, headSha) =>
  `fluo-review-${axis}-${String(issueNumber)}-${headSha.slice(0, 12)}`;

export const reviewerPromptSentinel = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  head_sha: headSha,
  preflight_sha256: preflightSha256,
  review_axis: axis,
  dag_key: dagKey,
  node_id: nodeId,
}) =>
  terminalDispatchBlock({
    version: 1,
    sentinel: REVIEW_SENTINEL,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    head_sha: headSha,
    preflight_path: canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber),
    preflight_sha256: preflightSha256,
    review_axis: axis,
    ...(dagKey === undefined ? {} : { dag_key: dagKey }),
    ...(nodeId === undefined ? {} : { node_id: nodeId }),
    ...reviewerCapabilities(axis),
  });

export const reviewerTaskPrompt = ({
  instructions,
  ...authority
}) =>
  terminalTaskPrompt({
    instructions,
    dispatch_block: reviewerPromptSentinel(authority),
  });

export const conflictReviewerTaskName = (issueNumber, resolvedHead) =>
  `fluo-review-conflict-${String(issueNumber)}-${resolvedHead.slice(0, 12)}`;

export const conflictReviewerPromptSentinel = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  preflight_sha256: preflightSha256,
  previously_reviewed_head: previousHead,
  upstream_head: upstreamHead,
  resolved_head: resolvedHead,
}) =>
  terminalDispatchBlock({
    version: 1,
    sentinel: CONFLICT_REVIEW_SENTINEL,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    preflight_path: canonicalPreflightArtifactPath(repositoryRoot, laneId, issueNumber),
    preflight_sha256: preflightSha256,
    previously_reviewed_head: previousHead,
    upstream_head: upstreamHead,
    resolved_head: resolvedHead,
    read_only: true,
  });

const canonicalFile = (path, name) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError(`${name} must be a real canonical file.`);
  }
  return readFileSync(path, 'utf8');
};

const canonicalDirectory = (path, name) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) {
    throw new TypeError(`${name} must be a real canonical directory.`);
  }
  return path;
};

const canonicalTask = (root, id) => {
  if (!taskId.test(id)) {
    throw new TypeError('reviewer task identity is invalid.');
  }
  const canonicalRoot = resolve(root);
  canonicalDirectory(canonicalRoot, 'reviewer repository root');
  const path = resolve(canonicalRoot, '.omo', 'senpi-task', 'tasks', `${id}.json`);
  return {
    canonicalRoot,
    value: record(JSON.parse(canonicalFile(path, 'reviewer task record')), 'reviewer task record'),
  };
};

const requireCompletedTask = (
  value,
  id,
  parentSessionId,
  name,
  canonicalRoot,
  expectedDispatch,
  expectedSentinel,
  authority,
) => {
  const spawn = record(value.spawn_spec, 'reviewer task spawn specification');
  const resolvedModel = record(value.resolved_model, 'reviewer task resolved model');
  const dispatch = parseTerminalDispatch(spawn.prompt, expectedSentinel, authority);
  if (
    value.task_id !== id ||
    value.status !== 'completed' ||
    value.agent_type === 'fluo-issue-implementer' ||
    (typeof value.category !== 'string' && typeof value.agent_type !== 'string') ||
    value.parent_session_id !== parentSessionId ||
    value.name !== name ||
    spawn.cwd !== canonicalRoot ||
    terminalDispatchBlock(dispatch) !== expectedDispatch ||
    typeof resolvedModel.provider !== 'string' ||
    typeof resolvedModel.model_id !== 'string'
  ) {
    throw new TypeError('reviewer task provenance does not match the supervisor review contract.');
  }
};

const completionProjection = (value) => ({
  task_id: value.task_id,
  status: value.status,
  parent_session_id: value.parent_session_id,
  name: value.name,
  agent_type: value.agent_type ?? null,
  category: value.category ?? null,
  spawn_spec: structuredClone(value.spawn_spec),
  resolved_model: structuredClone(value.resolved_model),
  final_response: value.final_response,
});

const summarySession = (canonicalRoot, id) => {
  const path = resolve(canonicalRoot, '.omo', 'senpi-task', 'logs', `${id}.jsonl`);
  let text;
  try {
    text = canonicalFile(path, 'reviewer session summary JSONL');
  } catch (error) {
    throw new TypeError(`reviewer session JSONL is missing or invalid: ${error.message}`);
  }
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new TypeError('reviewer session JSONL must contain canonical Senpi events.');
  }
  const tools = [];
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = record(JSON.parse(line), `reviewer session event ${String(index + 1)}`);
    } catch (error) {
      throw new TypeError(`reviewer session JSONL is malformed: ${error.message}`);
    }
    if (event.type === 'tool_execution') {
      const payload = record(event.payload, 'reviewer tool event payload');
      if (
        Object.keys(event).length !== 2 ||
        Object.keys(payload).sort().join(',') !== 'is_error,tool' ||
        typeof payload.tool !== 'string' ||
        typeof payload.is_error !== 'boolean'
      ) {
        throw new TypeError('reviewer tool event does not match the canonical Senpi event shape.');
      }
      tools.push({ tool: payload.tool, is_error: payload.is_error });
    } else if (!knownNonToolEvents.has(event.type)) {
      throw new TypeError(`reviewer session contains unknown event type ${String(event.type)}.`);
    }
  }
  return tools;
};

const rawSession = (canonicalRoot, id) => {
  const sessionRoot = canonicalDirectory(
    resolve(canonicalRoot, '.omo', 'senpi-task', 'children', id, 'sessions', id),
    'reviewer child session',
  );
  const files = readdirSync(sessionRoot).filter((name) => name.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    throw new TypeError('reviewer child session must contain canonical Senpi JSONL.');
  }
  const calls = [];
  const results = new Map();
  const sources = [];
  for (const file of files) {
    const path = join(sessionRoot, file);
    const text = canonicalFile(path, 'reviewer child session JSONL');
    sources.push({ file, sha256: createHash('sha256').update(text).digest('hex') });
    for (const [index, line] of text.split('\n').filter(Boolean).entries()) {
      let event;
      try {
        event = record(JSON.parse(line), `reviewer child session event ${String(index + 1)}`);
      } catch (error) {
        throw new TypeError(`reviewer child session JSONL is malformed: ${error.message}`);
      }
      if (event.type !== 'message') continue;
      const message = record(event.message, 'reviewer child session message');
      if (message.role === 'assistant') {
        if (!Array.isArray(message.content)) {
          throw new TypeError('reviewer assistant message content is malformed.');
        }
        for (const part of message.content) {
          if (part?.type !== 'toolCall') continue;
          if (typeof part.id !== 'string' || typeof part.name !== 'string') {
            throw new TypeError('reviewer tool call is malformed.');
          }
          calls.push({ id: part.id, tool: part.name, arguments: record(part.arguments, 'reviewer tool call arguments') });
        }
      } else if (message.role === 'toolResult') {
        if (typeof message.toolCallId !== 'string' || typeof message.isError !== 'boolean') {
          throw new TypeError('reviewer tool result is malformed.');
        }
        results.set(message.toolCallId, message.isError);
      }
    }
  }
  const tools = calls.map((call) => {
    if (!results.has(call.id)) {
      throw new TypeError('reviewer tool call is missing its canonical Senpi result.');
    }
    return { tool: call.tool, is_error: results.get(call.id), arguments: structuredClone(call.arguments) };
  });
  return { tools, sources };
};

const reviewerSession = (canonicalRoot, id, axis) => {
  const summaryTools = summarySession(canonicalRoot, id);
  const raw = rawSession(canonicalRoot, id);
  if (
    summaryTools.length !== raw.tools.length ||
    summaryTools.some((tool, index) =>
      tool.tool !== raw.tools[index].tool || tool.is_error !== raw.tools[index].is_error)
  ) {
    throw new TypeError('reviewer session summary does not match authoritative Senpi tool calls.');
  }
  if (raw.tools.length === 0) {
    throw new TypeError('reviewer session must contain inspected tool events.');
  }
  if (axis === 'verification') {
    if (
      raw.tools.filter(({ tool }) => tool === 'bash').length !== 1 ||
      raw.tools.some(({ tool }) => tool !== 'bash' && !readOnlyTools.has(tool))
    ) {
      throw new TypeError('verification reviewer may use read-only tools and exactly one canonical wrapper shell event.');
    }
  } else if (raw.tools.some(({ tool }) => !readOnlyTools.has(tool))) {
    throw new TypeError(`${axis} reviewer used a forbidden or unknown tool.`);
  }
  const stableEvidence = { sources: raw.sources, tool_events: raw.tools };
  return {
    session_sha256: payloadDigest(stableEvidence),
    tool_events_sha256: payloadDigest(raw.tools),
    tool_events: raw.tools,
  };
};

const canonicalShellCommand = (canonicalRoot, id, expected) => [
  'node',
  resolve(canonicalRoot, '.agents/skills/execute-lane/scripts/canonical-verification.mjs'),
  '--root', canonicalRoot,
  '--runtime-root', resolve(canonicalRoot, '.omo', 'lane-runs'),
  '--lane', expected.lane_id,
  '--issue', String(expected.issue_number),
  '--cwd', resolve(canonicalRoot, expected.worktree),
  '--head', expected.head_sha,
  '--preflight', expected.preflight_sha256,
  '--task', id,
  '--', 'pnpm', 'verify',
].join(' ');

const canonicalVerification = (canonicalRoot, id, expected, session) => {
  const shell = session.tool_events.find(({ tool }) => tool === 'bash');
  if (
    shell?.is_error !== false ||
    Object.keys(shell.arguments).some((key) => !['command', 'timeout'].includes(key)) ||
    shell.arguments.command !== canonicalShellCommand(canonicalRoot, id, expected)
  ) {
    throw new TypeError('verification reviewer shell invocation is not the exact canonical wrapper command.');
  }
  const path = resolve(
    canonicalRoot,
    '.omo',
    'lane-runs',
    expected.lane_id,
    'issues',
    String(expected.issue_number),
    'canonical-verification',
    `${id}.json`,
  );
  let value;
  try {
    value = record(JSON.parse(canonicalFile(path, 'canonical verification receipt')), 'canonical verification receipt');
  } catch (error) {
    throw new TypeError(`verification reviewer canonical wrapper evidence is missing or invalid: ${error.message}`);
  }
  const worktreePath = resolve(canonicalRoot, expected.worktree);
  if (
    value.version !== 2 ||
    value.task_id !== id ||
    value.repository_root !== canonicalRoot ||
    value.runtime_root !== resolve(canonicalRoot, '.omo', 'lane-runs') ||
    value.lane_id !== expected.lane_id ||
    value.issue_number !== expected.issue_number ||
    value.worktree !== worktreePath ||
    typeof value.execution_worktree !== 'string' ||
    !value.execution_worktree.startsWith(resolve(canonicalRoot, '.worktrees', '.canonical-verify-')) ||
    !/^[a-f0-9]{40}$/u.test(value.tree_sha ?? '') ||
    !sha256.test(value.input_sha256 ?? '') ||
    typeof value.pnpm_store_path !== 'string' ||
    value.pnpm_store_path !== resolve(value.pnpm_store_path) ||
    !sha256.test(value.lockfile_sha256 ?? '') ||
    !['sandbox-exec', 'bwrap-pid-namespace'].includes(value.containment_backend) ||
    value.head_sha !== expected.head_sha ||
    value.preflight_sha256 !== expected.preflight_sha256 ||
    !sha256.test(value.authority_snapshot_sha256 ?? '') ||
    value.post_run_git_state?.repository_root !== canonicalRoot ||
    value.post_run_git_state?.worktree !== worktreePath ||
    value.post_run_git_state?.branch !== expected.branch ||
    value.post_run_git_state?.head_sha !== expected.head_sha ||
    JSON.stringify(value.command) !== JSON.stringify(['pnpm', 'verify']) ||
    value.status !== 0 ||
    value.result !== 'pass'
  ) {
    throw new TypeError('verification reviewer canonical wrapper receipt is malformed or stale.');
  }
  return {
    receipt_sha256: payloadDigest(value),
    authority_snapshot_sha256: value.authority_snapshot_sha256,
    command: [...value.command],
    shell_command: shell.arguments.command,
    status: value.status,
    result: value.result,
    session_sha256: session.session_sha256,
  };
};

const finalResponse = (value, axis, headSha, preflightSha256) => {
  const output = parseSenpiFinalResponse(value.final_response, REVIEW_FINAL_SENTINEL, 'reviewer task final_response');
  if (
    output.sentinel !== REVIEW_FINAL_SENTINEL ||
    output.axis !== axis ||
    output.head_sha !== headSha ||
    output.preflight_sha256 !== preflightSha256 ||
    !['PASS', 'BLOCK', 'NEEDS-HUMAN-CHECK'].includes(output.verdict_signal) ||
    typeof output.coverage !== 'object' || output.coverage === null || Array.isArray(output.coverage) ||
    !Array.isArray(output.blockers) ||
    typeof output.blocker_sources !== 'object' || output.blocker_sources === null || Array.isArray(output.blocker_sources)
  ) {
    throw new TypeError('reviewer task final_response is malformed.');
  }
  return output;
};

export const verifyReviewerTask = (expected) => {
  const {
    repository_root: root,
    task_id: id,
    parent_session_id: parentSessionId,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    branch,
    head_sha: headSha,
    preflight_sha256: preflightSha256,
    axis,
  } = expected;
  if (!axes.has(axis)) throw new TypeError('reviewer task identity is invalid.');
  const { canonicalRoot, value } = canonicalTask(root, id);
  const dagOwned = expected.dag_run_id !== undefined;
  if (
    dagOwned &&
    (value.owner?.kind !== 'dag' ||
      value.owner.runId !== expected.dag_run_id ||
      value.owner.nodeId !== expected.node_id ||
      value.owner.fingerprint !== expected.dag_owner_fingerprint)
  ) {
    throw new TypeError('reviewer task DAG owner is invalid.');
  }
  requireCompletedTask(
    value, id, parentSessionId, dagOwned ? expected.node_id : reviewerTaskName(axis, issueNumber, headSha), canonicalRoot,
    reviewerPromptSentinel({
      repository_root: canonicalRoot,
      lane_id: laneId,
      issue_number: issueNumber,
      worktree,
      head_sha: headSha,
      preflight_sha256: preflightSha256,
      review_axis: axis,
      ...(dagOwned
        ? { dag_key: expected.dag_key, node_id: expected.node_id }
        : {}),
    }),
    REVIEW_SENTINEL,
    { repository_root: canonicalRoot, lane_id: laneId, issue_number: issueNumber, preflight_sha256: preflightSha256 },
  );
  if (!sha256.test(preflightSha256 ?? '')) throw new TypeError('reviewer preflight digest is omitted or malformed.');
  const output = finalResponse(value, axis, headSha, preflightSha256);
  const session = reviewerSession(canonicalRoot, id, axis);
  const verification = axis === 'verification'
    ? canonicalVerification(canonicalRoot, id, { lane_id: laneId, issue_number: issueNumber, worktree, branch, head_sha: headSha, preflight_sha256: preflightSha256 }, session)
    : null;
  return {
    task_id: id,
    record_sha256: payloadDigest(completionProjection(value)),
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
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    head_sha: headSha,
    preflight_sha256: preflightSha256,
    axis,
    mutation_sentinel: REVIEW_SENTINEL,
    session_sha256: session.session_sha256,
    tool_events_sha256: session.tool_events_sha256,
    tool_events: session.tool_events,
    canonical_verification: verification,
  };
};

const conflictFinalResponse = (value, expected) => {
  const output = parseSenpiFinalResponse(value.final_response, CONFLICT_REVIEW_FINAL_SENTINEL, 'conflict reviewer task final_response');
  const digests = record(output.digests, 'conflict reviewer task digests');
  const digestKeys = ['old_content_sha256', 'upstream_content_sha256', 'resolved_content_sha256', 'old_upstream_diff_sha256', 'old_resolved_diff_sha256', 'upstream_resolved_diff_sha256'];
  if (
    output.sentinel !== CONFLICT_REVIEW_FINAL_SENTINEL || output.verdict_signal !== 'PASS' ||
    output.previously_reviewed_head !== expected.previously_reviewed_head || output.upstream_head !== expected.upstream_head ||
    output.resolved_head !== expected.resolved_head || output.preflight_sha256 !== expected.preflight_sha256 ||
    JSON.stringify(output.conflicting_files) !== JSON.stringify(expected.conflicting_files) ||
    JSON.stringify(output.conflicting_hunks) !== JSON.stringify(expected.conflicting_hunks) ||
    output.semantic_impact !== expected.semantic_impact || output.upstream_relevant !== expected.upstream_relevant ||
    JSON.stringify(output.affected_axes) !== JSON.stringify(expected.affected_axes) || output.rationale !== expected.rationale ||
    digestKeys.some((key) => !sha256.test(digests[key] ?? '')) || Object.keys(digests).length !== digestKeys.length
  ) throw new TypeError('conflict reviewer task final_response is malformed or does not match the gate.');
  return output;
};

export const verifyConflictGateTask = ({ repository_root: root, task_id: id, parent_session_id: parentSessionId, lane_id: laneId, issue_number: issueNumber, worktree, gate }) => {
  const { canonicalRoot, value } = canonicalTask(root, id);
  requireCompletedTask(
    value, id, parentSessionId, conflictReviewerTaskName(issueNumber, gate.resolved_head), canonicalRoot,
    conflictReviewerPromptSentinel({ repository_root: canonicalRoot, lane_id: laneId, issue_number: issueNumber, worktree, preflight_sha256: gate.preflight_sha256, previously_reviewed_head: gate.previously_reviewed_head, upstream_head: gate.upstream_head, resolved_head: gate.resolved_head }),
    CONFLICT_REVIEW_SENTINEL,
    { repository_root: canonicalRoot, lane_id: laneId, issue_number: issueNumber, preflight_sha256: gate.preflight_sha256 },
  );
  const output = conflictFinalResponse(value, gate);
  const session = reviewerSession(canonicalRoot, id, 'conflict');
  return {
    task_id: id,
    record_sha256: payloadDigest(completionProjection(value)),
    output_sha256: payloadDigest(output),
    final_response: output,
    parent_session_id: parentSessionId,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    preflight_sha256: gate.preflight_sha256,
    previously_reviewed_head: gate.previously_reviewed_head,
    upstream_head: gate.upstream_head,
    resolved_head: gate.resolved_head,
    mutation_sentinel: CONFLICT_REVIEW_SENTINEL,
    session_sha256: session.session_sha256,
    tool_events_sha256: session.tool_events_sha256,
    tool_events: session.tool_events,
  };
};
