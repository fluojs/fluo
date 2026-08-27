import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const { assertContract, payloadDigest } = await import(
  resolve(process.cwd(), '.agents/workflow-contracts/contracts.mjs')
);
const {
  createIssueSupervisor,
  transitionIssueSupervisor,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor.mjs',
  )
);
const { assertIssueSupervisorState } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor-contracts.mjs',
  )
);
const { writeActualShapedImplementerTask } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/implementer-task.mjs',
  )
);
const { createReviewPreflight } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/review-loop-policy.mjs',
  )
);
const { writeActualShapedReviewerTask } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/reviewer-task.mjs',
  )
);
const {
  reviewerPromptSentinel,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/reviewer-runtime.mjs',
  )
);
const { validateLedger } = await import(
  resolve(process.cwd(), 'tooling/governance/lane-ledger-state.mjs')
);

const adaptiveRetryPolicy = {
  retry_count_is_terminal: false,
  max_same_failure_repeats: null,
  max_wall_clock_minutes: null,
  stop_on_child_contract_error: true,
} as const;

const startedAt = '2026-08-25T00:00:00.000Z';
const observedAfterLegacyBudget = '2026-08-26T00:00:00.000Z';
const repositoryRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'fluo-adaptive-v2-')),
);
const parentSessionId = 'ses-adaptive-retry';
afterAll(() => {
  rmSync(repositoryRoot, { force: true, recursive: true });
});

const identity = {
  lane_id: 'lane-adaptive-retry',
  issue_number: 4101,
  branch: 'issue-4101-adaptive-retry',
  worktree: '.worktrees/issue-4101-adaptive-retry',
  starting_head_sha: '0'.repeat(40),
  started_at: startedAt,
  review_policy: 'preflight-v1',
  repository_root: repositoryRoot,
  parent_session_id: parentSessionId,
  issue_contract_revision: 'issue-4101@1',
  issue_contract_sha256: '1'.repeat(64),
  lane_plan_approval_sha256: '2'.repeat(64),
  release_handoff: false,
  authority_scope: {
    pr_creation: true,
    pr_merge: true,
    cleanup_command_worktrees: true,
  },
  retry_policy: adaptiveRetryPolicy,
} as const;

const blocker = (fixBackEligible: boolean) => ({
  reviewer: 'code',
  signature: 'runtime:worker:abort-path',
  evidence: 'packages/runtime/src/worker.ts:42',
  fix_back_eligible: fixBackEligible,
  status: 'unresolved',
});

const reviewsFor = (head: string, fixBackEligible: boolean) => [
  {
    reviewer: 'contract',
    reviewed_head_sha: head,
    verdict_signal: 'PASS',
    blockers: [],
  },
  {
    reviewer: 'code',
    reviewed_head_sha: head,
    verdict_signal: 'BLOCK',
    blockers: [blocker(fixBackEligible)],
  },
  {
    reviewer: 'verification',
    reviewed_head_sha: head,
    verdict_signal: 'PASS',
    blockers: [],
  },
];

const reviewPreflight = createReviewPreflight({
  version: 1,
  lane_id: identity.lane_id,
  issue_number: identity.issue_number,
  issue_contract_revision: identity.issue_contract_revision,
  issue_contract_sha256: identity.issue_contract_sha256,
  lane_plan_approval_sha256: identity.lane_plan_approval_sha256,
  head_sha: identity.starting_head_sha,
  generated_at: startedAt,
  approved_sources: [
    {
      source: 'adaptive retry acceptance',
      revision: identity.issue_contract_revision,
      content_sha256: '3'.repeat(64),
    },
  ],
  acceptance_row_ids: ['adaptive-retry'],
  rows: [
    {
      id: 'adaptive-retry',
      acceptance_text: 'Fixable work remains active across adaptive retries.',
      acceptance_sha256: payloadDigest({ content: 'Fixable work remains active across adaptive retries.' }),
      source: 'adaptive retry acceptance',
      source_bindings: [{ source: 'adaptive retry acceptance', revision: identity.issue_contract_revision, content_sha256: '3'.repeat(64) }],
      invariant: 'Fixable work remains active across adaptive retries.',
      surfaces: ['issue-supervisor'],
      positive_cases: ['A remediated blocker advances to a new head.'],
      negative_cases: ['A non-fixable blocker parks for human review.'],
      boundary_cases: ['Fresh implementers rotate after two blocked heads.'],
    },
  ],
  nonfunctional: {
    complexity: 'Retry bookkeeping remains bounded per transition.',
    memory: 'The blocker ledger grows only with observed blockers.',
    atomicity: 'Each retry transition is atomic.',
    mutation_boundary: 'Only issue-local state changes.',
  },
});

