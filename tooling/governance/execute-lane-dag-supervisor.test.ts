import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const senpiFinal = (sentinel: string, payload: unknown) =>
  `<${sentinel}>${JSON.stringify(payload)}</${sentinel}>`;

// allow: SIZE_OK — integrated v2 issue lifecycle regression matrix.
type SupervisorState = Readonly<{
  version: 2;
  lane_id: string;
  issue_number: number;
  issue_contract_revision: string;
  issue_contract_sha256: string;
  lane_plan_approval_sha256: string;
  repository_root: string;
  head_sha: string;
  branch: string;
  worktree: string;
  status: string;
  authority_scope: Readonly<{
    cleanup_command_worktrees: boolean;
  }>;
  blockers: readonly Blocker[];
  blocker_ledger: readonly Readonly<Record<string, unknown>>[];
  blocked_heads_since_refresh: number;
  implementer_generation: number;
  implementer_tasks: readonly Readonly<Record<string, unknown>>[];
  pr: null | Readonly<Record<string, unknown>>;
  ci: null | Readonly<Record<string, unknown>>;
  review_preflight: null | Readonly<Record<string, unknown>>;
  local_review: null | {
    verdict: string;
    head_sha: string;
    reviewers: Readonly<Record<string, string>>;
  };
}>;

const { payloadDigest } = await import(
  resolve(
    process.cwd(),
    '.agents/workflow-contracts/contracts.mjs',
  )
);

const {
  createIssueSupervisor: createSupervisorV2,
  transitionIssueSupervisor: transitionSupervisorV2,
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
const { prepareCanonicalV2Runtime } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/v2-canonical-runtime.mjs',
  )
);
const { computeConflictGitEvidence } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/trusted-evidence.mjs',
  )
);
const {
  writeActualShapedConflictImplementerTask,
  writeActualShapedImplementerTask,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/implementer-task.mjs',
  )
);
const { writeActualShapedReviewerTask } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/fixtures/reviewer-task.mjs',
  )
);
const { createReviewPreflight } = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/review-loop-policy.mjs',
  )
)) as {
  createReviewPreflight: (input: unknown) => Readonly<Record<string, unknown>>;
};
const {
  conflictReviewerPromptSentinel,
  conflictReviewerTaskName,
  reviewerPromptSentinel,
} = (await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/reviewer-runtime.mjs',
  )
)) as {
  conflictReviewerPromptSentinel: (input: unknown) => string;
  conflictReviewerTaskName: (issueNumber: number, headSha: string) => string;
  reviewerPromptSentinel: (input: unknown) => string;
};
const {
  applyIssueSupervisorTransition: applyIssueSupervisorTransitionRaw,
  initialiseIssueSupervisorStore: initialiseIssueSupervisorStoreRaw,
  loadIssueSupervisorStore: loadIssueSupervisorStoreRaw,
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
    options?: unknown,
  ) => {
    snapshot: SupervisorState;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  };
  initialiseIssueSupervisorStore: (
    runtimeRoot: string,
    identity: unknown,
    options?: unknown,
  ) => {
    snapshot: SupervisorState;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  };
  loadIssueSupervisorStore: (
    runtimeRoot: string,
    laneId: string,
    issueNumber: number,
    options?: unknown,
  ) => {
    snapshot: SupervisorState;
    events: readonly Readonly<Record<string, unknown>>[];
    receipts: readonly Readonly<Record<string, unknown>>[];
  } | null;
};
const storeRunners = new Map<string, any>();
const initialiseIssueSupervisorStore = (runtimeRoot: string, value: unknown) =>
  initialiseIssueSupervisorStoreRaw(runtimeRoot, value, { command_runner: storeRunners.get(runtimeRoot) });
const applyIssueSupervisorTransition = (runtimeRoot: string, lane: string, issue: number, value: unknown) =>
  applyIssueSupervisorTransitionRaw(runtimeRoot, lane, issue, value, { command_runner: storeRunners.get(runtimeRoot) });
const loadIssueSupervisorStore = (runtimeRoot: string, lane: string, issue: number) =>
  loadIssueSupervisorStoreRaw(runtimeRoot, lane, issue, { command_runner: storeRunners.get(runtimeRoot) });

const { importSupervisorTerminal: importSupervisorTerminalRaw } = (await import(
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
    trustedOptions?: unknown,
  ) => {
    snapshot: Readonly<Record<string, unknown>>;
    events: readonly unknown[];
    receipts: readonly unknown[];
  };
};
const importSupervisorTerminal = (
  persisted: any,
  supervisorBundle: any,
  liveCompletion: any = null,
  releaseHandoffContext: any = null,
) => {
  const repositoryRoot = supervisorBundle.snapshot.repository_root;
  const runtimeRoot = resolve(repositoryRoot, '.omo', 'lane-runs');
  return importSupervisorTerminalRaw(
    persisted,
    supervisorBundle,
    liveCompletion,
    releaseHandoffContext,
    { repository_root: repositoryRoot, command_runner: storeRunners.get(runtimeRoot) },
  );
};

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const headC = 'c'.repeat(40);
const observedAt = '2026-08-25T00:00:00.000Z';
const governanceRepositoryRoot = realpathSync(
  mkdtempSync(join(tmpdir(), 'fluo-governance-reviewers-')),
);
const terminalFixtureRoots: string[] = [];
afterAll(() => {
  rmSync(governanceRepositoryRoot, { force: true, recursive: true });
  for (const root of terminalFixtureRoots) rmSync(root, { force: true, recursive: true });
});

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

const v2Identity = (identityValue: unknown) => {
  if (
    typeof identityValue !== 'object' ||
    identityValue === null ||
    Array.isArray(identityValue)
  ) {
    return identityValue;
  }
  return {
    ...identityValue,
    review_policy: 'preflight-v1',
    repository_root:
      (identityValue as Readonly<Record<string, unknown>>).repository_root ??
      governanceRepositoryRoot,
    parent_session_id: 'ses-governance-parent',
    issue_contract_revision:
      (identityValue as Readonly<Record<string, unknown>>)
        .issue_contract_revision ?? 'governance-fixture@1',
    issue_contract_sha256:
      (identityValue as Readonly<Record<string, unknown>>)
        .issue_contract_sha256 ?? '1'.repeat(64),
    lane_plan_approval_sha256:
      (identityValue as Readonly<Record<string, unknown>>)
        .lane_plan_approval_sha256 ?? '2'.repeat(64),
  };
};

