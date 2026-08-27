import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type DagNode = Readonly<Record<string, unknown>> & {
  id: string;
  dependsOn: readonly string[];
  prompt: string;
};

type DagDefinition = Readonly<{
  key: string;
  name: string;
  nodes: readonly DagNode[];
}>;

type Phase =
  | Readonly<{
      kind: 'preflight-retry';
      retry_generation: number;
      repository_root: string;
      starting_head_sha: string;
      issue_contract_sha256: string;
      lane_plan_approval_sha256: string;
      evidence_paths: readonly string[];
    }>
  | Readonly<{
      kind: 'implementation';
      generation: number;
      head_sha: string;
      preflight_sha256: string;
      blocker_ledger_sha256: string;
      repository_root: string;
      worktree: string;
      parent_session_id: string;
      blocker_ledger: readonly unknown[];
      unresolved_blockers: readonly unknown[];
    }>
  | Readonly<{
      kind: 'review';
      generation: number;
      review_revalidation_generation?: number;
      head_sha: string;
      preflight_sha256: string;
      verification_receipt_id: string;
      repository_root: string;
      worktree: string;
    }>
  | Readonly<{
      kind: 'review-retry';
      generation: number;
      retry_generation: number;
      review_axis: 'contract' | 'code' | 'verification';
      head_sha: string;
      preflight_sha256: string;
      verification_receipt_id: string;
      repository_root: string;
      worktree: string;
    }>;

const { amendIssueLifecycleDag, compileIssueLifecycleDag } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
)) as {
  compileIssueLifecycleDag: (
    lane: Readonly<Record<string, unknown>>,
    issueNumber: number,
    options: Readonly<{
      bootstrap: Readonly<Record<string, unknown>>;
      phases?: readonly Phase[];
    }>,
  ) => DagDefinition;
  amendIssueLifecycleDag: (
    lane: Readonly<Record<string, unknown>>,
    issueNumber: number,
    definition: DagDefinition,
    phase: Phase,
    dependsOn: readonly string[],
  ) => DagDefinition;
};
const { payloadDigest } = await import(
  resolve(
    process.cwd(),
    '.agents/workflow-contracts/contracts.mjs',
  )
);
const { createIssueSupervisor } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor.mjs',
  )
);
const { nextConflictDagPhase, nextIssueDagPhase } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-dag-lifecycle.mjs',
  )
)) as {
  nextIssueDagPhase: (
    snapshot: Readonly<Record<string, unknown>>,
    context?: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>> | null;
  nextConflictDagPhase: (
    snapshot: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
    completedPhaseKeys: readonly string[],
  ) => Readonly<Record<string, unknown>>;
};

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const lane = (): Readonly<Record<string, unknown>> => {
  const value: unknown = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'tooling/governance/fixtures/execute-lane-native/ready-ledger-v2.json',
      ),
      'utf8',
    ),
  );
  if (!isRecord(value)) {
    throw new TypeError('Lane fixture must be an object.');
  }
  return value;
};

const issueNumber = 4101;
const inputHead = 'a'.repeat(40);
const reviewedHead = 'b'.repeat(40);
const preflightSha256 = 'c'.repeat(64);
const blockerLedgerSha256 = payloadDigest([]);
const bootstrap = {
  repository_root: process.cwd(),
  starting_head_sha: inputHead,
  issue_contract_sha256: 'e'.repeat(64),
  lane_plan_approval_sha256: 'f'.repeat(64),
  evidence_paths: ['docs/contracts/testing-guide.md'],
};
const compile = (phases: readonly Phase[] = []) =>
  compileIssueLifecycleDag(lane(), issueNumber, {
    bootstrap,
    phases,
  });

const implementation: Phase = {
  kind: 'implementation',
  generation: 1,
  head_sha: inputHead,
  preflight_sha256: preflightSha256,
  blocker_ledger_sha256: blockerLedgerSha256,
  repository_root: process.cwd(),
  worktree: '.worktrees/issue-4101-runtime',
  parent_session_id: 'ses_parent_v3',
  blocker_ledger: [],
  unresolved_blockers: [],
};

