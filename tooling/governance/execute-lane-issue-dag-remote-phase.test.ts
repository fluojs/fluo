import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  amendIssueLifecycleDag,
  compileIssueLifecycleDag,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
);

const lane = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'tooling/governance/fixtures/execute-lane-native/ready-ledger-v2.json',
    ),
    'utf8',
  ),
) as Readonly<Record<string, unknown>>;
const issueNumber = 4101;
const oldHead = 'a'.repeat(40);
const upstreamHead = 'b'.repeat(40);
const resolvedHead = 'c'.repeat(40);
const bootstrap = {
  repository_root: process.cwd(),
  starting_head_sha: oldHead,
  issue_contract_sha256: 'd'.repeat(64),
  lane_plan_approval_sha256: 'e'.repeat(64),
};

describe('execute-lane issue DAG remote and conflict phases', () => {
  it('binds PR and CI operator node identities to PR, head, and ordinal', () => {
    const initial = compileIssueLifecycleDag(lane, issueNumber, {
      bootstrap,
    });
    const preflightId = String(initial.nodes[0]?.id);
    const pr = amendIssueLifecycleDag(
      lane,
      issueNumber,
      initial,
      {
        kind: 'pr-sync',
        operation: 'adopt-or-create',
        repository_root: process.cwd(),
        worktree: '.worktrees/issue-4101-runtime',
        head_sha: oldHead,
        pr: null,
      },
      [preflightId],
    );
    const prId = String(pr.nodes.at(-1)?.id);
    const ci = amendIssueLifecycleDag(
      lane,
      issueNumber,
      pr,
      {
        kind: 'ci-observe',
        observation_ordinal: 2,
        repository_root: process.cwd(),
        worktree: '.worktrees/issue-4101-runtime',
        head_sha: oldHead,
        pr: { pr_number: 5101 },
      },
      [prId],
    );

    expect(prId).toBe(`pr-adopt-or-create-pnew-h${oldHead}`);
    expect(ci.nodes.at(-1)).toEqual(
      expect.objectContaining({
        id: `ci-observe-o2-p5101-h${oldHead}`,
        subagent_type: 'fluo-issue-operator',
        dependsOn: [prId],
      }),
    );
  });

  it('uses three append-only conflict waves because resolved head is unknown', () => {
    const initial = compileIssueLifecycleDag(lane, issueNumber, {
      bootstrap,
    });
    const preflightId = String(initial.nodes[0]?.id);
    const implementation = amendIssueLifecycleDag(
      lane,
      issueNumber,
      initial,
      {
        kind: 'conflict-implementation',
        generation: 2,
        repository_root: process.cwd(),
        worktree: '.worktrees/issue-4101-runtime',
        head_sha: oldHead,
        previously_reviewed_head: oldHead,
        upstream_head: upstreamHead,
        preflight_sha256: 'f'.repeat(64),
      },
      [preflightId],
    );
    const implementationId = String(implementation.nodes.at(-1)?.id);
    const gate = amendIssueLifecycleDag(
      lane,
      issueNumber,
      implementation,
      {
        kind: 'conflict-gate',
        generation: 2,
        repository_root: process.cwd(),
        worktree: '.worktrees/issue-4101-runtime',
        head_sha: oldHead,
        previously_reviewed_head: oldHead,
        upstream_head: upstreamHead,
        resolved_head: resolvedHead,
        preflight_sha256: 'f'.repeat(64),
      },
      [implementationId],
    );
    const gateId = String(gate.nodes.at(-1)?.id);
    const review = amendIssueLifecycleDag(
      lane,
      issueNumber,
      gate,
      {
        kind: 'conflict-review',
        generation: 2,
        repository_root: process.cwd(),
        worktree: '.worktrees/issue-4101-runtime',
        head_sha: oldHead,
        previously_reviewed_head: oldHead,
        upstream_head: upstreamHead,
        resolved_head: resolvedHead,
        preflight_sha256: 'f'.repeat(64),
        affected_axes: ['code', 'verification'],
      },
      [gateId],
    );

    expect(implementationId).toBe(
      `conflict-implement-g2-h${oldHead}-u${upstreamHead}`,
    );
    expect(gateId).toBe(
      `conflict-gate-h${resolvedHead}-from${oldHead}-u${upstreamHead}`,
    );
    expect(
      review.nodes.slice(-2).map(
        (node: Readonly<{ id: string }>) => node.id,
      ),
    ).toEqual([
      `conflict-review-code-h${resolvedHead}`,
      `conflict-review-verification-h${resolvedHead}`,
    ]);
    expect(
      review.nodes.slice(-2).every(
        (
          node: Readonly<{
            dependsOn: readonly string[];
          }>,
        ) =>
          node.dependsOn.length === 1 &&
          node.dependsOn[0] === gateId,
      ),
    ).toBe(true);
  });
});
