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
      head_sha: string;
      preflight_sha256: string;
      repository_root: string;
      worktree: string;
    }>;

const { compileIssueLifecycleDag } = (await import(
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
};
const { payloadDigest } = await import(
  resolve(
    process.cwd(),
    '.agents/workflow-contracts/contracts.mjs',
  )
);

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
  repository_root: process.cwd(),
  worktree: '.worktrees/issue-4101-runtime',
};

describe('execute-lane issue DAG phase compiler', () => {
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
  });

  it('rejects a review wave without a verified implementation wave', () => {
    expect(() =>
      compile([review]),
    ).toThrow(/implementation/u);
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
