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
import { writeActualShapedReviewerTask } from './fixtures/reviewer-task.mjs';
import { fixturePreflight } from './fixtures/implementer-task.mjs';
import { formatSenpiFinalResponse } from './senpi-final-response.mjs';
import {
  reviewerPromptSentinel,
  reviewerTaskName,
  verifyReviewerTask,
} from './reviewer-runtime.mjs';

const head = 'a'.repeat(40);
const parentSessionId = 'ses_parent';
const laneId = 'lane-a';
const issueNumber = 3305;
const worktree = '.worktrees/issue-3305-content-negotiation';
const branch = 'issue-3305-content-negotiation';
const preflightSha256 = fixturePreflight(laneId, issueNumber).sha256;
const parentReceiptId = 'st_parent_verify_3305';
const reviewerAgent = {
  contract: 'fluo-contract-reviewer',
  code: 'fluo-code-reviewer',
  verification: 'fluo-verification-reviewer',
};

const identity = (axis) => ({
  task_id: `st_${axis}`,
  parent_session_id: parentSessionId,
  lane_id: laneId,
  issue_number: issueNumber,
  worktree,
  branch,
  head_sha: head,
  preflight_sha256: preflightSha256,
  axis,
  ...(axis === 'verification'
    ? { canonical_verification_receipt_id: parentReceiptId }
    : {}),
});

const task = (root, axis, verdict = 'PASS') => {
  const blocked = verdict === 'BLOCK';
  const blocker = {
    reviewer: axis,
    signature: `${axis}:canonical-verification`,
    evidence: 'The parent-owned canonical verification failed.',
    fix_back_eligible: true,
    status: 'unresolved',
  };
  const output = {
    sentinel: 'fluo:execute-lane:review:final:v1',
    axis,
    head_sha: head,
    preflight_sha256: preflightSha256,
    verdict_signal: verdict,
    coverage: { 'accept-header-presence': blocked ? 'BLOCK' : 'PASS' },
    blockers: blocked ? [blocker] : [],
    blocker_sources: blocked
      ? {
          [blocker.signature]: {
            contract_source: 'issue acceptance',
            violated_invariant: 'accept-header-presence',
            reproduction: blocker.evidence,
            why_blocking: 'required-verification',
          },
        }
      : {},
  };
  return {
    task_id: `st_${axis}`,
    status: 'completed',
    parent_session_id: parentSessionId,
    agent_type: reviewerAgent[axis],
    resolved_model: {
      provider: 'openai-codex',
      model_id: 'gpt-5.6-sol',
      source: 'category',
      variant: 'medium',
    },
    name: reviewerTaskName(axis, issueNumber, head),
    final_response: formatSenpiFinalResponse(
      'fluo:execute-lane:review:final:v1',
      output,
    ),
    spawn_spec: {
      cwd: root,
      prompt: `Review without mutation.\n${reviewerPromptSentinel({
        repository_root: root,
        lane_id: laneId,
        issue_number: issueNumber,
        worktree,
        head_sha: head,
        preflight_sha256: preflightSha256,
        review_axis: axis,
        ...(axis === 'verification'
          ? {
              canonical_verification_receipt_id: parentReceiptId,
            }
          : {}),
      })}`,
    },
  };
};

const fixture = (
  axis,
  {
    tools,
    verificationStatus = 0,
    verify = true,
    lifecycleEvents = [],
    toolAllow,
  } = {},
) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'fluo-reviewer-runtime-')),
  );
  const expected = identity(axis);
  const receipt = writeActualShapedReviewerTask({
    task: {
      ...task(
        root,
        axis,
        axis === 'verification' && verificationStatus !== 0
          ? 'BLOCK'
          : 'PASS',
      ),
      ...(toolAllow === undefined ? {} : { tool_allow: toolAllow }),
    },
    repository_root: root,
    expected,
    tools,
    verification_status: verificationStatus,
    lifecycle_events: lifecycleEvents,
    verify,
  });
  return { root, expected, receipt };
};

test('all reviewers are read-only and verification binds one parent receipt', () => {
  for (const axis of ['contract', 'code', 'verification']) {
    const prompt = reviewerPromptSentinel({
      repository_root: process.cwd(),
      lane_id: laneId,
      issue_number: issueNumber,
      worktree,
      head_sha: head,
      preflight_sha256: preflightSha256,
      review_axis: axis,
      ...(axis === 'verification'
        ? { canonical_verification_receipt_id: parentReceiptId }
        : {}),
    });
    const dispatch = JSON.parse(prompt.split('\n')[1]);
    assert.equal(dispatch.local_ci_role, 'read-only');
    assert.equal(dispatch.artifact_writes, false);
    assert.equal(
      dispatch.canonical_verification_receipt_id,
      axis === 'verification' ? parentReceiptId : undefined,
    );
  }
});

