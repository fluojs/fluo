import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// allow: SIZE_OK — integrated legacy supervisor lifecycle regression matrix.
type DagNode = Readonly<{
  id: string;
  category: string;
  dependsOn: readonly string[];
  load_skills: readonly string[];
  prompt: string;
}>;
type DagDefinition = Readonly<{
  key: string;
  name: string;
  nodes: readonly DagNode[];
}>;
type DagBinding = Readonly<{
  version: number;
  lane_id: string;
  dag_key: string;
  run_id: string;
  definition_sha256: string;
  dispatch_event_hash: string;
  status: string;
}>;
type SupervisorState = Readonly<{
  lane_id: string;
  issue_number: number;
  head_sha: string;
  status: string;
  blockers: readonly Blocker[];
  pr: null | Readonly<Record<string, unknown>>;
  ci: null | Readonly<Record<string, unknown>>;
  local_review: null | {
    verdict: string;
    head_sha: string;
    reviewers: Readonly<Record<string, string>>;
  };
}>;

const {
  createIssueSupervisor,
  transitionIssueSupervisor,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor.mjs',
  )
)) as {
  createIssueSupervisor: (identity: unknown) => SupervisorState;
  transitionIssueSupervisor: (
    state: SupervisorState,
    transition: unknown,
  ) => SupervisorState;
};
const { compileLaneSupervisorDag } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/compile-dag.mjs',
  )
)) as {
  compileLaneSupervisorDag: (ledger: unknown) => DagDefinition;
};
const {
  assertDagBindingMatches,
  createDagBinding,
  loadDagBinding,
  persistDagBinding,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dag-binding.mjs',
  )
)) as {
  assertDagBindingMatches: (
    binding: DagBinding,
    expected: {
      definition: DagDefinition;
      lane_id: string;
      run_id: string;
      dispatch_event_hash: string;
    },
  ) => void;
  createDagBinding: (input: {
    definition: DagDefinition;
    lane_id: string;
    run_id: string;
    dispatch_event_hash: string;
  }) => DagBinding;
  loadDagBinding: (runtimeRoot: string, laneId: string) => DagBinding | null;
  persistDagBinding: (runtimeRoot: string, binding: DagBinding) => void;
};
const {
  applyIssueSupervisorTransition,
  initialiseIssueSupervisorStore,
  loadIssueSupervisorStore,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/issue-supervisor-store.mjs',
  )
)) as {
  applyIssueSupervisorTransition: (
    runtimeRoot: string,
    laneId: string,
    issueNumber: number,
    transition: unknown,
  ) => {
    snapshot: SupervisorState;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  };
  initialiseIssueSupervisorStore: (
    runtimeRoot: string,
    identity: unknown,
  ) => {
    snapshot: SupervisorState;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  };
  loadIssueSupervisorStore: (
    runtimeRoot: string,
    laneId: string,
    issueNumber: number,
  ) => {
    snapshot: SupervisorState;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  } | null;
};
const { importSupervisorTerminal } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/supervisor-terminal.mjs',
  )
)) as {
  importSupervisorTerminal: (
    persisted: {
      snapshot: unknown;
      events: readonly unknown[];
      receipts: readonly unknown[];
    },
    supervisorBundle: {
      snapshot: SupervisorState;
      events: readonly Readonly<Record<string, unknown>>[];
      receipts: readonly Readonly<Record<string, unknown>>[];
    },
    liveCompletion?: Readonly<Record<string, unknown>> | null,
    releaseHandoffContext?: {
      receipt: Readonly<Record<string, unknown>>;
      artifact: Readonly<Record<string, unknown>>;
      artifact_path: string;
    } | null,
  ) => {
    snapshot: Readonly<Record<string, unknown>>;
    events: readonly unknown[];
    receipts: readonly unknown[];
  };
};

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const headC = 'c'.repeat(40);
const observedAt = '2026-08-25T00:00:00.000Z';

type Blocker = Readonly<{
  reviewer: string;
  signature: string;
  evidence: string;
  fix_back_eligible: boolean;
  status: string;
}>;