const reviewerTask = (axis: string, head: string, fixBackEligible: boolean) => {
  const taskId = `st_${axis}${head.slice(0, 8)}`;
  const blocked = axis === 'code';
  const finalResponse = {
    sentinel: 'fluo:execute-lane:review:final:v1',
    axis,
    head_sha: head,
    preflight_sha256: reviewPreflight.sha256,
    verdict_signal: blocked ? 'BLOCK' : 'PASS',
    coverage: { 'adaptive-retry': blocked ? 'BLOCK' : 'PASS' },
    blockers: blocked ? [blocker(fixBackEligible)] : [],
    blocker_sources: blocked
      ? {
          'runtime:worker:abort-path': {
            contract_source: 'adaptive retry acceptance',
            violated_invariant: 'adaptive-retry',
            reproduction: 'Exercise the worker abort path.',
            why_blocking: fixBackEligible ? 'correctness' : 'compatibility',
          },
        }
      : {},
  };
  const dagRunId = `dag_issue-${String(identity.issue_number)}`;
  const dagKey =
    `fluo:lane:${identity.lane_id}:issue-${String(identity.issue_number)}:lifecycle:v3`;
  const nodeId = `review-${axis}-${head}`;
  const ownerFingerprint = payloadDigest(nodeId);
  const task = {
    task_id: taskId,
    status: 'completed',
    agent_type: `fluo-${axis === 'verification' ? 'verification' : axis}-reviewer`,
    parent_session_id: parentSessionId,
    name: nodeId,
    owner: {
      kind: 'dag',
      runId: dagRunId,
      nodeId,
      fingerprint: ownerFingerprint,
    },
    final_response:
      `<fluo:execute-lane:review:final:v1>${JSON.stringify(finalResponse)}` +
      '</fluo:execute-lane:review:final:v1>',
    spawn_spec: {
      cwd: repositoryRoot,
      prompt:
        `Review without mutation.\n${reviewerPromptSentinel({
          repository_root: repositoryRoot,
          lane_id: identity.lane_id,
          issue_number: identity.issue_number,
          worktree: identity.worktree,
          head_sha: head,
          preflight_sha256: reviewPreflight.sha256,
          review_axis: axis,
          dag_key: dagKey,
          node_id: nodeId,
        })}`,
    },
  };
  const receipt = writeActualShapedReviewerTask({
    task,
    repository_root: repositoryRoot,
    expected: {
      task_id: taskId,
      parent_session_id: parentSessionId,
      lane_id: identity.lane_id,
      issue_number: identity.issue_number,
      worktree: identity.worktree,
      branch: identity.branch,
      head_sha: head,
      preflight_sha256: reviewPreflight.sha256,
      axis,
      dag_run_id: dagRunId,
      dag_key: dagKey,
      node_id: nodeId,
      dag_owner_fingerprint: ownerFingerprint,
    },
  });
  return { taskId, receipt };
};

const reviewBatchFor = (head: string, fixBackEligible: boolean) => {
  const tasks = Object.fromEntries(
    ['contract', 'code', 'verification'].map((axis) => [
      axis,
      reviewerTask(axis, head, fixBackEligible),
    ]),
  ) as Record<
    string,
    Readonly<{ taskId: string; receipt: Readonly<Record<string, unknown>> }>
  >;
  return {
    preflight_sha256: reviewPreflight.sha256,
    task_ids: Object.fromEntries(
      Object.entries(tasks).map(([axis, task]) => [axis, task.taskId]),
    ),
    reviewer_receipts: Object.fromEntries(
      Object.entries(tasks).map(([axis, task]) => [axis, task.receipt]),
    ),
    coverage: {
      contract: { 'adaptive-retry': 'PASS' },
      code: { 'adaptive-retry': 'BLOCK' },
      verification: { 'adaptive-retry': 'PASS' },
    },
    blocker_sources: {
      'runtime:worker:abort-path': {
        contract_source: 'adaptive retry acceptance',
        violated_invariant: 'adaptive-retry',
        reproduction: 'Exercise the worker abort path.',
        why_blocking: fixBackEligible ? 'correctness' : 'compatibility',
      },
    },
  };
};

