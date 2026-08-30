import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { verifyReviewerTask } from '../reviewer-runtime.mjs';
import { canonicalPreflightArtifactPath } from '../dispatch-authority.mjs';
import { fixturePreflight } from './implementer-task.mjs';

const event = (type, payload) => JSON.stringify({ type, payload });

export const writeActualShapedReviewerTask = ({
  task,
  repository_root: repositoryRoot,
  expected,
  tools,
  verification_command: verificationCommand = ['pnpm', 'verify'],
  verification_status: verificationStatus = 0,
  lifecycle_events: lifecycleEvents = [],
  verify: shouldVerify = true,
}) => {
  const preflightPath = canonicalPreflightArtifactPath(
    repositoryRoot,
    expected.lane_id,
    expected.issue_number,
  );
  if (!existsSync(preflightPath)) {
    const preflight = fixturePreflight(expected.lane_id, expected.issue_number);
    if (preflight.sha256 !== expected.preflight_sha256) {
      throw new TypeError('reviewer fixture requires its authoritative preflight artifact.');
    }
    mkdirSync(resolve(preflightPath, '..'), { recursive: true });
    writeFileSync(preflightPath, `${JSON.stringify(preflight, null, 2)}\n`, { flag: 'wx' });
  }
  const taskRoot = resolve(repositoryRoot, '.omo', 'senpi-task', 'tasks');
  const logRoot = resolve(repositoryRoot, '.omo', 'senpi-task', 'logs');
  const sessionRoot = resolve(
    repositoryRoot,
    '.omo',
    'senpi-task',
    'children',
    task.task_id,
    'sessions',
    task.task_id,
  );
  mkdirSync(taskRoot, { recursive: true });
  mkdirSync(logRoot, { recursive: true });
  mkdirSync(sessionRoot, { recursive: true });
  const taskRecord = {
    ...task,
    execution_mode: task.execution_mode ?? 'process',
    tool_allow: task.tool_allow ?? ['read', 'todo'],
    resolved_model: task.resolved_model ?? {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-sol',
      source: 'category',
      variant: 'medium',
    },
  };
  writeFileSync(resolve(taskRoot, `${task.task_id}.json`), JSON.stringify(taskRecord));
  const selectedTools = tools ?? (
    expected.axis === 'verification'
      ? [
          {
            tool: 'read',
            is_error: false,
            arguments: {
              path: resolve(
                repositoryRoot,
                '.omo',
                'lane-runs',
                expected.lane_id,
                'issues',
                String(expected.issue_number),
                'canonical-verification',
                `${expected.canonical_verification_receipt_id}.json`,
              ),
            },
          },
        ]
      : [
          {
            tool: 'read',
            is_error: false,
            arguments: {
              path: canonicalPreflightArtifactPath(
                repositoryRoot,
                expected.lane_id,
                expected.issue_number,
              ),
            },
          },
          {
            tool: 'read',
            is_error: false,
            arguments: {
              path: resolve(
                repositoryRoot,
                expected.worktree,
                'package.json',
              ),
            },
          },
        ]
  );
  const summaryLines = [
    event('transition_applied', { type: 'transition_applied', status: 'running', residency_state: 'resident' }),
    ...selectedTools.map(({ tool, is_error: isError }) => event('tool_execution', { tool, is_error: isError })),
    event('transition_applied', { type: 'transition_applied', status: 'completed', residency_state: 'persisted_only' }),
    ...lifecycleEvents.map(({ type, payload = {} }) => event(type, payload)),
  ];
  writeFileSync(resolve(logRoot, `${task.task_id}.jsonl`), `${summaryLines.join('\n')}\n`);

  const toolCalls = selectedTools.map((tool, index) => ({
    type: 'toolCall',
    id: `call_${String(index + 1)}`,
    name: tool.tool,
    arguments: tool.arguments ?? {},
  }));
  const rawLines = [
    JSON.stringify({
      type: 'message',
      id: 'assistant_1',
      timestamp: '2026-08-26T00:00:00.000Z',
      message: { role: 'assistant', content: toolCalls },
    }),
    ...selectedTools.map((tool, index) => JSON.stringify({
      type: 'message',
      id: `result_${String(index + 1)}`,
      timestamp: '2026-08-26T00:00:01.000Z',
      message: {
        role: 'toolResult',
        toolCallId: `call_${String(index + 1)}`,
        toolName: tool.tool,
        content: [],
        isError: tool.is_error,
      },
    })),
  ];
  writeFileSync(resolve(sessionRoot, '2026-08-26T00-00-00-000Z_session.jsonl'), `${rawLines.join('\n')}\n`);

  if (expected.axis === 'verification') {
    const receiptId = expected.canonical_verification_receipt_id;
    const receiptRoot = resolve(repositoryRoot, '.omo', 'lane-runs', expected.lane_id, 'issues', String(expected.issue_number), 'canonical-verification');
    mkdirSync(receiptRoot, { recursive: true });
    writeFileSync(
      resolve(receiptRoot, `${receiptId}.json`),
      `${JSON.stringify({
        version: 2,
        task_id: receiptId,
        repository_root: repositoryRoot,
        runtime_root: resolve(repositoryRoot, '.omo', 'lane-runs'),
        lane_id: expected.lane_id,
        issue_number: expected.issue_number,
        parent_session_id: expected.parent_session_id,
        worktree: resolve(repositoryRoot, expected.worktree),
        execution_worktree: resolve(repositoryRoot, '.worktrees', '.canonical-verify-fixture'),
        head_sha: expected.head_sha,
        tree_sha: 'b'.repeat(40),
        input_sha256: 'c'.repeat(64),
        pnpm_store_path: resolve(repositoryRoot, '.fixture-pnpm-store'),
        lockfile_sha256: 'd'.repeat(64),
        containment_backend: process.platform === 'linux' ? 'bwrap-pid-namespace' : 'sandbox-exec',
        preflight_sha256: expected.preflight_sha256,
        authority_snapshot_sha256: 'a'.repeat(64),
        post_run_git_state: {
          repository_root: repositoryRoot,
          worktree: resolve(repositoryRoot, expected.worktree),
          branch: expected.branch,
          head_sha: expected.head_sha,
        },
        command: verificationCommand,
        status: verificationStatus,
        result: verificationStatus === 0 ? 'pass' : 'fail',
      }, null, 2)}\n`,
    );
  }
  return shouldVerify
    ? verifyReviewerTask({ repository_root: repositoryRoot, ...expected })
    : null;
};
