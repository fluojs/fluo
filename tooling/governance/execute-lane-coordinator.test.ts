import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type IssueDagState = Readonly<Record<string, unknown>>;

const { planLaneCoordinator, reconcileIssueDagRun } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-coordinator.mjs',
  )
)) as {
  planLaneCoordinator: (input: {
    lane: Readonly<Record<string, unknown>>;
    issue_dags: Readonly<Record<string, IssueDagState | null>>;
    max_active_issue_dags: number;
  }) => Readonly<Record<string, unknown>>;
  reconcileIssueDagRun: (input: {
    state: IssueDagState;
    native_run: Readonly<Record<string, unknown>> | null;
  }) => Readonly<Record<string, unknown>>;
};
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

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readyLane = (): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-two-lanes-v2.json',
      ),
      'utf8',
    ),
  );
  if (!isRecord(parsed)) {
    throw new TypeError('Lane fixture must be an object.');
  }
  return {
    ...parsed,
    dependency_graph: { '4101': [], '4102': [] },
  };
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

const dispatchIntent = (): IssueDagState => ({
  version: 3,
  lane_id: 'lane-4101-runtime',
  issue_number: 4101,
  dependencies: [],
  coordinator_session_id: 'ses_parent_v3',
  dag_key: definition.key,
  run_id: null,
  status: 'dispatch-intent',
  head_sha: '0'.repeat(40),
  dispatch_event_hash: 'd'.repeat(64),
  definition_generation: 0,
  current_definition: canonicalDefinition,
  current_definition_sha256: payloadDigest(canonicalDefinition),
  definition_fingerprint: null,
  native_generation: null,
  active_phase_key: 'preflight',
  active_node_ids: [],
  completed_phase_keys: [],
  completed_node_ids: [],
  last_completed_node_ids: [],
  pending_amendment: null,
  terminal_issue_status: null,
  terminal_issue_event_hash: null,
});

const attached = (): IssueDagState => ({
  ...dispatchIntent(),
  run_id: 'run_issue_4101',
  status: 'phase-running',
  definition_fingerprint: 'b'.repeat(64),
  native_generation: 1,
  active_node_ids: [`preflight-g0-h${'0'.repeat(40)}`],
});

describe('execute-lane issue DAG coordinator', () => {
  it('admits ready issues up to the configured capacity', () => {
    // When
    const plan = planLaneCoordinator({
      lane: readyLane(),
      issue_dags: { '4101': null, '4102': null },
      max_active_issue_dags: 1,
    });

    // Then
    expect(plan).toEqual(
      expect.objectContaining({
        active_issue_numbers: [],
        admit_issue_numbers: [4101],
        waiting_issue_numbers: [4102],
      }),
    );
  });

  it('does not admit a dependent from native completion alone', () => {
    // Given
    const lane = {
      ...readyLane(),
      dependency_graph: { '4101': [], '4102': [4101] },
    };

    // When
    const plan = planLaneCoordinator({
      lane,
      issue_dags: {
        '4101': attached(),
        '4102': null,
      },
      max_active_issue_dags: 2,
    });

    // Then
    expect(plan).toEqual(
      expect.objectContaining({
        active_issue_numbers: [4101],
        admit_issue_numbers: [],
        waiting_issue_numbers: [4102],
      }),
    );
  });

  it('reconciles every crash window without replacing the issue run', () => {
    // Dispatch intent exists before native start.
    expect(
      reconcileIssueDagRun({
        state: dispatchIntent(),
        native_run: null,
      }),
    ).toEqual({ action: 'start', definition: canonicalDefinition });

    // Native run exists before the local attachment is persisted.
    expect(
      reconcileIssueDagRun({
        state: dispatchIntent(),
        native_run: {
          runId: 'run_issue_4101',
          runKey: definition.key,
          parentSessionId: 'ses_parent_v3',
          definitionFingerprint: 'b'.repeat(64),
          generation: 1,
          status: 'running',
        },
      }),
    ).toEqual(
      expect.objectContaining({
        action: 'attach-run',
        run_id: 'run_issue_4101',
      }),
    );

    // An attached active run is observed rather than restarted.
    expect(
      reconcileIssueDagRun({
        state: attached(),
        native_run: {
          runId: 'run_issue_4101',
          runKey: definition.key,
          parentSessionId: 'ses_parent_v3',
          definitionFingerprint: 'b'.repeat(64),
          generation: 1,
          status: 'running',
        },
      }),
    ).toEqual({ action: 'wait', run_id: 'run_issue_4101' });
  });

  it('fails closed on a substituted run owner or key', () => {
    expect(() =>
      reconcileIssueDagRun({
        state: attached(),
        native_run: {
          runId: 'run_issue_4101',
          runKey: 'fluo:substituted',
          parentSessionId: 'ses_attacker',
          definitionFingerprint: 'b'.repeat(64),
          generation: 1,
          status: 'running',
        },
      }),
    ).toThrow(/identity/u);
  });

  it.each([0, -1, 1.5, 65])(
    'rejects invalid issue DAG capacity %s',
    (maxActiveIssueDags) => {
      expect(() =>
        planLaneCoordinator({
          lane: readyLane(),
          issue_dags: {},
          max_active_issue_dags: maxActiveIssueDags,
        }),
      ).toThrow(/capacity/u);
    },
  );
});