const preflightFor = (state: SupervisorState) => {
  const authority = (state as SupervisorState & {
    preflight_authority?: {
      canonical_sources: readonly Readonly<Record<string, unknown>>[];
      canonical_acceptance_ids: readonly string[];
      canonical_acceptance_criteria: readonly Readonly<Record<string, string>>[];
    };
  }).preflight_authority;
  const sources = authority?.canonical_sources ?? [{
    source: 'governance acceptance source',
    revision: 'governance-fixture@1',
    content_sha256: '3'.repeat(64),
  }];
  const acceptanceIds = authority?.canonical_acceptance_ids ?? ['governance-acceptance'];
  const acceptanceCriteria = authority?.canonical_acceptance_criteria ?? [{
    id: 'governance-acceptance',
    content: 'The governed issue lifecycle preserves its tested behavior.',
    content_sha256: createHash('sha256').update(JSON.stringify({ content: 'The governed issue lifecycle preserves its tested behavior.' })).digest('hex'),
  }];
  return createReviewPreflight({
    version: 1,
    lane_id: state.lane_id,
    issue_number: state.issue_number,
    issue_contract_revision: state.issue_contract_revision,
    issue_contract_sha256: state.issue_contract_sha256,
    lane_plan_approval_sha256: state.lane_plan_approval_sha256,
    head_sha: state.head_sha,
    generated_at: observedAt,
    approved_sources: sources,
    acceptance_row_ids: acceptanceIds,
    rows: acceptanceIds.map((id, index) => ({
        id,
        acceptance_text: acceptanceCriteria[index].content,
        acceptance_sha256: acceptanceCriteria[index].content_sha256,
        source: String(sources.at(-1)?.source),
        source_bindings: sources,
        invariant: 'The governed issue lifecycle preserves its tested behavior.',
        surfaces: ['issue-supervisor'],
        positive_cases: ['The expected lifecycle transition succeeds.'],
        negative_cases: ['Invalid evidence is rejected.'],
        boundary_cases: ['The exact reviewed head remains authoritative.'],
      })),
    nonfunctional: {
      complexity: 'State transitions remain bounded.',
      memory: 'Evidence remains issue-local.',
      atomicity: 'Each transition is persisted atomically.',
      mutation_boundary: 'Only the issue supervisor state is mutated.',
    },
  });
};

const reviewBatchFor = (
  state: SupervisorState,
  reviews: readonly Readonly<Record<string, unknown>>[],
) => {
  const coverage: Record<string, Record<string, string>> = {};
  const blockerSources: Record<string, Readonly<Record<string, string>>> = {};
  const rowIds = (state.review_preflight?.acceptance_row_ids as readonly string[] | undefined) ?? ['governance-acceptance'];
  for (const review of reviews) {
    const reviewer = String(review.reviewer);
    coverage[reviewer] = Object.fromEntries(
      rowIds.map((rowId) => [rowId, review.verdict_signal === 'BLOCK' ? 'BLOCK' : 'PASS']),
    );
    const blockers = Array.isArray(review.blockers) ? review.blockers : [];
    for (const candidate of blockers) {
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        Array.isArray(candidate)
      ) {
        continue;
      }
      const blocker = candidate as Readonly<Record<string, unknown>>;
      blockerSources[String(blocker.signature)] = {
        contract_source: String(
          (
            state.review_preflight?.rows as
              | readonly Readonly<Record<string, unknown>>[]
              | undefined
          )?.[0]?.source ?? 'governance acceptance source',
        ),
        violated_invariant: rowIds[0],
        reproduction: String(blocker.evidence),
        why_blocking: 'correctness',
      };
    }
  }
  const preflight = state.review_preflight;
  if (preflight === null) {
    throw new TypeError('v2 governance review requires a persisted preflight.');
  }
  const task_ids = {
      contract: `st_governance_contract_${state.head_sha.slice(0, 8)}`,
      code: `st_governance_code_${state.head_sha.slice(0, 8)}`,
      verification: `st_governance_verification_${state.head_sha.slice(0, 8)}`,
    };
  const reviewer_receipts = Object.fromEntries(Object.entries(task_ids).map(([axis, task_id]) => {
    const dagRunId = `dag_issue-${String(state.issue_number)}`;
    const dagKey =
      `fluo:lane:${state.lane_id}:issue-${String(state.issue_number)}:lifecycle:v3`;
    const nodeId = `review-${axis}-${state.head_sha}`;
    const canonicalVerificationReceiptId =
      `st_parent_verify_${state.head_sha.slice(0, 12)}`;
    const ownerFingerprint = createHash('sha256')
      .update(nodeId)
      .digest('hex');
    const result = reviews.find((review) => review.reviewer === axis);
    const blockers = Array.isArray(result?.blockers) ? result.blockers : [];
    const final_response = {
      sentinel: 'fluo:execute-lane:review:final:v1', axis,
      head_sha: state.head_sha, preflight_sha256: preflight.sha256,
      verdict_signal: result?.verdict_signal,
      coverage: coverage[axis], blockers,
      blocker_sources: Object.fromEntries(blockers.map((blocker) => [String((blocker as Record<string, unknown>).signature), blockerSources[String((blocker as Record<string, unknown>).signature)] ])),
    };
    const task = {
      task_id,
      status: 'completed',
      agent_type: `fluo-${axis === 'verification' ? 'verification' : axis}-reviewer`,
      parent_session_id: 'ses-governance-parent',
      name: nodeId,
      owner: {
        kind: 'dag',
        runId: dagRunId,
        nodeId,
        fingerprint: ownerFingerprint,
      },
      final_response: senpiFinal(
        'fluo:execute-lane:review:final:v1',
        final_response,
      ),
      spawn_spec: {
        cwd: state.repository_root,
        prompt:
          `Review without mutation.\n${reviewerPromptSentinel({
            repository_root: state.repository_root,
            lane_id: state.lane_id,
            issue_number: state.issue_number,
            worktree: state.worktree,
            head_sha: state.head_sha,
            preflight_sha256: preflight.sha256,
            review_axis: axis,
            ...(axis === 'verification'
              ? {
                  canonical_verification_receipt_id:
                    canonicalVerificationReceiptId,
                }
              : {}),
            dag_key: dagKey,
            node_id: nodeId,
          })}`,
      },
    };
    const receipt = writeActualShapedReviewerTask({
      task,
      repository_root: state.repository_root,
      expected: {
        task_id,
        parent_session_id: 'ses-governance-parent',
        lane_id: state.lane_id,
        issue_number: state.issue_number,
        worktree: state.worktree,
        branch: state.branch,
        head_sha: state.head_sha,
        preflight_sha256: preflight.sha256,
        axis,
        ...(axis === 'verification'
          ? {
              canonical_verification_receipt_id:
                canonicalVerificationReceiptId,
            }
          : {}),
        dag_run_id: dagRunId,
        dag_key: dagKey,
        node_id: nodeId,
        dag_owner_fingerprint: ownerFingerprint,
      },
    });
    return [axis, receipt];
  }));
  return {
    preflight_sha256: preflight.sha256,
    task_ids,
    coverage,
    reviewer_receipts,
    blocker_sources: blockerSources,
  };
};