const persistImplementerTask = (
  state: Readonly<Record<string, unknown>>,
  newHead: string,
  generation: number,
  result: 'implementation-completed' | 'fix-completed',
) => {
  const taskId = `st_implement${String(generation)}${newHead.slice(0, 8)}`;
  const dagRunId = `dag_issue-${String(identity.issue_number)}`;
  const dagKey =
    `fluo:lane:${identity.lane_id}:issue-${String(identity.issue_number)}:lifecycle:v3`;
  const nodeId = `implement-g${String(generation)}-${String(state.head_sha)}`;
  const ownerFingerprint = payloadDigest(nodeId);
  writeActualShapedImplementerTask({
    repository_root: repositoryRoot,
    task_id: taskId,
    parent_session_id: parentSessionId,
    lane_id: identity.lane_id,
    issue_number: identity.issue_number,
    worktree: identity.worktree,
    current_head: state.head_sha,
    new_head: newHead,
    generation,
    result,
    verification: 'focused tests passed',
    addressed_blockers:
      result === 'fix-completed'
        ? remediatedBlockers(state.blockers as Record<string, unknown>[])
        : [],
    blocker_ledger: state.blocker_ledger as Record<string, unknown>[],
    unresolved_blockers: (state.blocker_ledger as Record<string, unknown>[]).filter(
      (entry) => entry.remediation_status === 'unresolved',
    ),
    blocker_ledger_sha256: payloadDigest(state.blocker_ledger),
    preflight_sha256: reviewPreflight.sha256,
    authoritative_preflight: reviewPreflight,
    dag_run_id: dagRunId,
    dag_key: dagKey,
    node_id: nodeId,
    dag_owner_fingerprint: ownerFingerprint,
  });
  return {
    task_id: taskId,
    dag_run_id: dagRunId,
    dag_node_id: nodeId,
    dag_owner_fingerprint: ownerFingerprint,
  };
};

const createImplementingState = () =>
  transitionIssueSupervisor(createIssueSupervisor(identity), {
    kind: 'preflight-completed',
    preflight: reviewPreflight,
  });

