import {
  amendIssueLifecycleDag,
  compileIssueLifecycleSegment,
} from './compile-dag.mjs';
import {
  blockerLedgerDigest,
} from './blocker-ledger.mjs';
import {
  assertIssueDagState,
} from './issue-dag-contracts.mjs';
import {
  assertIssueSupervisorState,
  coordinatorSessionIds,
  currentCoordinatorSessionId,
  issueSupervisorTerminalStatuses,
} from './issue-supervisor-contracts.mjs';

const terminalStatuses = new Set(issueSupervisorTerminalStatuses);
const canonicalHead = (value, name) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new TypeError(`${name} must be a canonical head.`);
  }
  return value;
};

const phaseKey = (phase) =>
  phase.kind === 'preflight-retry'
    ? 'preflight'
  : phase.kind === 'implementation' || phase.kind === 'review'
    ? `${phase.kind}:g${String(phase.generation)}:${phase.head_sha}` +
      (
        phase.kind === 'review' &&
        phase.review_revalidation_generation !== undefined
          ? `:revalidation-g${String(phase.review_revalidation_generation)}`
          : ''
      )
    : phase.kind === 'conflict-implementation'
      ? `${phase.kind}:g${String(phase.generation)}:${phase.previously_reviewed_head}:${phase.upstream_head}`
       : ['conflict-gate', 'conflict-review'].includes(phase.kind)
         ? `${phase.kind}:g${String(phase.generation)}:${phase.resolved_head}`
    : `${phase.kind}:${phase.head_sha}`;

const shared = (snapshot) => ({
  repository_root: snapshot.repository_root,
  worktree: snapshot.worktree,
  head_sha: snapshot.head_sha,
});

const implementationPhase = (snapshot) => ({
  kind: 'implementation',
  ...shared(snapshot),
  generation: snapshot.implementer_generation,
  parent_session_id: currentCoordinatorSessionId(snapshot),
  preflight_sha256: snapshot.review_preflight.sha256,
  blocker_ledger: structuredClone(snapshot.blocker_ledger),
  unresolved_blockers: snapshot.blocker_ledger.filter(
    (entry) => entry.remediation_status === 'unresolved',
  ),
  blocker_ledger_sha256: blockerLedgerDigest(snapshot.blocker_ledger),
});

const reviewPhase = (snapshot, context) => {
  if (
    typeof context?.verification_receipt_id !== 'string' ||
    !/^st_[A-Za-z0-9_-]+$/u.test(context.verification_receipt_id)
  ) {
    throw new TypeError(
      'Review phase requires one parent-owned verification receipt.',
    );
  }
  return {
    kind: 'review',
    ...shared(snapshot),
    generation: snapshot.implementer_generation,
    preflight_sha256: snapshot.review_preflight.sha256,
    verification_receipt_id: context.verification_receipt_id,
    ...(
      Number.isSafeInteger(context.review_revalidation_generation) &&
      context.review_revalidation_generation > 0
        ? {
            review_revalidation_generation:
              context.review_revalidation_generation,
          }
        : {}
    ),
  };
};

const operatorPhase = (snapshot, kind, extra = {}) => ({
  kind,
  ...shared(snapshot),
  pr: structuredClone(snapshot.pr),
  ...extra,
});

export const nextConflictDagPhase = (
  snapshot,
  context,
  completedPhaseKeys,
) => {
  const previousHead = canonicalHead(
    snapshot.head_sha,
    'conflict reviewed head',
  );
  const upstreamHead = canonicalHead(
    context?.upstream_head,
    'conflict upstream head',
  );
  const implementationKey =
    `conflict-implementation:g${String(snapshot.implementer_generation)}` +
    `:${previousHead}:${upstreamHead}`;
  if (context?.stage === 'implementation') {
    return {
      kind: 'conflict-implementation',
      ...shared(snapshot),
      generation: snapshot.implementer_generation,
      parent_session_id: currentCoordinatorSessionId(snapshot),
      preflight_sha256: snapshot.review_preflight.sha256,
      previously_reviewed_head: previousHead,
      upstream_head: upstreamHead,
      old_base: context.old_base,
    };
  }
  if (context?.stage === 'gate') {
    if (!completedPhaseKeys.includes(implementationKey)) {
      throw new TypeError(
        'Conflict gate requires the completed conflict implementation phase.',
      );
    }
    return {
      kind: 'conflict-gate',
      ...shared(snapshot),
      generation: snapshot.implementer_generation,
      preflight_sha256: snapshot.review_preflight.sha256,
      previously_reviewed_head: previousHead,
      upstream_head: upstreamHead,
      resolved_head: canonicalHead(
        context.resolved_head,
        'conflict resolved head',
      ),
      machine_evidence: structuredClone(context.machine_evidence),
    };
  }
  if (context?.stage === 'review') {
    const resolvedHead = canonicalHead(
      context.resolved_head,
      'conflict resolved head',
    );
    if (
      !completedPhaseKeys.includes(
        `conflict-gate:g${String(snapshot.implementer_generation)}:${resolvedHead}`,
      )
    ) {
      throw new TypeError(
        'Conflict review requires the completed conflict gate phase.',
      );
    }
    return {
      kind: 'conflict-review',
      ...shared(snapshot),
      generation: snapshot.implementer_generation,
      preflight_sha256: snapshot.review_preflight.sha256,
      previously_reviewed_head: previousHead,
      upstream_head: upstreamHead,
      resolved_head: resolvedHead,
      affected_axes: structuredClone(context.affected_axes),
      verification_receipt_id: context.verification_receipt_id,
    };
  }
  return { kind: 'requires-conflict-context' };
};