const normalizeTransition = (
  state: SupervisorState,
  transitionValue: unknown,
) => {
  if (
    typeof transitionValue !== 'object' ||
    transitionValue === null ||
    Array.isArray(transitionValue)
  ) {
    return transitionValue;
  }
  const transition = transitionValue as Readonly<Record<string, unknown>>;
  if (transition.kind === 'implementation-completed') {
    const taskId = `st_implement${String(state.issue_number)}${String(transition.new_head).slice(0, 8)}`;
    const dagRunId = `dag_issue-${String(state.issue_number)}`;
    const dagKey =
      `fluo:lane:${state.lane_id}:issue-${String(state.issue_number)}:lifecycle:v3`;
    const nodeId = `implement-g1-${state.head_sha}`;
    const ownerFingerprint = createHash('sha256')
      .update(nodeId)
      .digest('hex');
    writeActualShapedImplementerTask({
      repository_root: state.repository_root,
      task_id: taskId,
      parent_session_id: 'ses-governance-parent',
      lane_id: state.lane_id,
      issue_number: state.issue_number,
      worktree: state.worktree,
      current_head: state.head_sha,
      new_head: transition.new_head,
      generation: 1,
      result: 'implementation-completed',
      verification: transition.verification,
      preflight_sha256: String(state.review_preflight?.sha256),
      authoritative_preflight: state.review_preflight,
      dag_run_id: dagRunId,
      dag_key: dagKey,
      node_id: nodeId,
      dag_owner_fingerprint: ownerFingerprint,
    });
    return {
      ...transition,
      implementer_generation: 1,
      implementer_evidence: {
        task_id: taskId,
        dag_run_id: dagRunId,
        dag_node_id: nodeId,
        dag_owner_fingerprint: ownerFingerprint,
      },
    };
  }
  if (transition.kind === 'fix-completed') {
    const taskId = `st_fix${String(state.issue_number)}${String(transition.new_head).slice(0, 8)}`;
    const generation = Number(transition.implementer_generation ?? state.implementer_generation);
    const freshImplementer = transition.fresh_implementer === true;
    const dagRunId = `dag_issue-${String(state.issue_number)}`;
    const dagKey =
      `fluo:lane:${state.lane_id}:issue-${String(state.issue_number)}:lifecycle:v3`;
    const nodeId = `implement-g${String(generation)}-${state.head_sha}`;
    const ownerFingerprint = createHash('sha256')
      .update(nodeId)
      .digest('hex');
    writeActualShapedImplementerTask({
      repository_root: state.repository_root,
      task_id: taskId,
      parent_session_id: 'ses-governance-parent',
      lane_id: state.lane_id,
      issue_number: state.issue_number,
      worktree: state.worktree,
      current_head: state.head_sha,
      new_head: transition.new_head,
      generation,
      result: 'fix-completed',
      verification: transition.verification,
      addressed_blockers: transition.addressed_blockers,
      blocker_ledger: state.blocker_ledger,
      unresolved_blockers: state.blocker_ledger.filter(
        (entry) => entry.remediation_status === 'unresolved',
      ),
      preflight_sha256: String(state.review_preflight?.sha256),
      authoritative_preflight: state.review_preflight,
      dag_run_id: dagRunId,
      dag_key: dagKey,
      node_id: nodeId,
      dag_owner_fingerprint: ownerFingerprint,
    });
    return {
      ...transition,
      fresh_implementer: freshImplementer,
      implementer_generation: generation,
      implementer_evidence: {
        task_id: taskId,
        dag_run_id: dagRunId,
        dag_node_id: nodeId,
        dag_owner_fingerprint: ownerFingerprint,
      },
      ...(freshImplementer
        ? {
            fresh_implementer_evidence: {
              task_id: taskId,
              dag_run_id: dagRunId,
              dag_node_id: nodeId,
              dag_owner_fingerprint: ownerFingerprint,
            },
          }
        : {}),
    };
  }
  if (transition.kind === 'local-review') {
    const reviews = Array.isArray(transition.reviews)
      ? (transition.reviews as readonly Readonly<Record<string, unknown>>[])
      : [];
    return {
      ...transition,
      review_batch: reviewBatchFor(state, reviews),
    };
  }
  return transition;
};

const createIssueSupervisor = (identityValue: unknown) => {
  const initial = createSupervisorV2(v2Identity(identityValue));
  return transitionSupervisorV2(initial, {
    kind: 'preflight-completed',
    preflight: preflightFor(initial),
  });
};

