import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type DagDefinition = Readonly<{
  key: string;
  name: string;
  nodes: readonly Readonly<Record<string, unknown>>[];
}>;

type DagBundle = Readonly<{
  state: Readonly<Record<string, unknown>>;
  events: readonly Readonly<Record<string, unknown>>[];
}>;

const {
  attachIssueDagAmendment,
  attachIssueDagRun,
  createIssueDagRunBundle,
  loadIssueDagRunBundle,
  persistIssueDagRunBundle,
  prepareIssueDagAmendment,
  observeIssueDagCompletion,
  settleIssueDagPhase,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-dag-store.mjs',
  )
)) as {
  createIssueDagRunBundle: (
    input: Readonly<Record<string, unknown>>,
  ) => DagBundle;
  attachIssueDagRun: (
    bundle: DagBundle,
    evidence: Readonly<Record<string, unknown>>,
  ) => DagBundle;
  settleIssueDagPhase: (
    bundle: DagBundle,
    evidence: Readonly<Record<string, unknown>>,
  ) => DagBundle;
  prepareIssueDagAmendment: (
    bundle: DagBundle,
    input: Readonly<Record<string, unknown>>,
  ) => DagBundle;
  observeIssueDagCompletion: (
    bundle: DagBundle,
    evidence: Readonly<Record<string, unknown>>,
  ) => DagBundle;
  attachIssueDagAmendment: (
    bundle: DagBundle,
    evidence: Readonly<Record<string, unknown>>,
  ) => DagBundle;
  persistIssueDagRunBundle: (
    runtimeRoot: string,
    bundle: DagBundle,
  ) => void;
  loadIssueDagRunBundle: (
    runtimeRoot: string,
    laneId: string,
    issueNumber: number,
  ) => DagBundle | null;
};
const laneId = 'lane-4101-runtime';
const issueNumber = 4101;
const coordinatorSessionId = 'ses_parent_v3';
const head = 'a'.repeat(40);
const initialFingerprint = 'b'.repeat(64);
const amendedFingerprint = 'c'.repeat(64);
const dispatchEventHash = 'd'.repeat(64);
const preflightNodeId = `preflight-g0-h${head}`;

const initialDefinition: DagDefinition = {
  key: `fluo:lane:${laneId}:issue-${String(issueNumber)}:lifecycle:v3`,
  name: `Fluo lane ${laneId} issue ${String(issueNumber)} lifecycle`,
  nodes: [
    {
      id: preflightNodeId,
      category: 'deep',
      dependsOn: [],
      prompt: 'fixture',
    },
  ],
};

const amendedDefinition: DagDefinition = {
  ...initialDefinition,
  nodes: [
    ...initialDefinition.nodes,
    {
      id: `implement-g1-${head}`,
      subagent_type: 'fluo-issue-implementer',
      dependsOn: [preflightNodeId],
      prompt: head,
    },
  ],
};

const initialBundle = () =>
  createIssueDagRunBundle({
    lane_id: laneId,
    issue_number: issueNumber,
    dependencies: [],
    coordinator_session_id: coordinatorSessionId,
    head_sha: head,
    definition: initialDefinition,
    dispatch_event_hash: dispatchEventHash,
  });

const attachedBundle = () =>
  attachIssueDagRun(initialBundle(), {
    run_id: 'run_issue_4101',
    run_key: initialDefinition.key,
    parent_session_id: coordinatorSessionId,
    definition_fingerprint: initialFingerprint,
    native_generation: 1,
  });

const completedBundle = () =>
  observeIssueDagCompletion(attachedBundle(), {
    completed_node_ids: [preflightNodeId],
    definition_fingerprint: initialFingerprint,
    native_generation: 1,
  });

describe('execute-lane issue DAG run state', () => {
  it('binds one native run to the coordinator and initial definition', () => {
    // When
    const bundle = attachedBundle();

    // Then
    expect(bundle.state).toEqual(
      expect.objectContaining({
        version: 3,
        lane_id: laneId,
        issue_number: issueNumber,
        coordinator_session_id: coordinatorSessionId,
        dag_key: initialDefinition.key,
        run_id: 'run_issue_4101',
        status: 'phase-running',
        definition_generation: 0,
        native_generation: 1,
        definition_fingerprint: initialFingerprint,
        active_node_ids: [preflightNodeId],
      }),
    );
  });

  it('persists intent before attaching one verified amendment', () => {
    // Given
    const settled = settleIssueDagPhase(completedBundle(), {
      completed_node_ids: [preflightNodeId],
      definition_fingerprint: initialFingerprint,
      native_generation: 1,
    });

    // When
    const prepared = prepareIssueDagAmendment(settled, {
      definition: amendedDefinition,
      phase_key: 'implementation:g1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      head_sha: head,
      added_node_ids: [`implement-g1-${head}`],
    });
    const attached = attachIssueDagAmendment(prepared, {
      run_id: 'run_issue_4101',
      run_key: initialDefinition.key,
      parent_session_id: coordinatorSessionId,
      definition_fingerprint: amendedFingerprint,
      native_generation: 2,
      amendment: {
        event_sequence: 10,
        previous_fingerprint: initialFingerprint,
        fingerprint: amendedFingerprint,
        definition_sha256: String(
          (
            prepared.state.pending_amendment as Readonly<
              Record<string, unknown>
            >
          ).definition_sha256,
        ),
        added_node_ids: [`implement-g1-${head}`],
        changed_node_ids: [],
        invalidated_node_ids: [],
      },
    });

    // Then
    expect(prepared.state).toEqual(
      expect.objectContaining({
        status: 'amend-intent',
        definition_generation: 0,
        pending_amendment: expect.objectContaining({
          added_node_ids: [`implement-g1-${head}`],
        }),
      }),
    );
    expect(attached.state).toEqual(
      expect.objectContaining({
        status: 'phase-running',
        definition_generation: 1,
        native_generation: 2,
        definition_fingerprint: amendedFingerprint,
        active_node_ids: [`implement-g1-${head}`],
        pending_amendment: null,
      }),
    );
  });

  it('replays an exact amendment intent and rejects a conflicting one', () => {
    // Given
    const settled = settleIssueDagPhase(completedBundle(), {
      completed_node_ids: [preflightNodeId],
      definition_fingerprint: initialFingerprint,
      native_generation: 1,
    });
    const input = {
      definition: amendedDefinition,
      phase_key: 'implementation:g1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      head_sha: head,
      added_node_ids: [`implement-g1-${head}`],
    };
    const prepared = prepareIssueDagAmendment(settled, input);

    // When / Then
    expect(prepareIssueDagAmendment(prepared, input)).toEqual(prepared);
    expect(() =>
      prepareIssueDagAmendment(prepared, {
        ...input,
        phase_key: 'implementation:g2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).toThrow(/conflicting/u);
  });

  it('round-trips the append-only state bundle without duplicate events', () => {
    // Given
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-issue-dag-store-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    const bundle = attachedBundle();

    try {
      // When
      persistIssueDagRunBundle(runtimeRoot, bundle);
      persistIssueDagRunBundle(runtimeRoot, bundle);

      // Then
      expect(loadIssueDagRunBundle(runtimeRoot, laneId, issueNumber)).toEqual(
        bundle,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