const remediatedBlockers = (blockers: readonly Record<string, unknown>[]) =>
  blockers.map((item) => ({ ...item, status: 'remediated' }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (path: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(value)) {
    throw new TypeError(`${path} must contain a JSON object.`);
  }
  return value;
};

describe('execute-lane adaptive retry policy', () => {
  it('keeps fixable work active beyond legacy count and wall-clock budgets', () => {
    // Given
    let state = createImplementingState();
    let head = 'a'.repeat(40);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: head,
      verification: 'focused tests passed',
      implementer_generation: 1,
      implementer_evidence: persistImplementerTask(
        state,
        head,
        1,
        'implementation-completed',
      ),
    });

    // When
    for (const nextHead of ['b', 'c', 'd', 'e', 'f', '1'].map((value) =>
      value.repeat(40),
    )) {
      state = transitionIssueSupervisor(state, {
        kind: 'local-review',
        reviews: reviewsFor(head, true),
        review_batch: reviewBatchFor(head, true),
      });
      const refresh = state.blocked_heads_since_refresh >= 2;
      const generation = refresh
        ? state.implementer_generation + 1
        : state.implementer_generation;
      const implementerEvidence = persistImplementerTask(
        state,
        nextHead,
        generation,
        'fix-completed',
      );
      state = transitionIssueSupervisor(state, {
        kind: 'fix-completed',
        new_head: nextHead,
        observed_at: observedAfterLegacyBudget,
        verification: 'focused tests passed',
        addressed_blockers: remediatedBlockers(state.blockers),
        fresh_implementer: refresh,
        implementer_generation: generation,
        implementer_evidence: implementerEvidence,
        ...(refresh
          ? {
              fresh_implementer_evidence: implementerEvidence,
            }
          : {}),
      });
      head = nextHead;
    }

    // Then
    expect(state.status).toBe('local-review');
    expect(state.attempt).toBe(6);
    expect(state.head_sha).toBe('1'.repeat(40));
    expect(state.blocker_ledger).toHaveLength(6);
    expect(
      (state.blocker_ledger as Record<string, unknown>[]).map(
        (entry) => entry.implementer_generation,
      ),
    ).toEqual([1, 1, 2, 2, 3, 3]);
    expect(
      (state.blocker_ledger as Record<string, unknown>[]).every(
        (entry) => entry.remediation_status === 'remediated',
      ),
    ).toBe(true);
    expect(state.blockers).toEqual([]);
    const refreshed = (state.implementer_tasks as Record<string, unknown>[]).filter(
      (receipt) => Number(receipt.generation) > 1,
    );
    expect(state.implementer_tasks).toHaveLength(7);
    expect(refreshed).toHaveLength(5);
    expect(refreshed.map((receipt) => receipt.blocker_ledger_sha256)).toEqual(
      refreshed.map((receipt) => payloadDigest(receipt.blocker_ledger)),
    );
    expect(
      refreshed.map((receipt) =>
        (receipt.unresolved_blockers as Record<string, unknown>[]).length,
      ),
    ).toEqual([1, 1, 1, 1, 1]);
  });

  it('rejects canonical blocker ledger tampering, duplication, and reordering', () => {
    let state = createImplementingState();
    const firstHead = 'a'.repeat(40);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: firstHead,
      verification: 'focused tests passed',
      implementer_generation: 1,
      implementer_evidence: persistImplementerTask(
        state,
        firstHead,
        1,
        'implementation-completed',
      ),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: reviewsFor(firstHead, true),
      review_batch: reviewBatchFor(firstHead, true),
    });
    const secondHead = 'b'.repeat(40);
    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed',
      new_head: secondHead,
      observed_at: observedAfterLegacyBudget,
      verification: 'focused tests passed',
      addressed_blockers: remediatedBlockers(state.blockers),
      fresh_implementer: false,
      implementer_generation: 1,
      implementer_evidence: persistImplementerTask(
        state,
        secondHead,
        1,
        'fix-completed',
      ),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: reviewsFor(secondHead, true),
      review_batch: reviewBatchFor(secondHead, true),
    });
    expect(() => assertIssueSupervisorState(state)).not.toThrow();

    const mutations: ((entry: Record<string, any>) => void)[] = [
      (entry) => { entry.reviewed_head_sha = 'f'.repeat(40); },
      (entry) => { entry.reviewer_receipt.task_id = 'st_forged'; },
      (entry) => { entry.preflight_sha256 = 'f'.repeat(64); },
      (entry) => { entry.approved_contract_source = 'forged source'; },
      (entry) => { entry.reproduction = 'forged reproduction'; },
      (entry) => { entry.blocking_reason = 'security'; },
      (entry) => { entry.blocker.evidence = 'forged blocker'; },
      (entry) => { entry.identity_sha256 = 'f'.repeat(64); },
    ];
    for (const mutate of mutations) {
      const forged = structuredClone(state);
      mutate(forged.blocker_ledger[0]);
      expect(() => assertIssueSupervisorState(forged)).toThrow(/blocker ledger/u);
    }
    const duplicate = structuredClone(state);
    duplicate.blocker_ledger[1] = structuredClone(duplicate.blocker_ledger[0]);
    duplicate.blockers = [];
    expect(() => assertIssueSupervisorState(duplicate)).toThrow(/blocker ledger/u);
    const reordered = structuredClone(state);
    reordered.blocker_ledger.reverse();
    expect(() => assertIssueSupervisorState(reordered)).toThrow(/blocker ledger/u);
  });

  it('rejects caller-authored cumulative ledger transition data', () => {
    const state = createImplementingState();
    expect(() =>
      transitionIssueSupervisor(state, {
        kind: 'local-review',
        blocker_ledger: [{ invented: true }],
        unresolved_blockers: [],
        blocker_ledger_sha256: 'f'.repeat(64),
      }),
    ).toThrow(/caller-authored blocker ledger/u);
  });

  it('terminalizes malformed child provenance at the observed worktree head', () => {
    const observedHead = 'a'.repeat(40);

    const state = transitionIssueSupervisor(createImplementingState(), {
      kind: 'child-contract-error',
      observed_head: observedHead,
      signature: 'implementer-spawn-provenance-invalid',
      evidence:
        'The completed implementer task contained conflicting dispatch authority.',
    });

    expect(state.status).toBe('blocked-child-contract-error');
    expect(state.head_sha).toBe(observedHead);
    expect(state.blockers).toEqual([
      {
        reviewer: 'verification',
        signature: 'implementer-spawn-provenance-invalid',
        evidence:
          'The completed implementer task contained conflicting dispatch authority.',
        fix_back_eligible: false,
        status: 'unresolved',
      },
    ]);
    expect(() => assertIssueSupervisorState(state)).not.toThrow();
  });

  it('parks an explicitly non-fixable blocker for human resolution', () => {
    // Given
    let state = createImplementingState();
    const head = 'a'.repeat(40);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: head,
      verification: 'focused tests passed',
      implementer_generation: 1,
      implementer_evidence: persistImplementerTask(
        state,
        head,
        1,
        'implementation-completed',
      ),
    });

    // When
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: reviewsFor(head, false),
      review_batch: reviewBatchFor(head, false),
    });

    // Then
    const localReview: unknown = state.local_review;
    expect(state.status).toBe('needs-human-check-terminal');
    expect(isRecord(localReview) ? localReview['verdict'] : null).toBe('block');
    expect(state.blockers).toEqual([blocker(false)]);
  });

  it('accepts an adaptive policy in canonical lane-ledger v2', () => {
    // Given
    const fixture = parseRecord(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
      ),
    );
    const ledger = structuredClone(fixture);
    ledger['retry_policy'] = adaptiveRetryPolicy;

    // When / Then
    expect(() => assertContract('lane-ledger-v2', ledger)).not.toThrow();
    expect(() => validateLedger('lane-ledger-v2', ledger)).not.toThrow();
  });

  it('preserves bounded supervisor-full-auto policy compatibility', () => {
    // Given
    const fixture = parseRecord(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
      ),
    );
    const ledger = structuredClone(fixture);
    const boundedFullAutoPolicy = {
      retry_count_is_terminal: false,
      max_same_failure_repeats: 3,
      max_wall_clock_minutes: 180,
      stop_on_child_contract_error: true,
    } as const;
    ledger['merge_policy'] = 'supervisor-full-auto';
    ledger['retry_policy'] = boundedFullAutoPolicy;

    // When / Then
    expect(() => assertContract('lane-ledger-v2', ledger)).not.toThrow();
    expect(() => validateLedger('lane-ledger-v2', ledger)).not.toThrow();
    expect(() =>
      createIssueSupervisor({
        ...identity,
        retry_policy: boundedFullAutoPolicy,
      }),
    ).not.toThrow();
  });

  it.each([
    {
      retry_count_is_terminal: false,
      max_same_failure_repeats: null,
      max_wall_clock_minutes: 180,
      stop_on_child_contract_error: true,
    },
    {
      retry_count_is_terminal: true,
      max_same_failure_repeats: null,
      max_wall_clock_minutes: null,
      stop_on_child_contract_error: true,
    },
  ])('rejects mixed adaptive and bounded policy values', (retryPolicy) => {
    // Given
    const fixture = parseRecord(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
      ),
    );
    const ledger = structuredClone(fixture);
    ledger['retry_policy'] = retryPolicy;

    // When / Then
    expect(() => assertContract('lane-ledger-v2', ledger)).toThrow();
    expect(() => validateLedger('lane-ledger-v2', ledger)).toThrow();
    expect(() =>
      createIssueSupervisor({
        ...identity,
        retry_policy: retryPolicy,
      }),
    ).toThrow();
  });

  it('ships adaptive retry values in valid create-lane plans', () => {
    // Given
    const fixture = parseRecord(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/create-lane-native/valid-native-artifact.json',
      ),
    );
    const plan = fixture['plan'];

    // When / Then
    expect(
      isRecord(plan) ? plan['retry_policy'] : null,
    ).toEqual(adaptiveRetryPolicy);
  });
});
