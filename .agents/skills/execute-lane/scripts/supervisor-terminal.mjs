import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  appendEvent,
  cleanupReceipts,
  mergeReceipt,
  setRootStatus,
  terminalize,
} from './transition-application.mjs';
import { assertIssueSupervisorState } from './issue-supervisor-contracts.mjs';
import { assertIssueSupervisorBundle } from './issue-supervisor-store.mjs';
import { dependencyGate } from './dependency-gate.mjs';
import { parkReleaseHandoff } from './lane-progression.mjs';
import { assertReleaseHandoffBinding } from './release-handoff-approval.mjs';
import {
  advanceLane,
  assertLiveCompletion,
  blockedProgress,
  completedProgress,
  identityFromSupervisor,
  laneFor,
} from './supervisor-terminal-evidence.mjs';

const terminalStatuses = new Set([
  'done',
  'needs-human-check-terminal',
  'blocked-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
]);

export const importSupervisorTerminal = (
  persisted,
  supervisorBundle,
  liveCompletion = null,
  releaseHandoffContext = null,
) => {
  assertIssueSupervisorBundle(supervisorBundle);
  const { state: supervisor } = assertIssueSupervisorState(
    supervisorBundle.snapshot,
  );
  if (!terminalStatuses.has(supervisor.status)) {
    throw new TypeError('shared lane import requires a terminal supervisor state.');
  }
  const snapshot = structuredClone(persisted.snapshot);
  const events = structuredClone(persisted.events);
  const receipts = structuredClone(persisted.receipts);
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  if (supervisor.lane_id !== snapshot.lane_id) {
    throw new TypeError('supervisor lane identity does not match the ledger.');
  }
  for (const key of [
    'pr_creation',
    'pr_merge',
    'cleanup_command_worktrees',
  ]) {
    if (supervisor.authority_scope[key] !== snapshot.authority_scope[key]) {
      throw new TypeError(`supervisor authority does not match ledger: ${key}.`);
    }
  }
  if (
    supervisor.retry_policy.retry_count_is_terminal !==
      snapshot.retry_policy.retry_count_is_terminal ||
    supervisor.retry_policy.max_same_failure_repeats !==
      snapshot.retry_policy.max_same_failure_repeats ||
    supervisor.retry_policy.max_wall_clock_minutes !==
      snapshot.retry_policy.max_wall_clock_minutes ||
    supervisor.retry_policy.stop_on_child_contract_error !==
      snapshot.retry_policy.stop_on_child_contract_error
  ) {
    throw new TypeError('supervisor retry policy does not match the ledger.');
  }

  const { lane, laneIndex } = laneFor(snapshot, supervisor.issue_number);
  const gate = dependencyGate(snapshot, supervisor.issue_number);
  if (gate.status !== 'ready') {
    throw new TypeError('supervisor terminal import has unmet dependencies.');
  }
  const identity = identityFromSupervisor(snapshot, supervisor, laneIndex);
  const existingProgress =
    snapshot.issue_progress[String(supervisor.issue_number)];

  if (supervisor.status === 'done') {
    assertLiveCompletion(supervisor, liveCompletion);
    const progress = completedProgress(supervisor);
    if (snapshot.completed_issues.includes(supervisor.issue_number)) {
      if (
        JSON.stringify(
          snapshot.issue_progress[String(supervisor.issue_number)],
        ) !== JSON.stringify(progress)
      ) {
        throw new TypeError(
          'completed supervisor import conflicts with shared lane evidence.',
        );
      }
      return { snapshot, events, receipts };
    }
    snapshot.issue_progress[String(supervisor.issue_number)] = progress;
    if (!snapshot.completed_issues.includes(supervisor.issue_number)) {
      snapshot.completed_issues.push(supervisor.issue_number);
    }
    receipts.push(
      mergeReceipt(identity),
      ...cleanupReceipts(
        identity,
        supervisor.authority_scope.cleanup_command_worktrees
          ? 'succeeded'
          : 'skipped',
      ),
    );
    appendEvent(
      events,
      snapshot.lane_id,
      'supervisor.completed',
      String(supervisor.issue_number),
      {
        head_sha: supervisor.head_sha,
        merge_commit_sha: supervisor.merge.commit_sha,
      },
    );
    advanceLane(snapshot, lane);
    setRootStatus(snapshot, 'running');
  } else if (supervisor.status === 'blocked-maintainer-decision') {
    if (
      supervisor.release_handoff !== true ||
      !snapshot.release_handoffs.includes(supervisor.issue_number) ||
      supervisor.lane_plan_approval_sha256 === null ||
      supervisor.lane_plan_approval_sha256 !==
        snapshot.lane_plan_approval_sha256
    ) {
      throw new TypeError('release handoff approval does not match the ledger.');
    }
    assertReleaseHandoffBinding(
      snapshot,
      releaseHandoffContext?.receipt,
      releaseHandoffContext?.artifact,
      releaseHandoffContext?.artifact_path,
    );
    if (
      lane.status === 'blocked-maintainer-decision' &&
      existingProgress?.status === 'blocked-maintainer-decision'
    ) {
      return { snapshot, events, receipts };
    }
    parkReleaseHandoff(snapshot, identity, events);
  } else {
    const progress = blockedProgress(supervisor);
    if (lane.status === supervisor.status && existingProgress !== undefined) {
      if (JSON.stringify(existingProgress) !== JSON.stringify(progress)) {
        throw new TypeError(
          'blocked supervisor import conflicts with shared lane evidence.',
        );
      }
      return { snapshot, events, receipts };
    }
    snapshot.issue_progress[String(supervisor.issue_number)] = progress;
    lane.retry_count = progress.retry_count;
    terminalize(snapshot, identity, supervisor.status, supervisor.blockers);
    appendEvent(
      events,
      snapshot.lane_id,
      'supervisor.blocked',
      String(supervisor.issue_number),
      { status: supervisor.status },
    );
  }
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  return { snapshot, events, receipts };
};