const review: Phase = {
  kind: 'review',
  generation: 1,
  head_sha: reviewedHead,
  preflight_sha256: preflightSha256,
  verification_receipt_id: 'st_parent_verify_4101',
  repository_root: process.cwd(),
  worktree: '.worktrees/issue-4101-runtime',
};

describe('execute-lane issue DAG phase compiler', () => {
  it('enforces conflict implementation, gate, and review ordering', () => {
    // Given
    const upstreamHead = 'd'.repeat(40);
    const resolvedHead = 'e'.repeat(40);
    const snapshot = {
      repository_root: process.cwd(),
      worktree: '.worktrees/issue-4101-runtime',
      head_sha: reviewedHead,
      implementer_generation: 1,
      parent_session_id: 'ses_parent_v3',
      review_preflight: { sha256: preflightSha256 },
    };

    // When / Then
    expect(() =>
      nextConflictDagPhase(
        snapshot,
        {
          stage: 'gate',
          upstream_head: upstreamHead,
          resolved_head: resolvedHead,
        },
        [],
      ),
    ).toThrow(/implementation/u);
    expect(() =>
      nextConflictDagPhase(
        snapshot,
        {
          stage: 'review',
          upstream_head: upstreamHead,
          resolved_head: resolvedHead,
          affected_axes: ['verification'],
          verification_receipt_id: 'st_parent_verify_4101',
        },
        [
          `conflict-implementation:g1:${reviewedHead}:${upstreamHead}`,
        ],
      ),
    ).toThrow(/gate/u);
  });

  it('adds only the parent-authorized implementation wave', () => {
    // Given
    const initial = compile();

    // When
    const definition = compile([implementation]);

    // Then
    expect(definition.nodes.slice(0, initial.nodes.length)).toEqual(
      initial.nodes,
    );
    expect(definition.nodes.at(-1)).toEqual(
      expect.objectContaining({
        id: `implement-g1-${inputHead}`,
        subagent_type: 'fluo-issue-implementer',
        dependsOn: [`preflight-g0-h${inputHead}`],
      }),
    );
    expect(definition.nodes.at(-1)?.prompt).toContain(inputHead);
    expect(definition.nodes.at(-1)?.prompt).toContain(preflightSha256);
    expect(definition.nodes.at(-1)?.prompt).toContain(blockerLedgerSha256);
  });

  it('adds three independent exact-head reviewers after implementation', () => {
    // When
    const definition = compile([
      implementation,
      review,
    ]);
    const reviewers = definition.nodes.filter((node) =>
      node.id.startsWith('review-'),
    );

    // Then
    expect(reviewers.map((node) => node.id)).toEqual([
      `review-contract-${reviewedHead}`,
      `review-code-${reviewedHead}`,
      `review-verification-${reviewedHead}`,
    ]);
    expect(
      reviewers.every((node) =>
        node.dependsOn.includes(`implement-g1-${inputHead}`),
      ),
    ).toBe(true);
    expect(
      reviewers.every(
        (node) =>
          typeof node.subagent_type === 'string' &&
          node.category === undefined &&
          node.prompt.includes(reviewedHead),
      ),
    ).toBe(true);
    expect(reviewers.at(-1)?.prompt).toContain('st_parent_verify_4101');
  });

  it('appends fresh reviewer identities after legacy receipt migration', () => {
    // Given
    const definition = compile([
      implementation,
      review,
    ]);
    const revalidation = {
      ...review,
      review_revalidation_generation: 1,
    };

    // When
    const amended = amendIssueLifecycleDag(
      lane(),
      issueNumber,
      definition,
      revalidation,
      definition.nodes.slice(-3).map((node) => node.id),
    );

    // Then
    expect(amended.nodes.slice(-3).map((node) => node.id)).toEqual([
      `review-contract-revalidation-g1-${reviewedHead}`,
      `review-code-revalidation-g1-${reviewedHead}`,
      `review-verification-revalidation-g1-${reviewedHead}`,
    ]);
  });

  it('rejects a review wave without a verified implementation wave', () => {
    expect(() =>
      compile([review]),
    ).toThrow(/implementation/u);
  });

  it('appends one uniquely identified reviewer retry node', () => {
    // Given
    const definition = compile([
      implementation,
      review,
    ]);
    const retry = {
      ...review,
      kind: 'review-retry' as const,
      retry_generation: 1,
      review_axis: 'verification' as const,
    };

    // When
    const amended = amendIssueLifecycleDag(
      lane(),
      issueNumber,
      definition,
      retry,
      definition.nodes.slice(-3).map((node) => node.id),
    );

    // Then
    expect(amended.nodes.at(-1)).toEqual(
      expect.objectContaining({
        id: `review-verification-retry-g1-${reviewedHead}`,
        subagent_type: 'fluo-verification-reviewer',
        dependsOn: definition.nodes.slice(-3).map((node) => node.id),
      }),
    );
  });

  it('appends a fresh immutable preflight retry node', () => {
    // Given
    const definition = compile();
    const retry = {
      kind: 'preflight-retry' as const,
      retry_generation: 1,
      ...bootstrap,
    };

    // When
    const amended = amendIssueLifecycleDag(
      lane(),
      issueNumber,
      definition,
      retry,
      [definition.nodes[0].id],
    );

    // Then
    expect(amended.nodes).toHaveLength(2);
    expect(amended.nodes.at(-1)).toEqual(
      expect.objectContaining({
        id: `preflight-g1-h${inputHead}`,
        subagent_type: 'fluo-issue-preflight',
        dependsOn: [`preflight-g0-h${inputHead}`],
      }),
    );
  });

  it('plans preflight recovery as a fresh generation', () => {
    // Given
    const snapshot = createIssueSupervisor({
      lane_id: 'lane-4101-runtime',
      issue_number: issueNumber,
      branch: 'issue-4101-runtime',
      worktree: '.worktrees/issue-4101-runtime',
      starting_head_sha: inputHead,
      started_at: '2026-08-27T00:00:00.000Z',
      repository_root: process.cwd(),
      parent_session_id: 'ses_parent_v3',
      issue_contract_revision: 'issue-4101@1',
      issue_contract_sha256: bootstrap.issue_contract_sha256,
      lane_plan_approval_sha256: bootstrap.lane_plan_approval_sha256,
      review_policy: 'preflight-v1',
      release_handoff: false,
      authority_scope: {
        pr_creation: true,
        pr_merge: true,
        cleanup_command_worktrees: true,
      },
      retry_policy: {
        retry_count_is_terminal: true,
        max_same_failure_repeats: 3,
        max_wall_clock_minutes: 180,
        stop_on_child_contract_error: true,
      },
    });

    // When
    const phase = nextIssueDagPhase(snapshot, {
      phase_context: {
        stage: 'preflight-retry',
        retry_generation: 1,
        bootstrap,
      },
    });

    // Then
    expect(phase).toEqual({
      kind: 'preflight-retry',
      retry_generation: 1,
      ...bootstrap,
    });
  });

  it('binds the full head rather than a display prefix', () => {
    // Given
    const sharedPrefix = '123456789abc';
    const firstHead = `${sharedPrefix}${'1'.repeat(28)}`;
    const secondHead = `${sharedPrefix}${'2'.repeat(28)}`;

    // When
    const first = compile([
      { ...implementation, head_sha: firstHead },
    ]);
    const second = compile([
      { ...implementation, head_sha: secondHead },
    ]);

    // Then
    expect(first).not.toEqual(second);
    expect(first.nodes.at(-1)?.prompt).toContain(firstHead);
    expect(second.nodes.at(-1)?.prompt).toContain(secondHead);
  });
});