const preflightRetryPhase = (snapshot, context) => {
  if (context?.stage !== 'preflight-retry') {
    return null;
  }
  const bootstrap = context.bootstrap;
  if (
    !Number.isSafeInteger(context.retry_generation) ||
    context.retry_generation < 1 ||
    typeof bootstrap !== 'object' ||
    bootstrap === null ||
    Array.isArray(bootstrap) ||
    bootstrap.repository_root !== snapshot.repository_root ||
    bootstrap.starting_head_sha !== snapshot.head_sha ||
    bootstrap.issue_contract_sha256 !== snapshot.issue_contract_sha256 ||
    bootstrap.lane_plan_approval_sha256 !==
      snapshot.lane_plan_approval_sha256
  ) {
    throw new TypeError('Preflight retry authority is invalid.');
  }
  return {
    kind: 'preflight-retry',
    retry_generation: context.retry_generation,
    repository_root: bootstrap.repository_root,
    starting_head_sha: bootstrap.starting_head_sha,
    issue_contract_sha256: bootstrap.issue_contract_sha256,
    lane_plan_approval_sha256: bootstrap.lane_plan_approval_sha256,
    evidence_paths: structuredClone(bootstrap.evidence_paths),
  };
};

export const nextIssueDagPhase = (
  snapshot,
  { phase_context: phaseContext, completed_phase_keys: completed = [] } = {},
) => {
  assertIssueSupervisorState(snapshot);
  if (snapshot.status === 'preflight') {
    return preflightRetryPhase(snapshot, phaseContext);
  }
  if (['implementing', 'ci-fix-back'].includes(snapshot.status)) {
    return implementationPhase(snapshot);
  }
  if (snapshot.status === 'local-review') {
    return reviewPhase(snapshot, phaseContext);
  }
  if (['ready-for-pr', 'ready-for-push'].includes(snapshot.status)) {
    return operatorPhase(snapshot, 'pr-sync', {
      operation:
        snapshot.status === 'ready-for-pr'
          ? 'adopt-or-create'
          : 'update',
    });
  }
  if (snapshot.status === 'ci-pending') {
    return operatorPhase(snapshot, 'ci-observe', {
      observation_ordinal:
        completed.filter((key) => key.startsWith('ci-observe:')).length + 1,
    });
  }
  if (snapshot.status === 'conflict-resolution') {
    return nextConflictDagPhase(snapshot, phaseContext, completed);
  }
  if (snapshot.status === 'merge-ready') {
    return operatorPhase(snapshot, 'merge');
  }
  if (snapshot.status === 'merged') {
    return operatorPhase(snapshot, 'cleanup', {
      merge_head: snapshot.merge?.merge_commit_sha ?? snapshot.head_sha,
    });
  }
  if (terminalStatuses.has(snapshot.status)) {
    return { kind: 'terminalize' };
  }
  throw new TypeError(
    `Issue DAG has no lifecycle phase for ${snapshot.status}.`,
  );
};

