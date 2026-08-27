import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { payloadDigest } from '../../../../workflow-contracts/contracts.mjs';
import { formatSenpiFinalResponse } from '../senpi-final-response.mjs';
import {
  CONFLICT_IMPLEMENTER_FINAL_SENTINEL,
  CONFLICT_IMPLEMENTER_SCOPE,
  IMPLEMENTER_FINAL_SENTINEL,
  IMPLEMENTER_SCOPE,
  conflictImplementerPromptSentinel,
  conflictImplementerTaskName,
  implementerPromptSentinel,
  implementerTaskName,
} from '../implementer-runtime.mjs';
import { canonicalPreflightArtifactPath } from '../dispatch-authority.mjs';

export const fixturePreflight = (laneId, issueNumber) => {
  const canonical = { version: 1, lane_id: laneId, issue_number: issueNumber };
  return { ...canonical, sha256: payloadDigest(canonical) };
};

const ensurePreflight = (root, laneId, issueNumber, expectedDigest, authoritativePreflight) => {
  const path = canonicalPreflightArtifactPath(root, laneId, issueNumber);
  if (existsSync(path)) return;
  const preflight = authoritativePreflight ?? fixturePreflight(laneId, issueNumber);
  if (preflight.sha256 !== expectedDigest) {
    throw new TypeError('fixture preflight digest must be backed by an authoritative artifact.');
  }
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(preflight, null, 2)}\n`, { flag: 'wx' });
};

const writeTerraSession = (root, taskId, finalResponse) => {
  const runtimeRoot = resolve(root, '.omo', 'senpi-task');
  const sessionRoot = resolve(runtimeRoot, 'children', taskId, 'sessions', taskId);
  mkdirSync(sessionRoot, { recursive: true });
  const events = [
    { type: 'model_change', provider: 'openai-codex', modelId: 'gpt-5.6-terra' },
    { type: 'thinking_level_change', thinkingLevel: 'high' },
    { type: 'message', message: { role: 'assistant', provider: 'openai-codex', model: 'gpt-5.6-terra', content: [{ type: 'text', text: JSON.stringify(finalResponse) }] } },
  ];
  writeFileSync(resolve(sessionRoot, '2026-08-26T00-00-00-000Z_session.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
};

export const writeActualShapedImplementerTask = ({
  repository_root: root,
  task_id: taskId,
  parent_session_id: parentSessionId,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  current_head: currentHead,
  new_head: newHead,
  generation,
  result,
  verification,
  addressed_blockers: addressedBlockers = [],
  blocker_ledger: blockerLedger = [],
  unresolved_blockers: unresolvedBlockers = [],
  blocker_ledger_sha256: blockerLedgerSha256,
  preflight_sha256: preflightSha256,
  authoritative_preflight: authoritativePreflight,
  dag_run_id: dagRunId,
  dag_key: dagKey,
  node_id: nodeId,
  dag_owner_fingerprint: dagOwnerFingerprint,
  mutate = (task) => task,
}) => {
  ensurePreflight(root, laneId, issueNumber, preflightSha256, authoritativePreflight);
  const expected = {
    repository_root: root,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    current_head: currentHead,
    parent_session_id: parentSessionId,
    generation,
    blocker_ledger: blockerLedger,
    unresolved_blockers: unresolvedBlockers,
    blocker_ledger_sha256:
      blockerLedgerSha256 ?? payloadDigest(blockerLedger),
    preflight_sha256: preflightSha256,
    ...(dagRunId === undefined
      ? {}
      : {
          dag_run_id: dagRunId,
          dag_key: dagKey,
          node_id: nodeId,
          dag_owner_fingerprint: dagOwnerFingerprint,
        }),
  };
  const finalResponse = {
    sentinel: IMPLEMENTER_FINAL_SENTINEL,
    lane_id: laneId,
    issue_number: issueNumber,
    worktree,
    parent_session_id: parentSessionId,
    current_head: currentHead,
    new_head: newHead,
    generation,
    scope: IMPLEMENTER_SCOPE,
    result,
    verification,
    addressed_blockers: addressedBlockers,
    blocker_ledger_sha256: expected.blocker_ledger_sha256,
    preflight_sha256: expected.preflight_sha256,
  };
  const task = mutate({
    task_id: taskId,
    status: 'completed',
    residency_state: 'resident',
    parent_session_id: parentSessionId,
    root_session_id: parentSessionId,
    depth: 1,
    execution_mode: 'in-process',
    model: 'openai-codex/gpt-5.6-terra',
    name:
      nodeId ??
      implementerTaskName(issueNumber, generation, currentHead),
    task_summary: `Issue #${String(issueNumber)} generation ${String(generation)} implementation`,
    agent_type: 'fluo-issue-implementer',
    requested_model: {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-terra',
      display: 'openai-codex/gpt-5.6-terra',
      source: 'agent',
      reasoning_effort: 'high',
    },
    resolved_model: {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-terra',
      display: 'openai-codex/gpt-5.6-terra',
      source: 'agent',
      reasoning_effort: 'high',
      reasoning: 'high',
    },
    spawn_spec: {
      version: 1,
      cwd: root,
      prompt: `Execute the issue contract and return the machine final response.\n${implementerPromptSentinel(expected)}`,
    },
    final_response: formatSenpiFinalResponse(
      IMPLEMENTER_FINAL_SENTINEL,
      finalResponse,
    ),
    ...(dagRunId === undefined
      ? {}
      : {
          owner: {
            kind: 'dag',
            runId: dagRunId,
            nodeId,
            fingerprint: dagOwnerFingerprint,
          },
        }),
  });
  const runtimeRoot = resolve(root, '.omo', 'senpi-task');
  const taskRoot = resolve(runtimeRoot, 'tasks');
  mkdirSync(taskRoot, { recursive: true });
  writeFileSync(resolve(taskRoot, `${taskId}.json`), JSON.stringify(task));
  writeTerraSession(root, taskId, finalResponse);
  return { task, finalResponse, runtimeRoot };
};

