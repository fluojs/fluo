import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { formatSenpiFinalResponse } from './senpi-final-response.mjs';
import { writeActualShapedReviewerTask } from './fixtures/reviewer-task.mjs';
import { fixturePreflight } from './fixtures/implementer-task.mjs';
import {
  reviewerPromptSentinel,
  reviewerTaskName,
  verifyReviewerTask,
} from './reviewer-runtime.mjs';

const head = 'a'.repeat(40);
const parentSessionId = 'ses_parent';
const preflightSha256 = fixturePreflight('lane-a', 3305).sha256;
const worktree = '.worktrees/issue-3305-content-negotiation';
const identity = (axis) => ({
  task_id: `st_${axis}`,
  parent_session_id: parentSessionId,
  lane_id: 'lane-a',
  issue_number: 3305,
  worktree,
  branch: 'issue-3305-content-negotiation',
  head_sha: head,
  preflight_sha256: preflightSha256,
  axis,
});
const task = (root, axis) => {
  const output = {
    sentinel: 'fluo:execute-lane:review:final:v1',
    axis,
    head_sha: head,
    preflight_sha256: preflightSha256,
    verdict_signal: 'PASS',
    coverage: { 'accept-header-presence': 'PASS' },
    blockers: [],
    blocker_sources: {},
  };
  return {
    task_id: `st_${axis}`,
    status: 'completed',
    parent_session_id: parentSessionId,
    category: 'deep',
    resolved_model: {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-sol',
      source: 'category',
      variant: 'medium',
    },
    name: reviewerTaskName(axis, 3305, head),
    final_response: formatSenpiFinalResponse(
      'fluo:execute-lane:review:final:v1',
      output,
    ),
    spawn_spec: {
      cwd: root,
      prompt: `Review under the dispatched tool policy.\n${reviewerPromptSentinel({
        repository_root: root,
        lane_id: 'lane-a',
        issue_number: 3305,
        worktree,
        head_sha: head,
        preflight_sha256: preflightSha256,
        review_axis: axis,
      })}`,
    },
  };
};
const fixture = (axis, tools, shouldVerify = true, verificationCommand) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-reviewer-runtime-')));
  const expected = identity(axis);
  const receipt = writeActualShapedReviewerTask({
    task: task(root, axis),
    repository_root: root,
    expected,
    tools,
    verify: shouldVerify,
    verification_command: verificationCommand,
  });
  return { root, expected, receipt };
};

test('only verification receives artifact-producing local-CI authority', () => {
  const sentinelFor = (axis) => {
    const prompt = reviewerPromptSentinel({
      repository_root: process.cwd(), lane_id: 'lane-a', issue_number: 3305, worktree, head_sha: head, preflight_sha256: preflightSha256, review_axis: axis,
    });
    return JSON.parse(prompt.split('\n')[1]);
  };
  for (const axis of ['contract', 'code']) {
    assert.deepEqual(
      { source_read_only: sentinelFor(axis).source_read_only, local_ci_role: sentinelFor(axis).local_ci_role, artifact_writes: sentinelFor(axis).artifact_writes },
      { source_read_only: true, local_ci_role: 'read-only', artifact_writes: false },
    );
  }
  assert.deepEqual(
    { source_read_only: sentinelFor('verification').source_read_only, local_ci_role: sentinelFor('verification').local_ci_role, artifact_writes: sentinelFor('verification').artifact_writes },
    { source_read_only: true, local_ci_role: 'sole-writer', artifact_writes: true },
  );
});

test('contract and code accept actual-shaped read/search/LSP/history events', () => {
  for (const axis of ['contract', 'code']) {
    const value = fixture(axis, [
      { tool: 'read', is_error: false },
      { tool: 'grep', is_error: false },
      { tool: 'lsp_find_references', is_error: false },
      { tool: 'session_read', is_error: false },
    ]);
    try {
      assert.equal(value.receipt.task_id, `st_${axis}`);
      assert.equal(value.receipt.tool_events.length, 4);
      assert.match(value.receipt.session_sha256, /^[a-f0-9]{64}$/u);
    } finally {
      rmSync(value.root, { force: true, recursive: true });
    }
  }
});

