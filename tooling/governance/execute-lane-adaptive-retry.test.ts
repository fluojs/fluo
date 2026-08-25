import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const { assertContract } = await import(
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

const identity = {
  lane_id: 'lane-adaptive-retry',
  issue_number: 4101,
  branch: 'issue-4101-adaptive-retry',
  worktree: '.worktrees/issue-4101-adaptive-retry',
  starting_head_sha: '0'.repeat(40),
  started_at: startedAt,
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
    let state = createIssueSupervisor(identity);
    let head = 'a'.repeat(40);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: head,
      verification: 'focused tests passed',
    });

    // When
    for (const nextHead of ['b', 'c', 'd', 'e', 'f', '1'].map((value) =>
      value.repeat(40),
    )) {
      state = transitionIssueSupervisor(state, {
        kind: 'local-review',
        reviews: reviewsFor(head, true),
      });
      state = transitionIssueSupervisor(state, {
        kind: 'fix-completed',
        new_head: nextHead,
        observed_at: observedAfterLegacyBudget,
        verification: 'focused tests passed',
        addressed_blockers: remediatedBlockers(state.blockers),
      });
      head = nextHead;
    }

    // Then
    expect(state.status).toBe('local-review');
    expect(state.attempt).toBe(6);
    expect(state.head_sha).toBe('1'.repeat(40));
  });

  it('parks an explicitly non-fixable blocker for human resolution', () => {
    // Given
    let state = createIssueSupervisor(identity);
    const head = 'a'.repeat(40);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: head,
      verification: 'focused tests passed',
    });

    // When
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: reviewsFor(head, false),
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