export const planIssueDagAmendment = ({
  lane,
  issue_snapshot: snapshot,
  dag_state: dagState,
  phase_context: phaseContext,
}) => {
  assertIssueSupervisorState(snapshot);
  assertIssueDagState(dagState);
  if (
    snapshot.lane_id !== dagState.lane_id ||
    snapshot.issue_number !== dagState.issue_number ||
    currentCoordinatorSessionId(snapshot) !==
      dagState.coordinator_session_id
  ) {
    throw new TypeError('Issue DAG lifecycle authority does not match.');
  }
  const continuesPreflight =
    snapshot.status === 'preflight' &&
    phaseContext?.stage === 'preflight-retry' &&
    dagState.status === 'native-completed-unverified' &&
    dagState.active_phase_key === 'preflight';
  if (!continuesPreflight && dagState.status !== 'phase-settled') {
    return { action: 'wait', status: dagState.status };
  }
  const phase = nextIssueDagPhase(snapshot, {
    phase_context: phaseContext,
    completed_phase_keys: dagState.completed_phase_keys,
  });
  if (phase === null) {
    return { action: 'await-preflight-import' };
  }
  if (phase.kind === 'terminalize') {
    return {
      action: 'terminalize',
      issue_status: snapshot.status,
    };
  }
  if (phase.kind === 'requires-conflict-context') {
    return { action: 'await-conflict-context' };
  }
  const key = phaseKey(phase);
  if (dagState.completed_phase_keys.includes(key)) {
    return { action: 'await-phase-import', phase_key: key };
  }
  const definition = amendIssueLifecycleDag(
    lane,
    snapshot.issue_number,
    dagState.current_definition,
    phase,
    continuesPreflight
      ? dagState.active_node_ids
      : dagState.last_completed_node_ids,
  );
  const addedNodeIds = definition.nodes
    .slice(dagState.current_definition.nodes.length)
    .map((node) => node.id);
  return {
    action: 'prepare-amendment',
    phase,
    phase_key: key,
    definition,
    added_node_ids: addedNodeIds,
    continue_active_phase: continuesPreflight,
  };
};

export const planIssueDagRollover = ({
  lane,
  issue_snapshot: snapshot,
  dag_state: dagState,
  coordinator_session_id: coordinatorSessionId,
  phase_context: phaseContext,
}) => {
  assertIssueSupervisorState(snapshot);
  assertIssueDagState(dagState);
  if (
    snapshot.lane_id !== dagState.lane_id ||
    snapshot.issue_number !== dagState.issue_number ||
    snapshot.head_sha !== dagState.head_sha ||
    coordinatorSessionId === dagState.coordinator_session_id ||
    typeof coordinatorSessionId !== 'string' ||
    coordinatorSessionId.length === 0 ||
    coordinatorSessionIds(snapshot).includes(coordinatorSessionId)
  ) {
    throw new TypeError('Issue DAG rollover authority does not match.');
  }
  const issueTransition = {
    kind: 'coordinator-rolled-over',
    coordinator_session_id: coordinatorSessionId,
  };
  if (dagState.status === 'native-completed-unverified') {
    return {
      action: 'await-phase-import',
      issue_transition: issueTransition,
      phase_key: dagState.active_phase_key,
      predecessor_run_id: dagState.run_id,
    };
  }
  const plannedPhase = nextIssueDagPhase(snapshot, {
    phase_context: phaseContext,
    completed_phase_keys: dagState.completed_phase_keys,
  });
  const phase =
    plannedPhase !== null &&
    Object.hasOwn(plannedPhase, 'parent_session_id')
      ? {
          ...plannedPhase,
          parent_session_id: coordinatorSessionId,
        }
      : plannedPhase;
  const reusesInitialPreflight =
    phase === null &&
    dagState.active_phase_key === 'preflight' &&
    ['dispatch-intent', 'phase-running'].includes(dagState.status);
  if (
    (!reusesInitialPreflight && phase === null) ||
    (phase !== null &&
      ['terminalize', 'requires-conflict-context'].includes(phase.kind))
  ) {
    throw new TypeError('Issue DAG rollover has no executable phase.');
  }
  const key = reusesInitialPreflight
    ? 'preflight'
    : phaseKey(phase);
  const preservesPendingPhase = [
    'dispatch-intent',
    'phase-running',
  ].includes(dagState.status);
  const recoversPendingAmendment =
    dagState.status === 'amend-intent' &&
    dagState.pending_amendment?.phase_key === key;
  if (
    ![
      'dispatch-intent',
      'phase-running',
      'phase-settled',
      'amend-intent',
    ].includes(dagState.status) ||
    (preservesPendingPhase && dagState.active_phase_key !== key) ||
    (dagState.status === 'amend-intent' &&
      !recoversPendingAmendment)
  ) {
    throw new TypeError('Issue DAG rollover phase does not match.');
  }
  return {
    action: 'prepare-rollover',
    issue_transition: issueTransition,
    coordinator_session_id: coordinatorSessionId,
    phase_key: key,
    head_sha: snapshot.head_sha,
    definition: reusesInitialPreflight
      ? structuredClone(dagState.current_definition)
      : compileIssueLifecycleSegment(
          lane,
          snapshot.issue_number,
          phase,
        ),
  };
};
