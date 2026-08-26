import { assertContract, payloadDigest } from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  appendEvent,
  cleanupReceipts,
  mergeReceipt,
  setRootStatus,
  terminalize,
} from './transition-application.mjs';
import {
  assertIssueSupervisorState,
  issueSupervisorTerminalStatuses,
} from './issue-supervisor-contracts.mjs';
import {
  assertIssueSupervisorBundle,
  readIssueSupervisorStore,
} from './issue-supervisor-store.mjs';
import { canonicalLaneRuntimeRoot } from './lane-runtime-paths.mjs';
import { dependencyGate } from './dependency-gate.mjs';
import { parkReleaseHandoff } from './lane-progression.mjs';
import { assertReleaseHandoffBinding } from './release-handoff-approval.mjs';
import { assertCanonicalOriginBranchAbsent } from './trusted-evidence.mjs';
import {
  advanceLane,
  assertLiveCompletion,
  blockedProgress,
  completedProgress,
  identityFromSupervisor,
  laneFor,
} from './supervisor-terminal-evidence.mjs';

const terminalStatuses = new Set(issueSupervisorTerminalStatuses);

export const importSupervisorTerminal = (
  persisted,
  supervisorTransport,
  liveCompletion = null,
  releaseHandoffContext = null,
  trustedOptions = {},
) => {
  const repositoryRoot = trustedOptions.repository_root;
  const laneId = persisted?.snapshot?.lane_id;
  const issueNumber = supervisorTransport?.snapshot?.issue_number;
  if (
    typeof repositoryRoot !== 'string' ||
    typeof laneId !== 'string' ||
    !Number.isSafeInteger(issueNumber)
  ) {
    throw new TypeError('supervisor terminal trusted repository and transport identity are invalid.');
  }
  const supervisorBundle = readIssueSupervisorStore(
    canonicalLaneRuntimeRoot(repositoryRoot),
    laneId,
    issueNumber,
    {
      allow_untracked: true,
      command_runner: trustedOptions.command_runner,
    },
  );
  if (supervisorBundle === null) {
    throw new TypeError('supervisor terminal canonical issue store is missing.');
  }
  assertIssueSupervisorBundle(supervisorBundle);
  if (payloadDigest(supervisorTransport) !== payloadDigest(supervisorBundle)) {
    throw new TypeError('supervisor terminal transport is forged or stale relative to the canonical issue store.');
  }
  const { state: supervisor } = assertIssueSupervisorState(supervisorBundle.snapshot);
  const importedBundleSha256 = payloadDigest(supervisorTransport);
  const terminalEventHash =
    supervisorBundle.events.at(-1)?.event_hash ?? null;
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
    if (supervisor.authority_scope.cleanup_command_worktrees) {
      assertCanonicalOriginBranchAbsent({
        repository_root: repositoryRoot,
        branch: supervisor.branch,
        command_runner: trustedOptions.command_runner,
      });
    }
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
    const importedReceipts = [
      mergeReceipt(identity),
      ...cleanupReceipts(
        identity,
        supervisor.authority_scope.cleanup_command_worktrees
          ? 'succeeded'
          : 'skipped',
      ),
    ];
    receipts.push(...importedReceipts);
    appendEvent(
      events,
      snapshot.lane_id,
      'supervisor.completed',
      String(supervisor.issue_number),
      {
        head_sha: supervisor.head_sha,
        merge_commit_sha: supervisor.merge.commit_sha,
        imported_bundle_sha256: importedBundleSha256,
        terminal_event_hash: terminalEventHash,
        receipt_ids: importedReceipts.map(
          (receiptValue) => receiptValue.receipt_id,
        ),
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
      {
        status: supervisor.status,
        imported_bundle_sha256: importedBundleSha256,
        terminal_event_hash: terminalEventHash,
        receipt_ids: [],
      },
    );
  }
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  return { snapshot, events, receipts };
};