const transitionIssueSupervisor = (
  state: SupervisorState,
  transition: unknown,
) => transitionSupervisorV2(state, normalizeTransition(state, transition));

const persistSupervisorStore = (runtimeRoot: string, identityValue: unknown) => {
  if (
    typeof identityValue !== 'object' ||
    identityValue === null ||
    Array.isArray(identityValue)
  ) {
    throw new TypeError('persisted supervisor fixture identity is invalid.');
  }
  const identityRecord = identityValue as Readonly<Record<string, unknown>>;
  const repositoryRoot = resolve(runtimeRoot, '..', '..');
  const canonicalFixture = prepareCanonicalV2Runtime({
    repository_root: repositoryRoot,
    lane_id: String(identityRecord.lane_id),
    issue_numbers: [Number(identityRecord.issue_number)],
    authority_scope: identityRecord.authority_scope,
    retry_policy: identityRecord.retry_policy,
    release_handoffs:
      identityRecord.release_handoff === true
        ? [Number(identityRecord.issue_number)]
        : [],
  });
  storeRunners.set(runtimeRoot, canonicalFixture.commandRunner);
  mkdirSync(resolve(repositoryRoot, String(identityRecord.worktree)), { recursive: true });
  const canonicalFixtureIdentity = v2Identity({
    ...identityRecord,
    repository_root: repositoryRoot,
  }) as Readonly<Record<string, unknown>>;
  const {
    issue_contract_revision: _issueContractRevision,
    issue_contract_sha256: _issueContractSha256,
    lane_plan_approval_sha256: _lanePlanApprovalSha256,
    ...storeIdentity
  } = canonicalFixtureIdentity;
  const initial = initialiseIssueSupervisorStore(runtimeRoot, storeIdentity);
  const bundle = applyIssueSupervisorTransition(
    runtimeRoot,
    initial.snapshot.lane_id,
    initial.snapshot.issue_number,
    {
      kind: 'preflight-completed',
      preflight: preflightFor(initial.snapshot),
    },
  );
  const state = bundle.snapshot;
  const issueDirectory = join(
    runtimeRoot,
    state.lane_id,
    'issues',
    String(state.issue_number),
  );
  const loaded = loadIssueSupervisorStore(
    runtimeRoot,
    state.lane_id,
    state.issue_number,
  );
  if (loaded === null || issueDirectory.length === 0) {
    throw new TypeError('v2 fixture store was not persisted.');
  }
  return loaded;
};

