import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type DagNode = Readonly<{
  id: string;
  dependsOn: readonly string[];
}>;

type DagDefinition = Readonly<{
  key: string;
  name: string;
  nodes: readonly DagNode[];
}>;

type DependencyGate = Readonly<{
  status: 'ready' | 'waiting' | 'blocked';
  dependencies: readonly number[];
  unsatisfied_dependencies: readonly number[];
}>;

const { compileIssueSupervisorDag } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
)) as {
  compileIssueSupervisorDag: (
    ledger: Readonly<Record<string, unknown>>,
    issueNumber: number,
  ) => DagDefinition;
};
const { dependencyGate, dispatchableIssueNumbers } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dependency-gate.mjs',
  )
)) as {
  dependencyGate: (
    ledger: Readonly<Record<string, unknown>>,
    issueNumber: number,
  ) => DependencyGate;
  dispatchableIssueNumbers: (
    ledger: Readonly<Record<string, unknown>>,
  ) => readonly number[];
};

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readyLedger = (): Readonly<Record<string, unknown>> => {
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
    throw new TypeError('Ready lane fixture must be an object.');
  }
  return {
    ...parsed,
    dependency_graph: {
      '4101': [],
      '4102': [4101],
    },
  };
};

const completedPredecessorLedger = (): Readonly<
  Record<string, unknown>
> => ({
  ...readyLedger(),
  status: 'running',
  execution: {
    status: 'running',
    last_command: '$execute-lane lane-4101-runtime',
    last_updated: '2026-08-25T00:00:00.000Z',
  },
  completed_issues: [4101],
  issue_progress: {
    '4101': {
      status: 'done',
      branch: 'issue-4101-runtime',
      worktree: '.worktrees/issue-4101-runtime',
      pr: 'https://github.com/fluojs/fluo/pull/5101',
      head_sha: headA,
      verification: 'all required checks passed',
      retry_count: 0,
      blockers: [],
      review_verdict: 'merge',
      checks: 'PASS',
      reviewers: {
        contract: 'PASS',
        code: 'PASS',
        verification: 'PASS',
      },
      reviewed_head: headA,
      commits: [headA],
      merge_commit: headB,
      issue_state: 'CLOSED',
      cleanup: {
        status: 'done',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      },
    },
  },
  lanes: [
    {
      name: 'runtime',
      queue: [4101],
      current_issue: null,
      status: 'done',
      branch: null,
      worktree: null,
      pr: null,
      retry_count: 0,
    },
    {
      name: 'validation',
      queue: [4102],
      current_issue: 4102,
      status: 'queued',
      branch: null,
      worktree: null,
      pr: null,
      retry_count: 0,
    },
  ],
});

const blockedPredecessorLedger = (): Readonly<Record<string, unknown>> => ({
  ...readyLedger(),
  status: 'running',
  execution: {
    status: 'running',
    last_command: '$execute-lane lane-4101-runtime',
    last_updated: '2026-08-25T00:00:00.000Z',
  },
  issue_progress: {
    '4101': {
      status: 'needs-human-check-terminal',
      branch: 'issue-4101-runtime',
      worktree: '.worktrees/issue-4101-runtime',
      pr: null,
      head_sha: headA,
      verification: 'human review required',
      retry_count: 0,
      blockers: [],
    },
  },
  lanes: [
    {
      name: 'runtime',
      queue: [4101],
      current_issue: null,
      status: 'needs-human-check-terminal',
      branch: null,
      worktree: null,
      pr: null,
      retry_count: 0,
    },
    {
      name: 'validation',
      queue: [4102],
      current_issue: 4102,
      status: 'queued',
      branch: null,
      worktree: null,
      pr: null,
      retry_count: 0,
    },
  ],
});

describe('execute-lane DAG dependency scheduling', () => {
  it('dispatches independent lane cursors concurrently', () => {
    // Given
    const ledger = {
      ...readyLedger(),
      dependency_graph: { '4101': [], '4102': [] },
    };

    // When / Then
    expect(dispatchableIssueNumbers(ledger)).toEqual([4101, 4102]);
  });

  it('dispatches only issues whose dependencies are fully done', () => {
    // Given
    const ledger = readyLedger();

    // When
    const issues = dispatchableIssueNumbers(ledger);

    // Then
    expect(issues).toEqual([4101]);
  });

  it('blocks a dependent when its predecessor terminates blocked', () => {
    // Given
    const ledger = blockedPredecessorLedger();

    // When
    const gate = dependencyGate(ledger, 4102);

    // Then
    expect(gate).toEqual({
      status: 'blocked',
      dependencies: [4101],
      unsatisfied_dependencies: [4101],
    });
    expect(dispatchableIssueNumbers(ledger)).toEqual([]);
  });

  it('compiles one dependency-free node after its predecessor is done', () => {
    // Given
    const ledger = completedPredecessorLedger();

    // When
    const definition = compileIssueSupervisorDag(ledger, 4102);

    // Then
    expect(dispatchableIssueNumbers(ledger)).toEqual([4102]);
    expect(definition.key).toBe(
      'fluo:lane:lane-4101-runtime:issue-4102:supervisor:v2',
    );
    expect(definition.nodes).toEqual([
      expect.objectContaining({
        id: 'issue-4102-supervisor',
        dependsOn: [],
      }),
    ]);
    expect(compileIssueSupervisorDag(ledger, 4102)).toEqual(definition);
  });
});