test('reviewers accept only the configured read and todo tools', () => {
  for (const axis of ['contract', 'code']) {
    const value = fixture(axis, {
      tools: [
        { tool: 'todo', is_error: false },
        {
          tool: 'read',
          is_error: false,
          arguments: {
            path:
              '.omo/lane-runs/lane-a/issues/3305/review-preflight.json',
          },
        },
        {
          tool: 'read',
          is_error: false,
          arguments: {
            path: `${worktree}/package.json`,
          },
        },
      ],
    });
    try {
      assert.equal(value.receipt.tool_events.length, 3);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('reviewers reject metadata and session tools outside the allowlist', () => {
  for (const candidate of [
    { tools: [{ tool: 'bash', is_error: false }] },
    { tools: [{ tool: 'eval', is_error: false }] },
    { toolAllow: ['read', 'todo', 'bash'] },
  ]) {
    const value = fixture('contract', { ...candidate, verify: false });
    try {
      assert.throws(
        () =>
          verifyReviewerTask({
            repository_root: value.root,
            ...value.expected,
          }),
        /forbidden|unknown|provenance/u,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('contract and code reviewers reject todo-only evidence', () => {
  for (const axis of ['contract', 'code']) {
    const value = fixture(axis, {
      verify: false,
      tools: [{ tool: 'todo', is_error: false }],
    });
    try {
      assert.throws(
        () =>
          verifyReviewerTask({
            repository_root: value.root,
            ...value.expected,
          }),
        /read coverage/u,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('completed reviewer nodes reject revival and steering corrections', () => {
  for (const type of ['revived', 'steered']) {
    const value = fixture('contract', {
      verify: false,
      lifecycleEvents: [{ type, payload: {} }],
    });
    try {
      assert.throws(
        () =>
          verifyReviewerTask({
            repository_root: value.root,
            ...value.expected,
          }),
        /unknown event type/u,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

test('verification authenticates the immutable parent-owned receipt read', () => {
  const value = fixture('verification');
  try {
    assert.deepEqual(value.receipt.canonical_verification, {
      receipt_id: parentReceiptId,
      receipt_sha256:
        value.receipt.canonical_verification.receipt_sha256,
      authority_snapshot_sha256: 'a'.repeat(64),
      command: ['pnpm', 'verify'],
      status: 0,
      result: 'pass',
      session_sha256: value.receipt.session_sha256,
    });
    assert.equal(value.receipt.tool_events[0].tool, 'read');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('failed parent verification is accepted only as a BLOCK review', () => {
  const value = fixture('verification', { verificationStatus: 1 });
  try {
    assert.equal(value.receipt.final_response.verdict_signal, 'BLOCK');
    assert.equal(value.receipt.canonical_verification.result, 'fail');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('verification rejects missing, substituted, and tampered receipts', () => {
  const value = fixture('verification', { verify: false });
  const receiptPath = resolve(
    value.root,
    '.omo/lane-runs/lane-a/issues/3305/canonical-verification',
    `${parentReceiptId}.json`,
  );
  try {
    rmSync(receiptPath);
    assert.throws(
      () =>
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
        }),
      /provenance|missing or invalid/u,
    );
    writeActualShapedReviewerTask({
      task: task(value.root, 'verification'),
      repository_root: value.root,
      expected: value.expected,
      verify: false,
    });
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.head_sha = 'b'.repeat(40);
    writeFileSync(receiptPath, JSON.stringify(receipt));
    assert.throws(
      () =>
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
        }),
      /malformed or stale/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('verification rejects receipt and parent-session substitution', () => {
  for (const mutate of [
    (receipt) => {
      receipt.task_id = 'st_substituted_receipt';
    },
    (receipt) => {
      receipt.parent_session_id = 'ses_attacker';
    },
  ]) {
    const value = fixture('verification', { verify: false });
    const receiptPath = resolve(
      value.root,
      '.omo/lane-runs/lane-a/issues/3305/canonical-verification',
      `${parentReceiptId}.json`,
    );
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      mutate(receipt);
      writeFileSync(receiptPath, JSON.stringify(receipt));
      assert.throws(
        () =>
          verifyReviewerTask({
            repository_root: value.root,
            ...value.expected,
          }),
        /malformed or stale/u,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }

  const value = fixture('verification', { verify: false });
  try {
    assert.throws(
      () =>
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
          canonical_verification_receipt_id:
            'st_substituted_receipt',
        }),
      /provenance|missing or invalid/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('reviewer rejects role identity spoofing', () => {
  const value = fixture('code', { verify: false });
  const taskPath = resolve(
    value.root,
    '.omo/senpi-task/tasks/st_code.json',
  );
  try {
    const taskRecord = JSON.parse(readFileSync(taskPath, 'utf8'));
    taskRecord.agent_type = 'fluo-contract-reviewer';
    writeFileSync(taskPath, JSON.stringify(taskRecord));
    assert.throws(
      () =>
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
        }),
      /role/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('reviewer rejects unknown final envelope fields', () => {
  const value = fixture('contract', { verify: false });
  const taskPath = resolve(
    value.root,
    '.omo/senpi-task/tasks/st_contract.json',
  );
  try {
    const taskRecord = JSON.parse(readFileSync(taskPath, 'utf8'));
    taskRecord.final_response = taskRecord.final_response.replace(
      '"verdict_signal":"PASS"',
      '"unexpected":true,"verdict_signal":"PASS"',
    );
    writeFileSync(taskPath, JSON.stringify(taskRecord));
    assert.throws(
      () =>
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
        }),
      /malformed/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('reviewer completion digest binds tool policy and machine output', () => {
  const value = fixture('contract');
  const path = resolve(
    value.root,
    '.omo/senpi-task/tasks/st_contract.json',
  );
  try {
    const original = JSON.parse(readFileSync(path, 'utf8'));
    const digest = payloadDigest(value.receipt);
    writeFileSync(path, JSON.stringify({
      ...original,
      residency_state: 'evicted',
      updated_at: '2026-08-26T00:30:00.000Z',
    }));
    assert.equal(
      payloadDigest(
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
        }),
      ),
      digest,
    );
    writeFileSync(path, JSON.stringify({
      ...original,
      tool_allow: ['read', 'todo', 'bash'],
    }));
    assert.throws(
      () =>
        verifyReviewerTask({
          repository_root: value.root,
          ...value.expected,
        }),
      /provenance/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