const persistedLifecycle = (
  identityValue: unknown,
  transitions: readonly unknown[],
) => {
  const directory = mkdtempSync(
    join(realpathSync(tmpdir()), 'fluo-terminal-bundle-'),
  );
  terminalFixtureRoots.push(directory);
  const runtimeRoot = join(directory, '.omo', 'lane-runs');
  let bundle = persistSupervisorStore(runtimeRoot, identityValue);
    for (const transition of transitions) {
      const normalized = normalizeTransition(bundle.snapshot, transition) as
        Readonly<Record<string, unknown>>;
      if (
        normalized.kind === 'cleanup-observed' &&
        bundle.snapshot.authority_scope.cleanup_command_worktrees
      ) {
        rmSync(resolve(bundle.snapshot.repository_root, bundle.snapshot.worktree), {
          recursive: true,
          force: true,
        });
        storeRunners.get(runtimeRoot)?.setCleanupCompleted();
      }
      bundle = applyIssueSupervisorTransition(
        runtimeRoot,
        bundle.snapshot.lane_id,
        bundle.snapshot.issue_number,
        normalized.kind === 'release-handoff'
          ? {
              ...normalized,
              approval_sha256: bundle.snapshot.lane_plan_approval_sha256,
            }
          : normalized,
      );
    }
  return bundle;
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

const fixableBlockReviews = (head: string) => [
  passReviews(head)[0],
  {
    reviewer: 'code',
    reviewed_head_sha: head,
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
  passReviews(head)[2],
];

const createCiPendingState = () => {
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
  return transitionIssueSupervisor(state, {
    kind: 'pr-observed',
    action: 'create',
    receipt: prReceipt('pr-create', headA),
  });
};

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

  it('counts repeated CI-only blocked heads and requires a fresh implementer on the second', () => {
    let state = createIssueSupervisor(identity);
    state = transitionIssueSupervisor(state, {
      kind: 'implementation-completed',
      new_head: headA,
      verification: 'focused tests passed',
    });
    state = transitionIssueSupervisor(state, { kind: 'local-review', reviews: passReviews(headA) });
    state = transitionIssueSupervisor(state, {
      kind: 'pr-observed',
      action: 'create',
      receipt: prReceipt('pr-create', headA),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'ci-observed',
      receipt: {
        ...observationBase(headA), kind: 'ci', pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101', result: 'fixable-failure', evidence: 'ci-only failure one',
      },
    });
    expect(state.blocked_heads_since_refresh).toBe(1);
    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed', new_head: headB, observed_at: observedAt,
      verification: 'focused tests passed', addressed_blockers: remediate(state.blockers as readonly Blocker[]),
    });
    state = transitionIssueSupervisor(state, { kind: 'local-review', reviews: passReviews(headB) });
    state = transitionIssueSupervisor(state, {
      kind: 'pr-observed', action: 'update', receipt: prReceipt('pr-update', headB),
    });
    state = transitionIssueSupervisor(state, {
      kind: 'ci-observed',
      receipt: {
        ...observationBase(headB), kind: 'ci', pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101', result: 'fixable-failure', evidence: 'ci-only failure two',
      },
    });
    expect(state.blocked_heads_since_refresh).toBe(2);
    expect(() => transitionIssueSupervisor(state, {
      kind: 'fix-completed', new_head: headC, observed_at: observedAt,
      verification: 'focused tests passed', addressed_blockers: remediate(state.blockers as readonly Blocker[]),
      fresh_implementer: false, implementer_generation: 1,
    })).toThrow(/fresh implementer/u);
    state = transitionIssueSupervisor(state, {
      kind: 'fix-completed', new_head: headC, observed_at: observedAt,
      verification: 'focused tests passed', addressed_blockers: remediate(state.blockers as readonly Blocker[]),
      fresh_implementer: true, implementer_generation: 2,
    });
    expect(state.implementer_generation).toBe(2);
    expect(state.blocked_heads_since_refresh).toBe(0);
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
          pr_state: 'OPEN',
          pr_mergeable: 'CONFLICTING',
          pr_merge_state_status: 'DIRTY',
          evidence: 'mergeable=CONFLICTING mergeStateStatus=DIRTY',
        },
      },
    ];

    // When
    const persisted = persistedLifecycle(identity, transitions);

    // Then
    expect(persisted.snapshot.status).toBe('conflict-resolution');
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
        pr_state: 'OPEN',
        pr_mergeable: 'CONFLICTING',
        pr_merge_state_status: 'DIRTY',
      }),
    );
  });

  it('rejects blocker event-sequence substitution on store reload', () => {
    const directory = mkdtempSync(
      join(realpathSync(tmpdir()), 'fluo-event-sequence-tamper-'),
    );
    const runtimeRoot = join(directory, '.omo', 'lane-runs');
    try {
      let bundle = persistSupervisorStore(runtimeRoot, identity);
      for (const transition of [
        {
          kind: 'implementation-completed',
          new_head: headA,
          verification: 'focused tests passed',
        },
        {
          kind: 'local-review',
          reviews: fixableBlockReviews(headA),
        },
      ]) {
        bundle = applyIssueSupervisorTransition(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
          normalizeTransition(bundle.snapshot, transition),
        );
      }
      const snapshotPath = resolve(
        runtimeRoot,
        identity.lane_id,
        'issues',
        String(identity.issue_number),
        'snapshot.json',
      );
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
        blocker_ledger: Array<Record<string, unknown>>;
      };
      const entry = snapshot.blocker_ledger[0];
      entry.observed_event_sequence =
        Number(entry.observed_event_sequence) - 1;
      const {
        identity_sha256: _identity,
        remediation_status: _status,
        remediation_history: _history,
        ...immutable
      } = entry;
      entry.identity_sha256 = createHash('sha256')
        .update(JSON.stringify(immutable))
        .digest('hex');
      writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).toThrow(/event ordering/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('invalidates legacy v2 PASS receipts before resuming', () => {
    const persisted = persistedLifecycle(identity, [
      {
        kind: 'implementation-completed',
        new_head: headA,
        verification: 'focused tests passed',
      },
      { kind: 'local-review', reviews: passReviews(headA) },
    ]);
    const repositoryRoot = persisted.snapshot.repository_root;
    const runtimeRoot = resolve(repositoryRoot, '.omo', 'lane-runs');
    const directory = resolve(
      runtimeRoot,
      persisted.snapshot.lane_id,
      'issues',
      String(persisted.snapshot.issue_number),
    );
    const legacy = structuredClone(persisted.snapshot) as Record<
      string,
      unknown
    >;
    const localReview = legacy['local_review'] as Record<string, unknown>;
    const reviewBatch = localReview['review_batch'] as Record<string, unknown>;
    const reviewerReceipts = reviewBatch['reviewer_receipts'] as Record<
      string,
      Record<string, unknown>
    >;
    const verificationReceipt = reviewerReceipts['verification'];
    const canonicalVerification = verificationReceipt[
      'canonical_verification'
    ] as Record<string, unknown>;
    delete canonicalVerification['receipt_id'];
    canonicalVerification['shell_command'] =
      'node canonical-verification.mjs -- pnpm verify';
    writeFileSync(
      resolve(directory, 'snapshot.json'),
      `${JSON.stringify(legacy, null, 2)}\n`,
    );

    const migrated = loadIssueSupervisorStore(
      runtimeRoot,
      persisted.snapshot.lane_id,
      persisted.snapshot.issue_number,
    );

    expect(migrated?.snapshot).toMatchObject({
      status: 'local-review',
      local_review: null,
    });
    expect(migrated?.events.at(-1)).toMatchObject({
      kind: 'local-review-revalidation-required',
      status: 'local-review',
    });
  });

  it.each([
    {
      pr_mergeable: 'CONFLICTING',
      pr_merge_state_status: 'UNKNOWN',
    },
    {
      pr_mergeable: 'UNKNOWN',
      pr_merge_state_status: 'DIRTY',
    },
  ])(
    'accepts an independent $pr_mergeable/$pr_merge_state_status conflict signal',
    ({ pr_mergeable, pr_merge_state_status }) => {
      // Given
      const state = createCiPendingState();

      // When
      const result = transitionIssueSupervisor(state, {
        kind: 'pr-conflict-observed',
        receipt: {
          ...observationBase(headA),
          kind: 'pr-conflict',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          remote_head_sha: headA,
          pr_head_sha: headA,
          pr_state: 'OPEN',
          pr_mergeable,
          pr_merge_state_status,
          evidence: 'fresh GitHub conflict observation',
        },
      });

      // Then
      expect(result.status).toBe('conflict-resolution');
    },
  );

  it('rejects a merge conflict receipt for a non-open PR', () => {
    // Given
    const state = createCiPendingState();

    // When / Then
    expect(() =>
      transitionIssueSupervisor(state, {
        kind: 'pr-conflict-observed',
        receipt: {
          ...observationBase(headA),
          kind: 'pr-conflict',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          remote_head_sha: headA,
          pr_head_sha: headA,
          pr_state: 'MERGED',
          pr_mergeable: 'CONFLICTING',
          pr_merge_state_status: 'DIRTY',
          evidence: 'stale merged PR observation',
        },
      }),
    ).toThrow();
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
    expect(persisted.snapshot).toMatchObject({
      status: state.status,
      head_sha: state.head_sha,
      pr: state.pr,
      ci: state.ci,
    });
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
    const runtimeRoot = join(directory, '.omo', 'lane-runs');
    try {
      let bundle = persistSupervisorStore(runtimeRoot, identity);
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
          normalizeTransition(bundle.snapshot, transition),
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
      const reviewTaskPath = resolve(
        bundle.snapshot.repository_root,
        '.omo/senpi-task/tasks',
        `st_governance_contract_${headA.slice(0, 8)}.json`,
      );
      const reviewTaskText = readFileSync(reviewTaskPath, 'utf8');
      const reviewTask = JSON.parse(reviewTaskText) as Record<string, unknown>;
      reviewTask.task_summary = 'normal post-completion residency metadata';
      reviewTask.residency_state = 'evicted';
      reviewTask.updated_at = '2026-08-26T00:30:00.000Z';
      writeFileSync(reviewTaskPath, JSON.stringify(reviewTask), 'utf8');
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).not.toThrow();

      reviewTask.final_response = 'tampered immutable output';
      writeFileSync(reviewTaskPath, JSON.stringify(reviewTask), 'utf8');
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).toThrow(/final_response|persisted local review receipt/u);

      writeFileSync(reviewTaskPath, reviewTaskText, 'utf8');
      const reviewSessionPath = resolve(
        bundle.snapshot.repository_root,
        '.omo/senpi-task/logs',
        `st_governance_contract_${headA.slice(0, 8)}.jsonl`,
      );
      const reviewSessionText = readFileSync(reviewSessionPath, 'utf8');
      writeFileSync(
        reviewSessionPath,
        `${reviewSessionText}${JSON.stringify({ type: 'tool_execution', payload: { tool: 'read', is_error: false } })}\n`,
        'utf8',
      );
      expect(() =>
        loadIssueSupervisorStore(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
        ),
      ).toThrow(/persisted local review receipt|canonical task|session summary/u);

      writeFileSync(reviewSessionPath, reviewSessionText, 'utf8');
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
    const runtimeRoot = join(directory, '.omo', 'lane-runs');
    try {
      let stored = persistSupervisorStore(runtimeRoot, identity);
      expect(stored.events).toHaveLength(2);
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
        normalizeTransition(stored.snapshot, {
          kind: 'implementation-completed',
          new_head: headA,
          verification: 'focused tests passed',
        }),
      );
      stored = applyIssueSupervisorTransition(
        runtimeRoot,
        identity.lane_id,
        identity.issue_number,
        normalizeTransition(stored.snapshot, {
          kind: 'local-review',
          reviews: passReviews(headA),
        }),
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
      expect(stored.events).toHaveLength(5);
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
          ...stored.snapshot,
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
    const terminalRoot = terminalBundle.snapshot.repository_root;
    const terminalRuntimeRoot = resolve(terminalRoot, '.omo', 'lane-runs');
    const fixtureRunner = storeRunners.get(terminalRuntimeRoot);
    const bareOrigin = resolve(terminalRoot, '.origin.git');
    execFileSync('git', ['init', '-q', '-b', 'main', terminalRoot]);
    execFileSync('git', ['init', '-q', '--bare', bareOrigin]);
    execFileSync('git', ['-C', terminalRoot, 'config', 'user.email', 'fixture@fluo.dev']);
    execFileSync('git', ['-C', terminalRoot, 'config', 'user.name', 'Fixture']);
    execFileSync('git', ['-C', terminalRoot, 'remote', 'add', 'origin', bareOrigin]);
    execFileSync('git', ['-C', terminalRoot, 'commit', '-q', '--allow-empty', '-m', 'origin seed']);
    const originHead = execFileSync('git', ['-C', terminalRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', terminalRoot, 'push', '-q', 'origin', 'HEAD:refs/heads/seed']);
    let recreated = false;
    storeRunners.set(terminalRuntimeRoot, (command: string, args: string[], options: Record<string, unknown>) => {
      if (command !== 'git' || !args.includes('ls-remote')) return fixtureRunner(command, args, options);
      try {
        return execFileSync(command, args, { ...options, encoding: 'utf8' });
      } catch (error) {
        if (!recreated && Number((error as { status?: number }).status) === 2) {
          execFileSync('git', ['--git-dir', bareOrigin, 'update-ref', `refs/heads/${identity.branch}`, originHead]);
          recreated = true;
        }
        throw error;
      }
    });
    expect(() => importSupervisorTerminal(
      { snapshot: ledger, events: [], receipts: [] },
      terminalBundle,
      liveCompletion,
    )).toThrow(/live origin issue branch/u);
    expect(recreated).toBe(true);
    execFileSync('git', ['--git-dir', bareOrigin, 'update-ref', '-d', `refs/heads/${identity.branch}`]);
    storeRunners.set(terminalRuntimeRoot, fixtureRunner);

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

    const forged: any = structuredClone(terminalBundle);
    const forgedCi = forged.receipts.find((receipt: any) => receipt.kind === 'ci');
    forgedCi.evidence = 'self-consistent forged CI evidence';
    forged.snapshot.ci.evidence = forgedCi.evidence;
    expect(() => importSupervisorTerminal(
      { snapshot: ledger, events: [], receipts: [] },
      forged,
      liveCompletion,
    )).toThrow(/forged or stale/u);

    const stale: any = structuredClone(terminalBundle);
    stale.events.pop();
    expect(() => importSupervisorTerminal(
      { snapshot: ledger, events: [], receipts: [] },
      stale,
      liveCompletion,
    )).toThrow(/forged or stale/u);
  });

  it('imports a persisted conflict lifecycle with the resolved composite reviewed head', () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), 'fluo-conflict-terminal-')),
    );
    const runtimeRoot = join(directory, '.omo', 'lane-runs');
    try {
      let bundle = persistSupervisorStore(runtimeRoot, identity);
      const apply = (transition: unknown) => {
        const normalized = normalizeTransition(bundle.snapshot, transition) as Readonly<Record<string, unknown>>;
        if (normalized.kind === 'cleanup-observed') {
          rmSync(resolve(bundle.snapshot.repository_root, bundle.snapshot.worktree), {
            recursive: true,
            force: true,
          });
          storeRunners.get(runtimeRoot)?.setCleanupCompleted();
        }
        bundle = applyIssueSupervisorTransition(
          runtimeRoot,
          identity.lane_id,
          identity.issue_number,
          normalized,
        );
      };
      apply({
        kind: 'implementation-completed',
        new_head: headA,
        verification: 'focused tests passed',
      });
      apply({ kind: 'local-review', reviews: passReviews(headA) });
      apply({
        kind: 'pr-observed',
        action: 'create',
        receipt: prReceipt('pr-create', headA),
      });
      const conflictReceipt = {
        ...observationBase(headA),
        kind: 'pr-conflict',
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        remote_head_sha: headA,
        pr_head_sha: headA,
        pr_state: 'OPEN',
        pr_mergeable: 'CONFLICTING',
        pr_merge_state_status: 'DIRTY',
        evidence: 'PR reports a deterministic merge conflict.',
      };
      apply({ kind: 'pr-conflict-observed', receipt: conflictReceipt });
      const preflight = bundle.snapshot.review_preflight as Readonly<Record<string, unknown>>;
      const gate = {
        preflight_sha256: preflight.sha256,
        previously_reviewed_head: headA,
        upstream_head: headC,
        resolved_head: headB,
        conflicting_files: ['package.json'],
        conflicting_hunks: ['package.json:10-14'],
        semantic_impact: 'mechanical',
        upstream_relevant: false,
        affected_axes: [],
        rationale: 'The resolution preserves both independent changes.',
      };
      const machineEvidence = computeConflictGitEvidence({
        repository_root: bundle.snapshot.repository_root,
        worktree: bundle.snapshot.worktree,
        previously_reviewed_head: headA,
        upstream_head: headC,
        resolved_head: headB,
        command_runner: storeRunners.get(resolve(bundle.snapshot.repository_root, '.omo', 'lane-runs')),
      });
      const { diffs: _diffs, ...canonicalMachineEvidence } =
        machineEvidence;
      const finalResponse = {
        sentinel: 'fluo:execute-lane:conflict-review:final:v1',
        verdict_signal: 'PASS',
        generation: bundle.snapshot.implementer_generation,
        ...gate,
        digests: machineEvidence.digests,
      };
      const gateTask = {
        task_id: 'st_governance_conflict_gate',
        status: 'completed',
        agent_type: 'fluo-contract-reviewer',
        resolved_model: {
          provider: 'openai-codex',
          model_id: 'gpt-5.6-sol',
          source: 'category',
          variant: 'medium',
        },
        parent_session_id: 'ses-governance-parent',
        name: conflictReviewerTaskName(identity.issue_number, headB),
        final_response: senpiFinal(
          'fluo:execute-lane:conflict-review:final:v1',
          finalResponse,
        ),
        spawn_spec: {
          cwd: bundle.snapshot.repository_root,
          prompt: `Review conflict resolution without mutation.\n${conflictReviewerPromptSentinel({
            repository_root: bundle.snapshot.repository_root,
            lane_id: identity.lane_id,
            issue_number: identity.issue_number,
            worktree: identity.worktree,
            generation: bundle.snapshot.implementer_generation,
            machine_evidence: canonicalMachineEvidence,
            ...gate,
          })}`,
        },
      };
      writeActualShapedReviewerTask({
        task: gateTask,
        repository_root: bundle.snapshot.repository_root,
        expected: {
          task_id: gateTask.task_id,
          parent_session_id: 'ses-governance-parent',
          lane_id: identity.lane_id,
          issue_number: identity.issue_number,
          worktree: identity.worktree,
          preflight_sha256: gate.preflight_sha256,
          axis: 'conflict',
        },
        verify: false,
      });
      writeActualShapedConflictImplementerTask({
        repository_root: bundle.snapshot.repository_root,
        task_id: 'st_governance_conflict_implementer',
        parent_session_id: 'ses-governance-parent',
        lane_id: bundle.snapshot.lane_id,
        issue_number: bundle.snapshot.issue_number,
        worktree: bundle.snapshot.worktree,
        old_base: machineEvidence.old_base,
        previously_reviewed_head: headA,
        upstream_head: headC,
        resolved_head: headB,
        generation: bundle.snapshot.implementer_generation,
        preflight_sha256: gate.preflight_sha256,
      });
      apply({
        kind: 'conflict-resolved',
        gate,
        gate_task_id: gateTask.task_id,
        conflict_implementer_task_id: 'st_governance_conflict_implementer',
        rerun_task_ids: {},
      });
      expect(bundle.snapshot.status).toBe('ready-for-push');
      expect(bundle.snapshot.blockers).toEqual([]);
      apply({
        kind: 'pr-observed',
        action: 'update',
        receipt: prReceipt('pr-update', headB),
      });
      apply({
        kind: 'ci-observed',
        receipt: {
          ...observationBase(headB),
          kind: 'ci',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          result: 'fixable-failure',
          evidence: 'resolved-head integration check failed',
        },
      });
      expect(bundle.snapshot.status).toBe('ci-fix-back');
      const ciBlocker = bundle.snapshot.blocker_ledger.at(-1);
      expect(ciBlocker).toMatchObject({
        reviewed_head_sha: headB,
        evidence_kind: 'verified-ci-receipt',
        reviewer_receipt: {
          head_sha: headB,
          mutation_sentinel: 'fluo:execute-lane:conflict-review:read-only:v1',
        },
      });
      const fixedHead = 'e'.repeat(40);
      apply({
        kind: 'fix-completed',
        new_head: fixedHead,
        observed_at: observedAt,
        verification: 'composite verification passed after CI fix',
        addressed_blockers: remediate(bundle.snapshot.blockers as readonly Blocker[]),
      });
      apply({ kind: 'local-review', reviews: passReviews(fixedHead) });
      apply({
        kind: 'pr-observed',
        action: 'update',
        receipt: prReceipt('pr-update', fixedHead),
      });
      apply({
        kind: 'ci-observed',
        receipt: {
          ...observationBase(fixedHead),
          kind: 'ci',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          result: 'pass',
          evidence: 'all required checks passed after resolved-head fix-back',
        },
      });
      apply({
        kind: 'merge-observed',
        receipt: {
          ...observationBase(fixedHead),
          kind: 'merge',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          reviewed_head_sha: fixedHead,
          remote_head_sha: fixedHead,
          pr_head_sha: fixedHead,
          ci_head_sha: fixedHead,
          merge_method: 'squash',
          pr_state: 'MERGED',
          issue_state: 'CLOSED',
          merge_commit_sha: headC,
        },
      });
      apply({
        kind: 'cleanup-observed',
        receipt: {
          ...observationBase(fixedHead),
          kind: 'cleanup',
          pr_number: 5101,
          pr_url: 'https://github.com/fluojs/fluo/pull/5101',
          worktree_removed: true,
          local_branch_deleted: true,
          remote_branch_deleted: true,
        },
      });
      expect(bundle.snapshot.status).toBe('done');
      const ledger = JSON.parse(
        readFileSync(
          resolve(process.cwd(), 'tooling/governance/fixtures/execute-lane-native/ready-ledger-multi-v2.json'),
          'utf8',
        ),
      );
      const liveCompletion = {
        issue_number: identity.issue_number,
        issue_url: `https://github.com/fluojs/fluo/issues/${String(identity.issue_number)}`,
        pr_number: 5101,
        pr_url: 'https://github.com/fluojs/fluo/pull/5101',
        branch: identity.branch,
        worktree: identity.worktree,
        reviewed_head_sha: fixedHead,
        remote_head_sha: fixedHead,
        pr_head_sha: fixedHead,
        ci_head_sha: fixedHead,
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
        bundle,
        liveCompletion,
      );
      expect(imported.snapshot.issue_progress).toMatchObject({
        '4101': {
          status: 'done',
          head_sha: fixedHead,
          reviewed_head: fixedHead,
          blockers: [],
          checks: 'PASS',
        },
      });
      const forgedConflict: any = structuredClone(bundle);
      forgedConflict.snapshot.conflict_resolution.conflict_receipt.evidence = 'self-consistent forged conflict evidence';
      const persistedConflict = forgedConflict.receipts.find((receipt: any) => receipt.kind === 'pr-conflict');
      persistedConflict.evidence = forgedConflict.snapshot.conflict_resolution.conflict_receipt.evidence;
      forgedConflict.snapshot.conflict_resolution.conflict_receipt_sha256 = createHash('sha256')
        .update(JSON.stringify(forgedConflict.snapshot.conflict_resolution.conflict_receipt))
        .digest('hex');
      expect(() => importSupervisorTerminal(
        { snapshot: ledger, events: [], receipts: [] },
        forgedConflict,
        liveCompletion,
      )).toThrow(/forged or stale/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

    const childContractBundle = persistedLifecycle(identity, [
      {
        kind: 'child-contract-error',
        observed_head: headA,
        signature: 'reviewer-task-suspended-without-final',
        evidence:
          'Required reviewer task was persisted without a final response.',
      },
    ]);
    const childContractImport = importSupervisorTerminal(
      { snapshot: ledger, events: [], receipts: [] },
      childContractBundle,
    );
    expect(childContractImport.snapshot.lanes).toMatchObject([
      { status: 'blocked-child-contract-error' },
    ]);
    expect(childContractImport.snapshot.issue_progress).toMatchObject({
      '4101': {
        status: 'blocked-child-contract-error',
      },
    });
    expect(childContractImport.events.at(-1)).toMatchObject({
      event_type: 'supervisor.blocked',
      payload: {
        status: 'blocked-child-contract-error',
        imported_bundle_sha256: payloadDigest(childContractBundle),
        terminal_event_hash:
          childContractBundle.events.at(-1)?.event_hash,
        receipt_ids: [],
      },
    });

    const releaseRoot = realpathSync(
      mkdtempSync(join(tmpdir(), 'fluo-release-supervisor-')),
    );
    try {
      const releaseIssue = 4200;
      const fixture = prepareCanonicalV2Runtime({
        repository_root: releaseRoot,
        lane_id: 'lane-4200-release',
        issue_numbers: [releaseIssue],
        release_handoffs: [releaseIssue],
      });
      storeRunners.set(fixture.runtimeRoot, fixture.commandRunner);
      mkdirSync(resolve(releaseRoot, `.worktrees/issue-${String(releaseIssue)}-release-handoff`), { recursive: true });
      let releaseBundle = initialiseIssueSupervisorStore(fixture.runtimeRoot, {
        lane_id: fixture.ledger.lane_id,
        issue_number: releaseIssue,
        branch: `issue-${String(releaseIssue)}-release-handoff`,
        worktree: `.worktrees/issue-${String(releaseIssue)}-release-handoff`,
        starting_head_sha: headA,
        started_at: observedAt,
        review_policy: 'preflight-v1',
        repository_root: releaseRoot,
        parent_session_id: 'ses-release-supervisor',
      });
      releaseBundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        fixture.ledger.lane_id,
        releaseIssue,
        { kind: 'preflight-completed', preflight: preflightFor(releaseBundle.snapshot) },
      );
      releaseBundle = applyIssueSupervisorTransition(
        fixture.runtimeRoot,
        fixture.ledger.lane_id,
        releaseIssue,
        {
          kind: 'release-handoff',
          approval_sha256: releaseBundle.snapshot.lane_plan_approval_sha256,
        },
      );
      const approvalEvidence = {
        receipt: fixture.approval,
        artifact: fixture.artifact,
        artifact_path: fixture.ledger.source.search_ledger,
      };
      const releaseImport = importSupervisorTerminal(
        { snapshot: fixture.ledger, events: [], receipts: [] },
        releaseBundle,
        null,
        approvalEvidence,
      );
      expect(releaseImport.snapshot.lanes).toMatchObject([
        { status: 'blocked-maintainer-decision' },
      ]);
      expect(
        importSupervisorTerminal(
          releaseImport,
          releaseBundle,
          null,
          approvalEvidence,
        ),
      ).toEqual(releaseImport);
    } finally {
      rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

});
