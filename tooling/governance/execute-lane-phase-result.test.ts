import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { payloadDigest } = await import(
  resolve(
    process.cwd(),
    '.agents/workflow-contracts/contracts.mjs',
  )
);
const { canonicalIssueDagDefinition } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-dag-contracts.mjs',
  )
);
const { verifyIssueDagPhaseResult } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-dag-phase-result.mjs',
  )
)) as {
  verifyIssueDagPhaseResult: (
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
};

const definition = {
  key: 'fluo:lane:lane-4101-runtime:issue-4101:lifecycle:v3',
  name: 'fixture',
  nodes: [
    {
      id: `preflight-g0-h${'0'.repeat(40)}`,
      category: 'deep',
      dependsOn: [],
      prompt: 'fixture',
    },
  ],
};
const canonicalDefinition = canonicalIssueDagDefinition(
  definition,
  'lane-4101-runtime',
  4101,
);
const fingerprint = 'a'.repeat(64);
const state = {
  version: 3,
  lane_id: 'lane-4101-runtime',
  issue_number: 4101,
  dependencies: [],
  coordinator_session_id: 'ses_parent_v3',
  dag_key: definition.key,
  run_id: 'run_issue_4101',
  status: 'native-completed-unverified',
  head_sha: '0'.repeat(40),
  dispatch_event_hash: 'b'.repeat(64),
  definition_generation: 0,
  native_generation: 1,
  current_definition: canonicalDefinition,
  current_definition_sha256: payloadDigest(canonicalDefinition),
  definition_fingerprint: fingerprint,
  active_phase_key: 'preflight',
  active_node_ids: [`preflight-g0-h${'0'.repeat(40)}`],
  completed_phase_keys: [],
  completed_node_ids: [],
  last_completed_node_ids: [],
  pending_amendment: null,
  terminal_issue_status: null,
  terminal_issue_event_hash: null,
};
const nativeRun = {
  runId: 'run_issue_4101',
  runKey: definition.key,
  parentSessionId: 'ses_parent_v3',
  definitionFingerprint: fingerprint,
  generation: 1,
  status: 'completed',
  nodes: {
    [`preflight-g0-h${'0'.repeat(40)}`]: {
      id: `preflight-g0-h${'0'.repeat(40)}`,
      state: 'completed',
      taskId: 'st_preflight',
    },
  },
  task_attachments: {
    [`preflight-g0-h${'0'.repeat(40)}`]: {
      task_id: 'st_preflight',
      attempt: 1,
      event_sequence: 5,
    },
  },
};
const taskRecord = {
  task_id: 'st_preflight',
  parent_session_id: 'ses_parent_v3',
  status: 'completed',
  owner: {
    kind: 'dag',
    runId: 'run_issue_4101',
    nodeId: `preflight-g0-h${'0'.repeat(40)}`,
    fingerprint,
  },
  final_response: 'machine claim',
};

describe('execute-lane native issue phase result', () => {
  it('binds every completed node to its canonical DAG-owned task record', () => {
    expect(
      verifyIssueDagPhaseResult({
        state,
        native_run: nativeRun,
        task_records: { st_preflight: taskRecord },
      }),
    ).toEqual({
      completed_node_ids: [`preflight-g0-h${'0'.repeat(40)}`],
      task_bindings: [
        {
          node_id: `preflight-g0-h${'0'.repeat(40)}`,
          task_id: 'st_preflight',
          attachment_event_sequence: 5,
          task_record_sha256: payloadDigest(taskRecord),
          final_response_sha256: payloadDigest('machine claim'),
        },
      ],
    });
  });

  it('rejects native completion without its canonical task record', () => {
    expect(() =>
      verifyIssueDagPhaseResult({
        state,
        native_run: nativeRun,
        task_records: {},
      }),
    ).toThrow(/task record/u);
  });

  it('rejects a task owned by another run or node', () => {
    expect(() =>
      verifyIssueDagPhaseResult({
        state,
        native_run: nativeRun,
        task_records: {
          st_preflight: {
            ...taskRecord,
            owner: { ...taskRecord.owner, nodeId: 'substituted' },
          },
        },
      }),
    ).toThrow(/owner/u);
  });

  it('rejects a child result when the issue DAG is still running', () => {
    expect(() =>
      verifyIssueDagPhaseResult({
        state,
        native_run: { ...nativeRun, status: 'running' },
        task_records: { st_preflight: taskRecord },
      }),
    ).toThrow(/completed/u);
  });
});
