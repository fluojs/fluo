import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const { payloadDigest } = await import(
  resolve(repoRoot, '.agents/workflow-contracts/contracts.mjs')
);
const { createReviewPreflight } = await import(
  resolve(
    repoRoot,
    '.agents/skills/execute-lane/scripts/review-loop-policy.mjs',
  )
);
const { verifyPreflightTask } = await import(
  resolve(
    repoRoot,
    '.agents/skills/execute-lane/scripts/issue-dag-worker-runtime.mjs',
  )
);
const { formatSenpiFinalResponse } = await import(
  resolve(
    repoRoot,
    '.agents/skills/execute-lane/scripts/senpi-final-response.mjs',
  )
);

const laneId = 'lane-4101-runtime';
const issueNumber = 4101;
const taskId = 'st_preflight';
const nodeId = `preflight-g0-h${'a'.repeat(40)}`;
const runId = 'dag_preflight';
const ownerFingerprint = 'b'.repeat(64);
const head = 'a'.repeat(40);
const issueContractSha256 = 'd'.repeat(64);
const lanePlanApprovalSha256 = 'e'.repeat(64);

const preflight = () => {
  const acceptanceText = 'The bound acceptance criterion is covered.';
  const source = {
    source: 'https://github.com/fluojs/fluo/issues/4101',
    revision: '2026-08-27T00:00:00Z',
    content_sha256: 'c'.repeat(64),
  };
  return createReviewPreflight({
    lane_id: laneId,
    issue_number: issueNumber,
    issue_contract_revision: source.revision,
    issue_contract_sha256: 'd'.repeat(64),
    lane_plan_approval_sha256: 'e'.repeat(64),
    head_sha: head,
    generated_at: '2026-08-27T00:00:01.000Z',
    approved_sources: [source],
    acceptance_row_ids: ['acceptance-1'],
    rows: [
      {
        id: 'acceptance-1',
        acceptance_text: acceptanceText,
        acceptance_sha256: payloadDigest({ content: acceptanceText }),
        source: source.source,
        source_bindings: [source],
        invariant: acceptanceText,
        surfaces: ['src/runtime.ts'],
        positive_cases: ['the supported input succeeds'],
        negative_cases: ['the unsupported input fails closed'],
        boundary_cases: ['the empty boundary remains deterministic'],
      },
    ],
    nonfunctional: {
      complexity: 'Work is linear in the bound input.',
      memory: 'Memory is bounded by the input.',
      atomicity: 'No partial result is committed.',
      mutation_boundary: 'Preflight is source-read-only.',
    },
  });
};

type ToolCall = Readonly<{
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}>;