const remediate = (blockers: readonly Blocker[]) =>
  blockers.map((blocker) => ({
    reviewer: blocker.reviewer,
    signature: blocker.signature,
    evidence: blocker.evidence,
    fix_back_eligible: blocker.fix_back_eligible,
    status: 'remediated',
  }));

const persistedLifecycle = (
  identityValue: unknown,
  transitions: readonly unknown[],
) => {
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), 'fluo-terminal-bundle-'),
  );
  const runtimeRoot = join(directory, 'lane-runs');
  try {
    let bundle = initialiseIssueSupervisorStore(runtimeRoot, identityValue);
    for (const transition of transitions) {
      bundle = applyIssueSupervisorTransition(
        runtimeRoot,
        bundle.snapshot.lane_id,
        bundle.snapshot.issue_number,
        transition,
      );
    }
    return bundle;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const identity = {
  lane_id: 'lane-4101-runtime',
  issue_number: 4101,
  branch: 'issue-4101-runtime',
  worktree: '.worktrees/issue-4101-runtime',
  starting_head_sha: '0'.repeat(40),
  started_at: observedAt,
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
} as const;

const observationBase = (head: string) => ({
  authority: 'issue-supervisor',
  lane_id: identity.lane_id,
  issue_number: identity.issue_number,
  branch: identity.branch,
  worktree: identity.worktree,
  head_sha: head,
  observed_at: observedAt,
});

const prReceipt = (
  kind: 'pr-adopt' | 'pr-create' | 'pr-update',
  head: string,
) => ({
  ...observationBase(head),
  kind,
  pr_number: 5101,
  pr_url: 'https://github.com/fluojs/fluo/pull/5101',
  remote_head_sha: head,
  pr_head_sha: head,
  ...(kind === 'pr-adopt'
    ? { pr_head_ref_name: identity.branch, pr_state: 'OPEN' }
    : {}),
});

const passReviews = (head: string) =>
  ['contract', 'code', 'verification'].map((reviewer) => ({
    reviewer,
    reviewed_head_sha: head,
    verdict_signal: 'PASS',
    blockers: [],
  }));

describe('execute-lane issue supervisor lifecycle', () => {
  it('rejects non-canonical issue branch and worktree identity', () => {
    expect(() =>
      createIssueSupervisor({
        ...identity,
        branch: '../../main',
        worktree: '.worktrees/../../main',
      }),
    ).toThrow(/canonical issue branch/u);
    expect(() =>
      createIssueSupervisor({
        ...identity,
        branch: 'issue-99-wrong',
        worktree: '.worktrees/issue-99-wrong',
      }),
    ).toThrow(/canonical issue branch/u);
  });

  it('requires a same-head local triad before becoming ready for PR', () => {
    let state = createIssueSupervisor(identity);

    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'pnpm test --filter runtime passed',
    });
    expect(state.status).toBe('local-review');

    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: [
        passReviews(headA)[0],
        {
          reviewer: 'code',
          reviewed_head_sha: headA,
          verdict_signal: 'BLOCK',
          blockers: [
            {
              reviewer: 'code',
              signature: 'runtime:worker:abort-path',
              evidence: 'packages/runtime/src/worker.ts:42',
              fix_back_eligible: true,
              status: 'unresolved',
            },
          ],
        },
        passReviews(headA)[2],
      ],
    });
    expect(state.status).toBe('implementing');

    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed',
      new_head: headB,
      observed_at: observedAt,
      verification: 'pnpm test --filter runtime passed',
      addressed_blockers: remediate(state.blockers as readonly Blocker[]),
    });
    expect(state.status).toBe('local-review');

    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: passReviews(headB),
    });

    expect(state.status).toBe('ready-for-pr');
    expect(state.local_review).toMatchObject({
      verdict: 'ready-for-pr',
      head_sha: headB,
      reviewers: {
        contract: 'PASS',
        code: 'PASS',
        verification: 'PASS',
      },
    });
  });

  it('returns a failed PR check through local fix-back before merge', () => {
    let state = createIssueSupervisor(identity);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'pnpm test --filter runtime passed',
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: passReviews(headA),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'pr-observed',
      action: 'create',
      receipt: prReceipt('pr-create', headA),
    });
    expect(state.status).toBe('ci-pending');

    state = transitionIssueSupervisor(state, {
      kind: 'ci-observed',
      receipt: {
        ...observationBase(headA),
        kind: 'ci',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        result: 'fixable-failure',
        evidence: 'runtime test failed on the reviewed head',
      },
    });
    expect(state.status).toBe('ci-fix-back');

    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed',
      new_head: headB,
      observed_at: observedAt,
      verification: 'pnpm test --filter runtime passed',
      addressed_blockers: remediate(state.blockers as readonly Blocker[]),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: passReviews(headB),
    });
    expect(state.status).toBe('ready-for-push');

    state = transitionIssueSupervisor(state, {
      kind: 'pr-observed',
      action: 'update',
      receipt: prReceipt('pr-update', headB),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'ci-observed',
      receipt: {
        ...observationBase(headB),
        kind: 'ci',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        result: 'pass',
        evidence: 'all required checks passed',
      },
    });
    expect(state.status).toBe('merge-ready');

    state = transitionIssueSupervisor(state, {
      kind: 'merge-observed',
      receipt: {
        ...observationBase(headB),
        kind: 'merge',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        reviewed_head_sha: headB,
        remote_head_sha: headB,
        pr_head_sha: headB,
        ci_head_sha: headB,
        merge_method: 'squash',
        pr_state: 'MERGED',
        issue_state: 'CLOSED',
        merge_commit_sha: 'c'.repeat(40),
      },
    });
    state = transitionIssueSupervisor(state, {
      kind: 'cleanup-observed',
      receipt: {
        ...observationBase(headB),
        kind: 'cleanup',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      },
    });

    expect(state.status).toBe('done');
  });

  it('returns a merge-conflicting PR through fix-back before waiting for CI', () => {
    // Given
    const transitions = [
      {
        kind: 'implementation-completed',
        new_head: headA,
        verification: 'pnpm test --filter runtime passed',
      },
      {
        kind: 'local-review',
        reviews: passReviews(headA),
      },
      {
        kind: 'pr-observed',
        action: 'create',
        receipt: prReceipt('pr-create', headA),
      },
      {
        kind: 'pr-conflict-observed',
        receipt: {
          ...observationBase(headA),
          kind: 'pr-conflict',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          remote_head_sha: headA,
          pr_head_sha: headA,
          pr_mergeable: 'CONFLICTING',
          pr_merge_state_status: 'DIRTY',
          evidence: 'mergeable=CONFLICTING mergeStateStatus=DIRTY',
        },
      },
    ];

    // When
    const persisted = persistedLifecycle(identity, transitions);

    // Then
    expect(persisted.snapshot.status).toBe('ci-fix-back');
    expect(persisted.snapshot.ci).toBeNull();
    expect(persisted.snapshot.blockers).toEqual([
      {
        reviewer: 'verification',
        signature: 'pr:merge-conflict',
        evidence: 'mergeable=CONFLICTING mergeStateStatus=DIRTY',
        fix_back_eligible: true,
        status: 'unresolved',
      },
    ]);
    expect(persisted.receipts).toContainEqual(
      expect.objectContaining({
        kind: 'pr-conflict',
        pr_mergeable: 'CONFLICTING',
        pr_merge_state_status: 'DIRTY',
      }),
    );
  });

  it('adopts an existing open PR after a same-head local triad', () => {
    const transitions = [
      {
        kind: 'implementation-completed',
        new_head: headA,
        verification: 'pnpm test --filter runtime passed',
      },
      {
        kind: 'local-review',
        reviews: passReviews(headA),
      },
      {
        kind: 'pr-observed',
        action: 'adopt',
        receipt: prReceipt('pr-adopt', headA),
      },
    ];
    let state = createIssueSupervisor(identity);
    for (const transition of transitions) {
      state = transitionIssueSupervisor(state, transition);
    }

    expect(state.status).toBe('ci-pending');
    expect(state.pr).toMatchObject({
      number: 5101,
      url: 'https://github.com/fluojs/fluo/pull/5101',
      receipt: {
        kind: 'pr-adopt',
        head_sha: headA,
        pr_head_ref_name: identity.branch,
        pr_state: 'OPEN',
      },
    });

    const persisted = persistedLifecycle(identity, transitions);
    expect(persisted.snapshot).toEqual(state);
    expect(persisted.receipts).toEqual([
      expect.objectContaining({
        kind: 'pr-adopt',
        pr_number: 5101,
        pr_state: 'OPEN',
      }),
    ]);
  });

  it('rejects adoption of a closed or mismatched-branch PR', () => {
    let state = createIssueSupervisor(identity);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'pnpm test --filter runtime passed',
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: passReviews(headA),
    });

    expect(() =>
      transitionIssueSupervisor(state, {
        kind: 'pr-observed',
        action: 'adopt',
        receipt: {
          ...prReceipt('pr-adopt', headA),
          pr_state: 'CLOSED',
        },
      }),
    ).toThrow(/adopted PR must be OPEN/u);

    expect(() =>
      transitionIssueSupervisor(state, {
        kind: 'pr-observed',
        action: 'adopt',
        receipt: {
          ...prReceipt('pr-adopt', headA),
          pr_head_ref_name: 'issue-4102-runtime',
        },
      }),
    ).toThrow(/adopted PR must match the supervisor branch/u);
  });

  it('rejects forged adopted-PR snapshots and missing receipts on reload', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-adopted-pr-forgery-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    try {
      let bundle = initialiseIssueSupervisorStore(runtimeRoot, identity);
      for (const transition of [
        {
          kind: 'implementation-completed',
          new_head: headA,
          verification: 'pnpm test --filter runtime passed',
        },
        {
          kind: 'local-review',
          reviews: passReviews(headA),
        },
        {
          kind: 'pr-observed',
          action: 'adopt',
          receipt: prReceipt('pr-adopt', headA),
        },
      ]) {
        bundle = applyIssueSupervisorTransition(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
          transition,
        );
      }
      const issuePath = resolve(
        runtimeRoot,
        identity.lane_id,
        'issues',
        String(identity.issue_number),
      );
      const snapshotPath = resolve(issuePath, 'snapshot.json');
      const receiptsPath = resolve(issuePath, 'receipts.json');
      const snapshotText = `${JSON.stringify(bundle.snapshot, null, 2)}\n`;

      writeFileSync(
        snapshotPath,
        snapshotText.replace('"pr_state": "OPEN"', '"pr_state": "CLOSED"'),
        'utf8',
      );
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).toThrow(/adopted PR must be OPEN/u);

      writeFileSync(snapshotPath, snapshotText, 'utf8');
      writeFileSync(receiptsPath, '[]\n', 'utf8');
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).toThrow(/state-bound receipt/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on forged state, missing authority, and exhausted retries', () => {
    let state = createIssueSupervisor({
      ...identity,
      authority_scope: {
        ...identity.authority_scope,
        pr_creation: false,
      },
      retry_policy: {
        ...identity.retry_policy,
        max_same_failure_repeats: 1,
      },
    });
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'focused tests passed',
    });
    const blockingReviews = [
      passReviews(headA)[0],
      {
        reviewer: 'code',
        reviewed_head_sha: headA,
        verdict_signal: 'BLOCK',
        blockers: [
          {
            reviewer: 'code',
            signature: 'runtime:worker:abort-path',
            evidence: 'packages/runtime/src/worker.ts:42',
            fix_back_eligible: true,
            status: 'unresolved',
          },
        ],
      },
      passReviews(headA)[2],
    ];
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: blockingReviews,
    });
    expect(() =>
      transitionIssueSupervisor(state, {
        kind: 'implementation-completed',
        new_head: headB,
        verification: 'bypass attempt',
      }),
    ).toThrow(/fix-completed/u);

    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed',
      new_head: headB,
      observed_at: observedAt,
      verification: 'focused tests passed',
      addressed_blockers: remediate(state.blockers as readonly Blocker[]),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: blockingReviews.map((review) => ({
        ...review,
        reviewed_head_sha: headB,
      })),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed',
      new_head: headC,
      observed_at: observedAt,
      verification: 'focused tests passed',
      addressed_blockers: remediate(state.blockers as readonly Blocker[]),
    });
    expect(state.status).toBe('blocked-budget-exhausted');

    let ready = createIssueSupervisor({
      ...identity,
      authority_scope: {
        ...identity.authority_scope,
        pr_creation: false,
      },
    });
    ready = transitionIssueSupervisor(ready, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'focused tests passed',
    });
    ready = transitionIssueSupervisor(ready, {
      kind: 'local-review',
      reviews: passReviews(headA),
    });
    expect(() =>
      transitionIssueSupervisor(ready, {
        kind: 'pr-observed',
        action: 'create',
        receipt: prReceipt('pr-create', headA),
      }),
    ).toThrow(/pr_creation/u);

    expect(() =>
      transitionIssueSupervisor(
        {
          ...ready,
          status: 'merge-ready',
          pr: null,
          ci: null,
        },
        {
          kind: 'merge-observed',
          receipt: {
            ...observationBase(headA),
            kind: 'merge',
            pr_number: 5101,
            pr_url: 'https://github.com/fluojs/fluo/pull/5101',
            reviewed_head_sha: headA,
            remote_head_sha: headA,
            pr_head_sha: headA,
            ci_head_sha: headA,
            merge_method: 'squash',
            pr_state: 'MERGED',
            issue_state: 'CLOSED',
            merge_commit_sha: headC,
          },
        },
      ),
    ).toThrow(/state invariant/u);
  });

  it('persists each supervisor transition and target-bound receipt', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-issue-supervisor-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    try {
      let stored = initialiseIssueSupervisorStore(runtimeRoot, identity);
      expect(stored.events).toHaveLength(1);
      const leasePath = resolve(
        runtimeRoot,
        identity.lane_id,
        'issues',
        String(identity.issue_number),
        'lease.lock',
      );
      writeFileSync(leasePath, 'held\n', { encoding: 'utf8', flag: 'wx' });
      expect(() =>
        applyIssueSupervisorTransition(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
          {
            kind: 'implementation-completed',
            new_head: headA,
            verification: 'focused tests passed',
          },
        ),
      ).toThrow(/lease is already held/u);
      unlinkSync(leasePath);
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          '../../4102' as unknown as number,
        ),
      ).toThrow(/positive integer/u);
      stored = applyIssueSupervisorTransition(
        runtimeRoot,
        identity.lane_id,
        identity.issue_number,
        {
          kind: 'implementation-completed',
          new_head: headA,
          verification: 'focused tests passed',
        },
      );
      stored = applyIssueSupervisorTransition(
        runtimeRoot,
        identity.lane_id,
        identity.issue_number,
        {
          kind: 'local-review',
          reviews: passReviews(headA),
        },
      );
      stored = applyIssueSupervisorTransition(
        runtimeRoot,
        identity.lane_id,
        identity.issue_number,
        {
          kind: 'pr-observed',
          action: 'create',
          receipt: prReceipt('pr-create', headA),
        },
      );

      expect(stored.snapshot.status).toBe('ci-pending');
      expect(stored.events).toHaveLength(4);
      expect(stored.receipts).toEqual([prReceipt('pr-create', headA)]);
      expect(
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).toEqual(stored);
      expect(() =>
        initialiseIssueSupervisorStore(runtimeRoot, {
          ...identity,
          starting_head_sha: headB,
        }),
      ).toThrow(/identity conflict/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('imports only terminal supervisor evidence into the shared lane', () => {
    let state = createIssueSupervisor(identity);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'focused tests passed',
    });
    state = transitionIssueSupervisor(state, {
      kind: 'local-review',
      reviews: passReviews(headA),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'pr-observed',
      action: 'create',
      receipt: prReceipt('pr-create', headA),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'ci-observed',
      receipt: {
        ...observationBase(headA),
        kind: 'ci',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        result: 'pass',
        evidence: 'all required checks passed',
      },
    });
    state = transitionIssueSupervisor(state, {
      kind: 'merge-observed',
      receipt: {
        ...observationBase(headA),
        kind: 'merge',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        reviewed_head_sha: headA,
        remote_head_sha: headA,
        pr_head_sha: headA,
        ci_head_sha: headA,
        merge_method: 'squash',
        pr_state: 'MERGED',
        issue_state: 'CLOSED',
        merge_commit_sha: headC,
      },
    });
    state = transitionIssueSupervisor(state, {
      kind: 'cleanup-observed',
      receipt: {
        ...observationBase(headA),
        kind: 'cleanup',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      },
    });
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
        ),
        'utf8',
      ),
    );

    const ciReceipt = {
      ...observationBase(headA),
      kind: 'ci',
      pr_number: 5101,
      pr_url: 'https://github.com/fluojs/fluo/pull/5101',
      result: 'pass',
      evidence: 'all required checks passed',
    };
    const mergeReceipt = {
      ...observationBase(headA),
      kind: 'merge',
      pr_number: 5101,
      pr_url: 'https://github.com/fluojs/fluo/pull/5101',
      reviewed_head_sha: headA,
      remote_head_sha: headA,
      pr_head_sha: headA,
      ci_head_sha: headA,
      merge_method: 'squash',
      pr_state: 'MERGED',
      issue_state: 'CLOSED',
      merge_commit_sha: headC,
    };
    const cleanupReceipt = {
      ...observationBase(headA),
      kind: 'cleanup',
      pr_number: 5101,
      pr_url: 'https://github.com/fluojs/fluo/pull/5101',
      worktree_removed: true,
      local_branch_deleted: true,
      remote_branch_deleted: true,
    };
    const terminalBundle = persistedLifecycle(identity, [
        {
          kind: 'implementation-completed',
          new_head: headA,
          verification: 'focused tests passed',
        },
        { kind: 'local-review', reviews: passReviews(headA) },
        {
          kind: 'pr-observed',
          action: 'create',
          receipt: prReceipt('pr-create', headA),
        },
        { kind: 'ci-observed', receipt: ciReceipt },
        { kind: 'merge-observed', receipt: mergeReceipt },
        { kind: 'cleanup-observed', receipt: cleanupReceipt },
      ]);
    const liveCompletion = {
        issue_number: identity.issue_number,
        issue_url: `https://github.com/fluojs/fluo/issues/${String(identity.issue_number)}`,
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        branch: identity.branch,
        worktree: identity.worktree,
        reviewed_head_sha: headA,
        remote_head_sha: headA,
        pr_head_sha: headA,
        ci_head_sha: headA,
        merge_commit_sha: headC,
        merge_method: 'squash',
        pr_state: 'MERGED',
        issue_state: 'CLOSED',
        cleanup_status: 'done',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      };
    const imported = importSupervisorTerminal(
      { snapshot: ledger, events: [], receipts: [] },
      terminalBundle,
      liveCompletion,
    );
    expect(imported.snapshot.completed_issues).toEqual([4101]);
    expect(imported.snapshot.issue_progress).toMatchObject({
      '4101': {
        status: 'done',
        reviewed_head: headA,
        merge_commit: headC,
        checks: 'PASS',
      },
    });
    expect(imported.snapshot.lanes).toMatchObject([
      { status: 'queued', current_issue: 4102 },
    ]);
    expect(imported.receipts).toHaveLength(4);
    expect(
      importSupervisorTerminal(imported, terminalBundle, liveCompletion),
    ).toEqual(imported);
  });

  it('imports blocked and release-handoff supervisor terminals', () => {
    const blocker = {
      reviewer: 'code',
      signature: 'runtime:worker:abort-path',
      evidence: 'packages/runtime/src/worker.ts:42',
      fix_back_eligible: true,
      status: 'unresolved',
    };
    const blockedBundle = () =>
      persistedLifecycle(identity, [
        {
          kind: 'implementation-completed',
          new_head: headA,
          verification: 'focused tests passed',
        },
        {
          kind: 'local-review',
          reviews: [
            passReviews(headA)[0],
            {
              reviewer: 'code',
              reviewed_head_sha: headA,
              verdict_signal: 'BLOCK',
              blockers: [blocker],
            },
            passReviews(headA)[2],
          ],
        },
        {
          kind: 'fix-completed',
          new_head: headB,
          observed_at: observedAt,
          verification: 'focused tests passed',
          addressed_blockers: remediate([blocker]),
        },
        {
          kind: 'local-review',
          reviews: [
            passReviews(headB)[0],
            {
              reviewer: 'code',
              reviewed_head_sha: headB,
              verdict_signal: 'NEEDS-HUMAN-CHECK',
              blockers: [],
            },
            passReviews(headB)[2],
          ],
        },
      ]);
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
        ),
        'utf8',
      ),
    );
    const blockedImport = importSupervisorTerminal(
      { snapshot: ledger, events: [], receipts: [] },
      blockedBundle(),
    );
    expect(blockedImport.snapshot.lanes).toMatchObject([
      { status: 'needs-human-check-terminal', retry_count: 1 },
    ]);
    expect(blockedImport.snapshot.issue_progress).toMatchObject({
      '4101': {
        status: 'needs-human-check-terminal',
        retry_count: 1,
      },
    });
    expect(
      importSupervisorTerminal(
        blockedImport,
        blockedBundle(),
      ),
    ).toEqual(blockedImport);

    const releaseLedger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-release-v2.json',
        ),
        'utf8',
      ),
    );
    const releaseIssue = releaseLedger.confirmed_issues[0];
    const releaseIdentity = {
      lane_id: releaseLedger.lane_id,
      issue_number: releaseIssue,
      branch: `issue-${String(releaseIssue)}-release-handoff`,
      worktree: `.worktrees/issue-${String(releaseIssue)}-release-handoff`,
      starting_head_sha: headA,
      started_at: observedAt,
      authority_scope: {
        pr_creation: releaseLedger.authority_scope.pr_creation,
        pr_merge: releaseLedger.authority_scope.pr_merge,
        cleanup_command_worktrees:
          releaseLedger.authority_scope.cleanup_command_worktrees,
      },
      retry_policy: {
        retry_count_is_terminal:
          releaseLedger.retry_policy.retry_count_is_terminal,
        max_same_failure_repeats:
          releaseLedger.retry_policy.max_same_failure_repeats,
        max_wall_clock_minutes:
          releaseLedger.retry_policy.max_wall_clock_minutes,
        stop_on_child_contract_error:
          releaseLedger.retry_policy.stop_on_child_contract_error,
      },
      lane_plan_approval_sha256: releaseLedger.lane_plan_approval_sha256,
      release_handoff: true,
    };
    let release = createIssueSupervisor(releaseIdentity);
    release = transitionIssueSupervisor(release, {
      kind: 'release-handoff',
      approval_sha256: releaseLedger.lane_plan_approval_sha256,
    });
    const releaseImport = importSupervisorTerminal(
      { snapshot: releaseLedger, events: [], receipts: [] },
      persistedLifecycle(releaseIdentity, [
        {
          kind: 'release-handoff',
          approval_sha256: releaseLedger.lane_plan_approval_sha256,
        },
      ]),
      null,
      {
        receipt: JSON.parse(
          readFileSync(
            resolve(
              process.cwd(),
              'tooling/governance/fixtures/execute-lane-native/release-handoff-approval.json',
            ),
            'utf8',
          ),
        ),
        artifact: JSON.parse(
          readFileSync(
            resolve(
              process.cwd(),
              'tooling/governance/fixtures/execute-lane-native/search-native-release.json',
            ),
            'utf8',
          ),
        ),
        artifact_path: releaseLedger.source.search_ledger,
      },
    );
    expect(releaseImport.snapshot.lanes).toMatchObject([
      { status: 'blocked-maintainer-decision' },
    ]);
    expect(
      importSupervisorTerminal(
        releaseImport,
        persistedLifecycle(releaseIdentity, [
          {
            kind: 'release-handoff',
            approval_sha256: releaseLedger.lane_plan_approval_sha256,
          },
        ]),
        null,
        {
          receipt: JSON.parse(
            readFileSync(
              resolve(
                process.cwd(),
                'tooling/governance/fixtures/execute-lane-native/release-handoff-approval.json',
              ),
              'utf8',
            ),
          ),
          artifact: JSON.parse(
            readFileSync(
              resolve(
                process.cwd(),
                'tooling/governance/fixtures/execute-lane-native/search-native-release.json',
              ),
              'utf8',
            ),
          ),
          artifact_path: releaseLedger.source.search_ledger,
        },
      ),
    ).toEqual(releaseImport);
  });

  it('compiles issue dependencies and persists one idempotent DAG binding', () => {
    const ledger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json',
        ),
        'utf8',
      ),
    );
    const definition = compileLaneSupervisorDag(ledger);

    expect(definition.key).toBe('fluo:lane:lane-4101-runtime:issue-supervisors:v2');
    expect(definition.nodes).toHaveLength(2);
    expect(definition.nodes[0]).toMatchObject({
      id: 'issue-4101-supervisor',
      dependsOn: [],
      load_skills: ['execute-lane'],
    });
    expect(definition.nodes[1]).toMatchObject({
      id: 'issue-4102-supervisor',
      dependsOn: ['issue-4101-supervisor'],
      load_skills: ['execute-lane'],
    });
    expect(definition.nodes[0].prompt).toContain('STOP WHEN:');
    expect(() =>
      compileLaneSupervisorDag({
        ...ledger,
        dependency_graph: { 4102: [9999] },
      }),
    ).toThrow(/dependency|confirmed issue/u);
    expect(() =>
      compileLaneSupervisorDag({
        ...ledger,
        dependency_graph: { 4101: [4102], 4102: [4101] },
      }),
    ).toThrow(/cycle|dependency/u);
    const releaseLedger = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tooling/governance/fixtures/execute-lane-native/ready-ledger-release-v2.json',
        ),
        'utf8',
      ),
    );
    const releaseDefinition = compileLaneSupervisorDag(releaseLedger);
    expect(releaseDefinition.nodes).toHaveLength(1);
    expect(releaseDefinition.nodes[0]).toMatchObject({
      category: 'quick',
      dependsOn: [],
    });
    expect(releaseDefinition.nodes[0].prompt).toContain(
      'blocked-maintainer-decision',
    );

    const binding = createDagBinding({
      definition,
      lane_id: ledger.lane_id,
      run_id: 'run_lane_4101',
      dispatch_event_hash: 'c'.repeat(64),
    });
    expect(binding.version).toBe(3);
    expect(() =>
      createDagBinding({
        definition: { ...definition, key: 'fluo:lane:other:issue-supervisors:v2' },
        lane_id: ledger.lane_id,
        run_id: 'run_lane_4101',
        dispatch_event_hash: 'c'.repeat(64),
      }),
    ).toThrow(/canonical for its lane/u);
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-dag-binding-'),
    );
    const runtimeRoot = join(directory, 'lane-runs');
    try {
      persistDagBinding(runtimeRoot, binding);
      persistDagBinding(runtimeRoot, binding);
      expect(loadDagBinding(runtimeRoot, binding.lane_id)).toEqual(binding);
      expect(() =>
        assertDagBindingMatches(binding, {
          definition,
          lane_id: binding.lane_id,
          run_id: binding.run_id,
          dispatch_event_hash: binding.dispatch_event_hash,
        }),
      ).not.toThrow();
      expect(() =>
        assertDagBindingMatches(binding, {
          definition: { ...definition, name: 'tampered definition' },
          lane_id: binding.lane_id,
          run_id: binding.run_id,
          dispatch_event_hash: binding.dispatch_event_hash,
        }),
      ).toThrow(/definition digest/u);
      expect(() =>
        persistDagBinding(runtimeRoot, {
          ...binding,
          run_id: 'run_substituted',
        }),
      ).toThrow(/conflicts with the persisted run/u);

      const redirectedRoot = join(directory, 'redirected-root');
      const outside = join(directory, 'outside');
      mkdirSync(outside);
      symlinkSync(outside, redirectedRoot);
      expect(() =>
        persistDagBinding(redirectedRoot, {
          ...binding,
          lane_id: 'lane-symlink',
          dag_key: 'fluo:lane:lane-symlink:issue-supervisors:v2',
        }),
      ).toThrow(/real directory/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
