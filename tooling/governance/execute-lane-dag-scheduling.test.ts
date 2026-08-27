import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type DagNode = Readonly<{
  id: string;
  dependsOn: readonly string[];
  prompt: string;
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

const { compileIssueLifecycleDag } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
)) as {
  compileIssueLifecycleDag: (
    ledger: Readonly<Record<string, unknown>>,
    issueNumber: number,
    options: Readonly<Record<string, unknown>>,
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
const bootstrap = {
  repository_root: process.cwd(),
  starting_head_sha: headA,
  issue_contract_sha256: 'b'.repeat(64),
  lane_plan_approval_sha256: 'c'.repeat(64),
  evidence_paths: ['docs/contracts/testing-guide.md'],
};

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

  it('compiles one issue into one lifecycle DAG', () => {
    // Given
    const ledger = readyLedger();

    // When
    const definition = compileIssueLifecycleDag(ledger, 4101, {
      bootstrap,
    });

    // Then
    expect(definition.key).toBe(
      'fluo:lane:lane-4101-runtime:issue-4101:lifecycle:v3',
    );
    expect(definition.nodes).toEqual([
      expect.objectContaining({
        id: `preflight-g0-h${headA}`,
        subagent_type: 'fluo-issue-preflight',
        dependsOn: [],
      }),
    ]);
    expect(JSON.stringify(definition)).not.toContain('issue-4102');
    expect(JSON.stringify(definition)).not.toContain('fluo-issue-supervisor');
    expect(definition.nodes[0]?.prompt).toContain('Do not call bash or eval.');
    expect(definition.nodes[0]?.prompt).toContain(
      'Only read and task-local todo are available.',
    );
    expect(
      compileIssueLifecycleDag(ledger, 4101, { bootstrap }),
    ).toEqual(definition);
  });

  it('rejects a preflight without parent-bound evidence paths', () => {
    const { evidence_paths: _evidencePaths, ...missingEvidence } = bootstrap;
    expect(() =>
      compileIssueLifecycleDag(readyLedger(), 4101, {
        bootstrap: missingEvidence,
      }),
    ).toThrow(/evidence paths/u);
  });

  it('keeps cross-issue queue ordering outside native DAG edges', () => {
    // Given
    const ledger = {
      ...readyLedger(),
      dependency_graph: { '4101': [], '4102': [] },
      lanes: [
        {
          name: 'runtime',
          queue: [4101, 4102],
          current_issue: 4101,
          status: 'queued',
          branch: null,
          worktree: null,
          pr: null,
          retry_count: 0,
        },
      ],
    };

    // When
    const first = compileIssueLifecycleDag(ledger, 4101, { bootstrap });
    const second = compileIssueLifecycleDag(ledger, 4102, { bootstrap });

    // Then
    expect(first.nodes[0]?.dependsOn).toEqual([]);
    expect(second.nodes[0]?.dependsOn).toEqual([]);
    expect(first.key).not.toBe(second.key);
  });
});
