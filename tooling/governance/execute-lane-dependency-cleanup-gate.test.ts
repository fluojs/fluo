import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  dependencyGate,
  dispatchableIssueNumbers,
  terminalizeBlockedDependents,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dependency-gate.mjs',
  )
)) as {
  dependencyGate: (
    ledger: Readonly<Record<string, unknown>>,
    issueNumber: number,
  ) => Readonly<Record<string, unknown>>;
  dispatchableIssueNumbers: (
    ledger: Readonly<Record<string, unknown>>,
  ) => readonly number[];
  terminalizeBlockedDependents: (
    persisted: {
      snapshot: Readonly<Record<string, unknown>>;
      events: readonly Readonly<Record<string, unknown>>[];
      receipts: readonly Readonly<Record<string, unknown>>[];
    },
    observations: readonly Readonly<Record<string, unknown>>[],
  ) => {
    snapshot: Readonly<Record<string, unknown>>;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  };
};
const { unmetDependencies } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/lane-progression.mjs',
  )
)) as {
  unmetDependencies: (
    scenario: Readonly<Record<string, unknown>>,
    ledger: Readonly<Record<string, unknown>>,
    identity: Readonly<{ issue_number: number }>,
  ) => readonly number[];
};

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergedPredecessorLedger = (): Readonly<Record<string, unknown>> => {
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
  const head = 'a'.repeat(40);
  return {
    ...parsed,
    status: 'running',
    execution: {
      status: 'running',
      last_command: '$execute-lane lane-4101-runtime',
      last_updated: '2026-08-25T00:00:00.000Z',
    },
    completed_issues: [4101],
    issue_progress: {
      '4101': {
        status: 'merged',
        branch: 'issue-4101-runtime',
        worktree: '.worktrees/issue-4101-runtime',
        pr: 'https://github.com/fluojs/fluo/pull/5101',
        head_sha: head,
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
        reviewed_head: head,
        commits: [head],
        merge_commit: 'b'.repeat(40),
        issue_state: 'CLOSED',
      },
    },
    lanes: [
      {
        name: 'runtime',
        queue: [4101],
        current_issue: 4101,
        status: 'merged',
        branch: 'issue-4101-runtime',
        worktree: '.worktrees/issue-4101-runtime',
        pr: 'https://github.com/fluojs/fluo/pull/5101',
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
    dependency_graph: {
      '4101': [],
      '4102': [4101],
    },
  };
};

const blockedPredecessorLedger = (): Readonly<Record<string, unknown>> => {
  const ledger = mergedPredecessorLedger();
  return {
    ...ledger,
    completed_issues: [],
    issue_progress: {
      '4101': {
        status: 'needs-human-check-terminal',
        branch: 'issue-4101-runtime',
        worktree: '.worktrees/issue-4101-runtime',
        pr: null,
        head_sha: 'a'.repeat(40),
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
  };
};

describe('execute-lane dependency cleanup gate', () => {
  it('does not unlock from merge or CLOSED observation before cleanup', () => {
    // Given
    const ledger = mergedPredecessorLedger();
    const scenario = {
      dependency_observations: [{ issue_number: 4101, status: 'CLOSED' }],
    };

    // When
    const gate = dependencyGate(ledger, 4102);

    // Then
    expect(gate).toMatchObject({
      status: 'waiting',
      unsatisfied_dependencies: [4101],
    });
    expect(dispatchableIssueNumbers(ledger)).toEqual([]);
    expect(
      unmetDependencies(scenario, ledger, { issue_number: 4102 }),
    ).toEqual([4101]);
  });

  it('terminalizes an unreachable dependent without dispatch artifacts', () => {
    // Given
    const persisted = {
      snapshot: blockedPredecessorLedger(),
      events: [],
      receipts: [],
    };
    const observation = {
      issue_number: 4102,
      issue_store_absent: true,
      local_branch_absent: true,
      remote_branch_absent: true,
      worktree_absent: true,
      task_absent: true,
      pr_absent: true,
      observed_at: '2026-08-25T00:00:00.000Z',
    };

    // When / Then
    expect(() => terminalizeBlockedDependents(persisted, [])).toThrow(
      /artifact absence observation/u,
    );
    const terminal = terminalizeBlockedDependents(persisted, [observation]);

    expect(terminal.snapshot).toMatchObject({
      status: 'blocked-terminal',
      issue_progress: {
        '4102': {
          status: 'blocked-terminal',
          retry_count: 0,
        },
      },
      lanes: [
        { status: 'needs-human-check-terminal' },
        {
          current_issue: null,
          status: 'blocked-terminal',
          branch: null,
          worktree: null,
          pr: null,
        },
      ],
    });
    expect(terminal.events).toEqual([
      expect.objectContaining({
        event_type: 'dependency.blocked',
        subject_id: '4102',
        payload: expect.objectContaining({ artifact_absence: observation }),
      }),
    ]);
    expect(
      terminalizeBlockedDependents(terminal, [observation]),
    ).toEqual(terminal);
  });

  it('terminalizes absent descendants after their shared lane is already blocked', () => {
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
        ),
        'utf8',
      ),
    );
    Object.assign(ledger, {
      status: 'blocked-child-contract-error',
      execution: {
        status: 'blocked-child-contract-error',
        last_command: '$execute-lane lane-4101-runtime',
        last_updated: '2026-08-25T00:00:00.000Z',
      },
      root_main_sync: {
        status: 'blocked-terminal',
        sha: null,
      },
      issue_progress: {
        '4101': {
          status: 'blocked-child-contract-error',
          branch: 'issue-4101-runtime',
          worktree: '.worktrees/issue-4101-runtime',
          pr: null,
          head_sha: 'a'.repeat(40),
          verification: 'child contract failed',
          retry_count: 0,
          blockers: [],
        },
      },
      lanes: [
        {
          name: 'runtime',
          queue: [4101, 4102],
          current_issue: null,
          status: 'blocked-child-contract-error',
          branch: null,
          worktree: null,
          pr: null,
          retry_count: 0,
          current_blocker: {
            signature: 'child-contract-error',
            evidence: 'invalid child output or transition evidence',
          },
        },
      ],
    });
    const observation = {
      issue_number: 4102,
      issue_store_absent: true,
      local_branch_absent: true,
      remote_branch_absent: true,
      worktree_absent: true,
      task_absent: true,
      pr_absent: true,
      observed_at: '2026-08-25T00:00:00.000Z',
    };

    const terminal = terminalizeBlockedDependents(
      { snapshot: ledger, events: [], receipts: [] },
      [observation],
    );

    expect(terminal.snapshot.issue_progress).toMatchObject({
      '4102': {
        status: 'blocked-terminal',
        retry_count: 0,
      },
    });
    expect(terminal.snapshot.lanes).toMatchObject([
      {
        status: 'blocked-child-contract-error',
        current_issue: null,
      },
    ]);
    expect(terminal.events).toEqual([
      expect.objectContaining({
        event_type: 'dependency.blocked',
        subject_id: '4102',
      }),
    ]);
  });
});