export const writeActualShapedConflictImplementerTask = ({
  repository_root: root,
  task_id: taskId,
  parent_session_id: parentSessionId,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  old_base: oldBase,
  previously_reviewed_head: previousHead,
  upstream_head: upstreamHead,
  resolved_head: resolvedHead,
  generation,
  preflight_sha256: preflightSha256,
  authoritative_preflight: authoritativePreflight,
  mutate = (task) => task,
}) => {
  ensurePreflight(root, laneId, issueNumber, preflightSha256, authoritativePreflight);
  const expected = {
    repository_root: root,
    lane_id: laneId, issue_number: issueNumber, worktree,
    parent_session_id: parentSessionId, old_base: oldBase,
    previously_reviewed_head: previousHead, upstream_head: upstreamHead,
    resolved_head: resolvedHead, generation, preflight_sha256: preflightSha256,
  };
  const finalResponse = {
    sentinel: CONFLICT_IMPLEMENTER_FINAL_SENTINEL,
    ...expected,
    scope: CONFLICT_IMPLEMENTER_SCOPE,
    result: 'conflict-resolved',
  };
  const task = mutate({
    task_id: taskId,
    status: 'completed',
    parent_session_id: parentSessionId,
    name: conflictImplementerTaskName(issueNumber, generation, resolvedHead),
    agent_type: 'fluo-issue-implementer',
    resolved_model: {
      source: 'agent', provider: 'openai-codex', model_id: 'gpt-5.6-terra',
      reasoning_effort: 'high', reasoning: 'high',
    },
    spawn_spec: {
      version: 1,
      cwd: root,
      prompt: `Resolve only this exact conflict and return the machine final response.\n${conflictImplementerPromptSentinel(expected)}`,
    },
    final_response: formatSenpiFinalResponse(CONFLICT_IMPLEMENTER_FINAL_SENTINEL, finalResponse),
  });
  const taskRoot = resolve(root, '.omo', 'senpi-task', 'tasks');
  mkdirSync(taskRoot, { recursive: true });
  writeFileSync(resolve(taskRoot, `${taskId}.json`), JSON.stringify(task));
  writeTerraSession(root, taskId, finalResponse);
  return { task, finalResponse };
};