const fixture = (
  calls: readonly ToolCall[],
  options: Readonly<{
    bareFinalResponse?: boolean;
    fencedPreflightResponse?: boolean;
    omitPreflightDigest?: boolean;
    omitEnvelopeIdentity?: boolean;
    taskName?: string;
    toolAllow?: readonly string[];
    dispatchOverrides?: Readonly<Record<string, unknown>>;
  }> = {},
) => {
  const root = realpathSync(
    mkdtempSync(join(realpathSync(tmpdir()), 'fluo-worker-runtime-')),
  );
  const taskDirectory = resolve(root, '.omo', 'senpi-task', 'tasks');
  const sessionDirectory = resolve(
    root,
    '.omo',
    'senpi-task',
    'children',
    taskId,
    'sessions',
    taskId,
  );
  mkdirSync(taskDirectory, { recursive: true });
  mkdirSync(sessionDirectory, { recursive: true });
  const claimedPreflight = preflight();
  const finalResponse = {
    sentinel: 'fluo:execute-lane:preflight:final:v3',
    version: 3,
    ...(options.omitEnvelopeIdentity
      ? {}
      : {
          lane_id: laneId,
          issue_number: issueNumber,
          dag_key: `fluo:lane:${laneId}:issue-${String(issueNumber)}:lifecycle:v3`,
          node_id: nodeId,
        }),
    status: 'completed',
    preflight: options.omitPreflightDigest
      ? (({ sha256: _sha256, ...value }) => value)(claimedPreflight)
      : claimedPreflight,
  };
  writeFileSync(
    resolve(taskDirectory, `${taskId}.json`),
    `${JSON.stringify({
      task_id: taskId,
      status: 'completed',
      execution_mode: 'process',
      parent_session_id: 'ses_parent',
      name: options.taskName ?? nodeId,
      agent_type: 'fluo-issue-preflight',
      tool_allow: options.toolAllow ?? ['read', 'todo'],
      spawn_spec: {
        cwd: root,
        prompt: [
          '<fluo-terminal-dispatch-v1>',
          JSON.stringify({
            version: 3,
            lane_id: laneId,
            issue_number: issueNumber,
            dag_key: `fluo:lane:${laneId}:issue-${String(issueNumber)}:lifecycle:v3`,
            node_id: nodeId,
            repository_root: root,
            lane_ledger_path: 'AGENTS.md',
            issue_store_path: 'AGENTS.md',
            evidence_paths: ['AGENTS.md'],
            starting_head_sha: head,
            issue_contract_sha256: issueContractSha256,
            lane_plan_approval_sha256: lanePlanApprovalSha256,
            ...options.dispatchOverrides,
          }),
          '</fluo-terminal-dispatch-v1>',
        ].join('\n'),
      },
      owner: {
        kind: 'dag',
        runId,
        nodeId,
        fingerprint: ownerFingerprint,
      },
      final_response: options.fencedPreflightResponse
        ? [
            'fluo:execute-lane:preflight:final:v3',
            '',
            '```json',
            JSON.stringify(finalResponse.preflight),
            '```',
          ].join('\n')
        : options.bareFinalResponse
          ? JSON.stringify(finalResponse)
          : formatSenpiFinalResponse(
              'fluo:execute-lane:preflight:final:v3',
              finalResponse,
            ),
    })}\n`,
  );
  const messages = calls.flatMap((call, index) => {
    const id = `call-${String(index + 1)}`;
    return [
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id, name: call.name, arguments: call.arguments },
          ],
        },
      },
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: id,
          isError: false,
        },
      },
    ];
  });
  writeFileSync(
    resolve(sessionDirectory, 'session.jsonl'),
    `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`,
  );
  return root;
};

const expected = (root: string) => ({
  repository_root: root,
  task_id: taskId,
  parent_session_id: 'ses_parent',
  dag_run_id: runId,
  dag_owner_fingerprint: ownerFingerprint,
  lane_id: laneId,
  issue_number: issueNumber,
  dag_key: `fluo:lane:${laneId}:issue-${String(issueNumber)}:lifecycle:v3`,
  node_id: nodeId,
  head_sha: head,
  lane_ledger_path: 'AGENTS.md',
  issue_store_path: 'AGENTS.md',
  evidence_paths: ['AGENTS.md'],
  issue_contract_sha256: issueContractSha256,
  lane_plan_approval_sha256: lanePlanApprovalSha256,
});

describe('execute-lane direct preflight worker runtime', () => {
  it('accepts read and task-local todo then seals a digestless claim', () => {
    const root = fixture([
      { name: 'todo', arguments: { op: 'init', items: ['Inspect authority'] } },
      { name: 'read', arguments: { path: 'AGENTS.md' } },
    ], { omitPreflightDigest: true });
    try {
      const verified = verifyPreflightTask(expected(root));
      expect(verified.tool_events).toHaveLength(2);
      expect(verified.preflight.sha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts an already sealed canonical preflight', () => {
    const root = fixture([{ name: 'read', arguments: { path: 'AGENTS.md' } }]);
    try {
      expect(verifyPreflightTask(expected(root)).tool_events).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses DAG owner node identity when task names are globally suffixed', () => {
    const root = fixture(
      [{ name: 'read', arguments: { path: 'AGENTS.md' } }],
      { taskName: `${nodeId}-2` },
    );
    try {
      expect(verifyPreflightTask(expected(root)).task_id).toBe(taskId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a bare machine JSON final response', () => {
    const root = fixture(
      [{ name: 'read', arguments: { path: 'AGENTS.md' } }],
      { bareFinalResponse: true },
    );
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /exactly one/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a preflight envelope without exact DAG identity', () => {
    const root = fixture(
      [{ name: 'read', arguments: { path: 'AGENTS.md' } }],
      { omitEnvelopeIdentity: true },
    );
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /identity|envelope/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a sentinel-prefixed fenced preflight object', () => {
    const root = fixture(
      [{ name: 'read', arguments: { path: 'AGENTS.md' } }],
      { fencedPreflightResponse: true },
    );
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /final_response/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a preflight that did not read every bound artifact', () => {
    const root = fixture([
      { name: 'read', arguments: { path: 'README.md' } },
    ]);
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /bound artifact/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['eval', { name: 'eval', arguments: { language: 'js', code: 'return 1' } }],
    [
      'read-only bash',
      {
        name: 'bash',
        arguments: { command: 'git status --short', timeout: 120 },
      },
    ],
  ])('rejects %s evidence', (_name, call) => {
    const root = fixture([call]);
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /forbidden tool/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects task metadata outside the preflight tool policy', () => {
    const root = fixture(
      [{ name: 'read', arguments: { path: 'AGENTS.md' } }],
      { toolAllow: ['read', 'todo', 'eval'] },
    );
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /forbidden tool/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects prompt-substituted preflight authority', () => {
    const root = fixture(
      [{ name: 'read', arguments: { path: 'AGENTS.md' } }],
      { dispatchOverrides: { evidence_paths: ['package.json'] } },
    );
    try {
      expect(() => verifyPreflightTask(expected(root))).toThrow(
        /authority|dispatch/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