test('reviewers accept real terminal residency lifecycle events but reject unknown event types', () => {
  const value = fixture('contract', undefined, false);
  try {
    writeActualShapedReviewerTask({
      task: task(value.root, 'contract'),
      repository_root: value.root,
      expected: value.expected,
      lifecycle_events: [
        { type: 'evicted', payload: { cause: 'evict' } },
        { type: 'revived', payload: { cause: 'task_output' } },
        { type: 'steered', payload: { source: 'parent' } },
        { type: 'reconcile_reattached', payload: { status: 'completed' } },
        { type: 'cancelled', payload: { cause: 'parent' } },
      ],
      verify: false,
    });
    assert.doesNotThrow(() => verifyReviewerTask({ repository_root: value.root, ...value.expected }));
    const log = resolve(value.root, '.omo/senpi-task/logs/st_contract.jsonl');
    writeFileSync(log, `${readFileSync(log, 'utf8')}${JSON.stringify({ type: 'future_lifecycle', payload: {} })}\n`);
    assert.throws(
      () => verifyReviewerTask({ repository_root: value.root, ...value.expected }),
      /unknown event type/u,
    );
  } finally {
    rmSync(value.root, { force: true, recursive: true });
  }
});

test('contract and code reject shell, mutation, execution, spawning, GitHub mutation, and unknown tools', () => {
  for (const axis of ['contract', 'code']) {
    for (const tool of ['bash', 'edit', 'write', 'apply_patch', 'eval', 'task', 'gh', 'mystery_tool']) {
      const value = fixture(axis, [{ tool, is_error: false }], false);
      try {
        assert.throws(() => verifyReviewerTask({ repository_root: value.root, ...value.expected }), /forbidden|unknown/u, `${axis}:${tool}`);
      } finally {
        rmSync(value.root, { force: true, recursive: true });
      }
    }
  }
});

test('verification rejects direct build shell evidence without a canonical wrapper receipt', () => {
  const value = fixture('verification');
  try {
    rmSync(resolve(value.root, '.omo/lane-runs/lane-a/issues/3305/canonical-verification/st_verification.json'));
    assert.throws(
      () => verifyReviewerTask({ repository_root: value.root, ...value.expected }),
      /canonical wrapper evidence/u,
    );
  } finally {
    rmSync(value.root, { force: true, recursive: true });
  }
});

test('verification rejects a wrapper invocation for a non-canonical direct test command', () => {
  const value = fixture(
    'verification',
    [{ tool: 'bash', is_error: false }],
    false,
    ['pnpm', 'test'],
  );
  try {
    assert.throws(
      () => verifyReviewerTask({ repository_root: value.root, ...value.expected }),
      /exact canonical wrapper command|wrapper receipt.*malformed|stale/u,
    );
  } finally {
    rmSync(value.root, { force: true, recursive: true });
  }
});

test('verification rejects chained, prefixed, suffixed, direct-CI, and manufactured wrapper shell commands', () => {
  const canonical = fixture('verification');
  const expectedCommand = canonical.receipt.canonical_verification.shell_command;
  rmSync(canonical.root, { force: true, recursive: true });
  for (const command of [
    `cd /tmp && ${expectedCommand}`,
    `${expectedCommand} && git status --short`,
    `env CI=1 ${expectedCommand}`,
    'pnpm verify',
    `printf receipt && ${expectedCommand}`,
  ]) {
    const value = fixture(
      'verification',
      undefined,
      false,
      undefined,
    );
    try {
      writeActualShapedReviewerTask({
        task: task(value.root, 'verification'),
        repository_root: value.root,
        expected: value.expected,
        verification_shell_command: command.replaceAll(canonical.root, value.root),
        verify: false,
      });
      assert.throws(
        () => verifyReviewerTask({ repository_root: value.root, ...value.expected }),
        /exact canonical wrapper command/u,
      );
    } finally {
      rmSync(value.root, { force: true, recursive: true });
    }
  }
});

