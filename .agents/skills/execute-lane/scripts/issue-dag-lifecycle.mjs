import {
  amendIssueLifecycleDag,
} from './compile-dag.mjs';
import {
  blockerLedgerDigest,
} from './blocker-ledger.mjs';
import {
  assertIssueDagState,
} from './issue-dag-contracts.mjs';
import {
  assertIssueSupervisorState,
  issueSupervisorTerminalStatuses,
} from './issue-supervisor-contracts.mjs';

const terminalStatuses = new Set(issueSupervisorTerminalStatuses);

const phaseKey = (phase) =>
  phase.kind === 'implementation' || phase.kind === 'review'
    ? `${phase.kind}:g${String(phase.generation)}:${phase.head_sha}`
    : phase.kind === 'conflict-implementation'
      ? `${phase.kind}:g${String(phase.generation)}:${phase.previously_reviewed_head}:${phase.upstream_head}`
      : ['conflict-gate', 'conflict-review'].includes(phase.kind)
        ? `${phase.kind}:${phase.resolved_head}`
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
  parent_session_id: snapshot.parent_session_id,
  preflight_sha256: snapshot.review_preflight.sha256,
  blocker_ledger: structuredClone(snapshot.blocker_ledger),
  unresolved_blockers: snapshot.blocker_ledger.filter(
    (entry) => entry.remediation_status === 'unresolved',
  ),
  blocker_ledger_sha256: blockerLedgerDigest(snapshot.blocker_ledger),
});

const reviewPhase = (snapshot) => ({
  kind: 'review',
  ...shared(snapshot),
  generation: snapshot.implementer_generation,
  preflight_sha256: snapshot.review_preflight.sha256,
});

const operatorPhase = (snapshot, kind, extra = {}) => ({
  kind,
  ...shared(snapshot),
  pr: structuredClone(snapshot.pr),
  ...extra,
});

const conflictPhase = (snapshot, context) => {
  if (context?.stage === 'implementation') {
    return {
      kind: 'conflict-implementation',
      ...shared(snapshot),
      generation: snapshot.implementer_generation,
      parent_session_id: snapshot.parent_session_id,
      preflight_sha256: snapshot.review_preflight.sha256,
      previously_reviewed_head: snapshot.head_sha,
      upstream_head: context.upstream_head,
    };
  }
  if (context?.stage === 'gate') {
    return {
      kind: 'conflict-gate',
      ...shared(snapshot),
      generation: snapshot.implementer_generation,
      preflight_sha256: snapshot.review_preflight.sha256,
      previously_reviewed_head: snapshot.head_sha,
      upstream_head: context.upstream_head,
      resolved_head: context.resolved_head,
    };
  }
  if (context?.stage === 'review') {
    return {
      kind: 'conflict-review',
      ...shared(snapshot),
      generation: snapshot.implementer_generation,
      preflight_sha256: snapshot.review_preflight.sha256,
      previously_reviewed_head: snapshot.head_sha,
      upstream_head: context.upstream_head,
      resolved_head: context.resolved_head,
      affected_axes: structuredClone(context.affected_axes),
    };
  }
  return { kind: 'requires-conflict-context' };
};

export const nextIssueDagPhase = (
  snapshot,
  { phase_context: phaseContext, completed_phase_keys: completed = [] } = {},
) => {
  assertIssueSupervisorState(snapshot);
  if (snapshot.status === 'preflight') return null;
  if (['implementing', 'ci-fix-back'].includes(snapshot.status)) {
    return implementationPhase(snapshot);
  }
  if (snapshot.status === 'local-review') return reviewPhase(snapshot);
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
    return conflictPhase(snapshot, phaseContext);
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
    snapshot.parent_session_id !== dagState.coordinator_session_id
  ) {
    throw new TypeError('Issue DAG lifecycle authority does not match.');
  }
  if (dagState.status !== 'phase-settled') {
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
    dagState.last_completed_node_ids,
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
  };
};
