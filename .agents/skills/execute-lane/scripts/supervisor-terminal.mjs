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
import { parkReleaseHandoff } from './lane-progression.mjs';
import { assertReleaseHandoffBinding } from './release-handoff-approval.mjs';

const terminalStatuses = new Set([
  'done',
  'needs-human-check-terminal',
  'blocked-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
]);

const laneFor = (snapshot, issueNumber) => {
  const laneIndex = snapshot.lanes.findIndex((lane) =>
    lane.queue.includes(issueNumber),
  );
  if (laneIndex === -1) {
    throw new TypeError('supervisor issue is not assigned to a lane.');
  }
  return { lane: snapshot.lanes[laneIndex], laneIndex };
};

const advanceLane = (snapshot, lane) => {
  const nextIssue = lane.queue.find(
    (issue) => !snapshot.completed_issues.includes(issue),
  );
  Object.assign(lane, {
    status: nextIssue === undefined ? 'done' : 'queued',
    current_issue: nextIssue ?? null,
    branch: null,
    worktree: null,
    pr: null,
    retry_count: 0,
  });
};

const identityFromSupervisor = (snapshot, supervisor, laneIndex) => ({
  lane_id: snapshot.lane_id,
  lane_index: laneIndex,
  issue_number: supervisor.issue_number,
  branch: supervisor.branch,
  worktree: supervisor.worktree,
  pr_number: supervisor.pr?.number ?? null,
  pr_url: supervisor.pr?.url ?? null,
  head_sha: supervisor.head_sha,
});

const completedProgress = (supervisor) => ({
  status: 'done',
  branch: supervisor.branch,
  worktree: supervisor.worktree,
  pr: supervisor.pr.url,
  head_sha: supervisor.head_sha,
  verification: supervisor.verification,
  retry_count: supervisor.attempt,
  blockers: supervisor.blockers,
  review_verdict: 'merge',
  checks: 'PASS',
  reviewers: supervisor.local_review.reviewers,
  reviewed_head: supervisor.local_review.head_sha,
  commits: [supervisor.head_sha],
  merge_commit: supervisor.merge.commit_sha,
  issue_state: 'CLOSED',
  cleanup: supervisor.authority_scope.cleanup_command_worktrees
    ? {
        status: 'done',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      }
    : { status: 'skipped-authority' },
});

const blockedProgress = (supervisor) => ({
  status: supervisor.status,
  branch: supervisor.branch,
  worktree: supervisor.worktree,
  pr: supervisor.pr?.url ?? null,
  head_sha: supervisor.head_sha,
  verification: supervisor.verification,
  retry_count: supervisor.attempt,
  blockers: supervisor.blockers,
});

const assertLiveCompletion = (supervisor, live) => {
  const expected = {
    issue_number: supervisor.issue_number,
    issue_url: `https://github.com/fluojs/fluo/issues/${String(supervisor.issue_number)}`,
    pr_number: supervisor.pr.number,
    pr_url: supervisor.pr.url,
    branch: supervisor.branch,
    worktree: supervisor.worktree,
    reviewed_head_sha: supervisor.head_sha,
    remote_head_sha: supervisor.head_sha,
    pr_head_sha: supervisor.head_sha,
    ci_head_sha: supervisor.head_sha,
    merge_commit_sha: supervisor.merge.commit_sha,
    merge_method: 'squash',
    pr_state: 'MERGED',
    issue_state: 'CLOSED',
    cleanup_status: supervisor.authority_scope.cleanup_command_worktrees
      ? 'done'
      : 'skipped-authority',
  };
  if (supervisor.authority_scope.cleanup_command_worktrees) {
    Object.assign(expected, {
      worktree_removed: true,
      local_branch_deleted: true,
      remote_branch_deleted: true,
    });
  }
  const actualKeys = Object.keys(live ?? {}).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError('supervisor live completion contains unexpected fields.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (live?.[key] !== value) {
      throw new TypeError(`supervisor live completion mismatch: ${key}.`);
    }
  }
};

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
  const unmet = (
    snapshot.dependency_graph[String(supervisor.issue_number)] ?? []
  ).filter((issue) => !snapshot.completed_issues.includes(issue));
  if (unmet.length > 0) {
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