test('verification accepts one wrapper shell event and binds command, result, and session digest', () => {
  const value = fixture('verification');
  try {
    assert.deepEqual(value.receipt.canonical_verification, {
      receipt_sha256: value.receipt.canonical_verification.receipt_sha256,
      authority_snapshot_sha256: 'a'.repeat(64),
      command: ['pnpm', 'verify'],
      shell_command: value.receipt.canonical_verification.shell_command,
      status: 0,
      result: 'pass',
      session_sha256: value.receipt.session_sha256,
    });
    assert.equal(value.receipt.tool_events.filter(({ tool }) => tool === 'bash').length, 1);
  } finally {
    rmSync(value.root, { force: true, recursive: true });
  }
});

test('verification rejects direct or unrelated mutation events even when the wrapper receipt exists', () => {
  for (const tools of [
    [{ tool: 'bash', is_error: false }, { tool: 'bash', is_error: false }],
    [{ tool: 'read', is_error: false }, { tool: 'write', is_error: false }, { tool: 'bash', is_error: false }],
    [{ tool: 'unknown', is_error: false }, { tool: 'bash', is_error: false }],
  ]) {
    const value = fixture('verification', tools, false);
    try {
      assert.throws(() => verifyReviewerTask({ repository_root: value.root, ...value.expected }), /read-only tools|wrapper shell/u);
    } finally {
      rmSync(value.root, { force: true, recursive: true });
    }
  }
});

test('missing, malformed, and tampered sessions fail closed or change the persisted receipt digest', () => {
  const value = fixture('contract');
  const log = resolve(value.root, '.omo/senpi-task/logs/st_contract.jsonl');
  try {
    const persistedDigest = payloadDigest(value.receipt);
    rmSync(log);
    assert.throws(() => verifyReviewerTask({ repository_root: value.root, ...value.expected }), /session JSONL/u);
    writeFileSync(log, '{bad}\n');
    assert.throws(() => verifyReviewerTask({ repository_root: value.root, ...value.expected }), /malformed/u);
    writeFileSync(log, `${JSON.stringify({ type: 'tool_execution', payload: { tool: 'read', is_error: false } })}\n`);
    const revalidated = verifyReviewerTask({ repository_root: value.root, ...value.expected });
    assert.equal(payloadDigest(revalidated), persistedDigest);
    assert.equal(revalidated.session_sha256, value.receipt.session_sha256);
  } finally {
    rmSync(value.root, { force: true, recursive: true });
  }
});

test('reviewer task provenance and final machine output remain strict', () => {
  const value = fixture('contract');
  const path = resolve(value.root, '.omo/senpi-task/tasks/st_contract.json');
  try {
    const original = JSON.parse(readFileSync(path, 'utf8'));
    const receiptDigest = payloadDigest(value.receipt);
    writeFileSync(path, JSON.stringify({
      ...original,
      residency_state: 'evicted',
      updated_at: '2026-08-26T00:30:00.000Z',
      task_summary: 'normal post-completion metadata',
    }));
    assert.equal(
      payloadDigest(verifyReviewerTask({ repository_root: value.root, ...value.expected })),
      receiptDigest,
    );
    for (const mutation of [
      { ...original, status: 'running' },
      { ...original, parent_session_id: 'ses_other' },
      { ...original, final_response: 'Review passed.' },
    ]) {
      writeFileSync(path, JSON.stringify(mutation));
      assert.throws(() => verifyReviewerTask({ repository_root: value.root, ...value.expected }), /provenance|final_response|payload/u);
    }
  } finally {
    rmSync(value.root, { force: true, recursive: true });
  }
});
