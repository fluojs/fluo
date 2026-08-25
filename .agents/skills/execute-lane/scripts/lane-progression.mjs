import { assertBlockerReconciliation } from '../../issue-to-pr/scripts/contracts.mjs';
import {
  appendEvent,
  cleanupReceipts,
  progressFor,
  rootSyncReceipt,
  setRootStatus,
  terminalize,
} from './transition-application.mjs';
import {
  cleanupSucceeded,
  requireSha,
  rootSyncObservation,
} from './transition-contracts.mjs';
import { dependencyGate } from './dependency-gate.mjs';

export const unmetDependencies = (_scenario, snapshot, identity) =>
  dependencyGate(snapshot, identity.issue_number).unsatisfied_dependencies;

export const parkReleaseHandoff = (snapshot, identity, events) => {
  const lane = snapshot.lanes[identity.lane_index];
  const siblingIsActive = snapshot.lanes.some(
    (candidate, index) =>
      index !== identity.lane_index &&
      ['queued', 'running', 'in_review', 'merged'].includes(candidate.status),
  );
  setRootStatus(
    snapshot,
    siblingIsActive ? 'running' : 'blocked-maintainer-decision',
  );
  Object.assign(lane, {
    status: 'blocked-maintainer-decision',
    current_issue: null,
    branch: null,
    worktree: null,
    pr: null,
  });
  snapshot.issue_progress[String(identity.issue_number)] = {
    status: 'blocked-maintainer-decision',
    branch: null,
    worktree: null,
    pr: null,
    verification: 'release handoff requires an explicit maintainer decision',
    retry_count: 0,
    blockers: [
      {
        reviewer: 'contract',
        signature: 'release:maintainer:decision',
        evidence: `issue ${String(identity.issue_number)} is a release handoff`,
        fix_back_eligible: false,
        status: 'unresolved',
      },
    ],
  };
  appendEvent(events, identity.lane_id, 'release.parked', identity.lane_id, {
    issue_number: identity.issue_number,
  });
};

export const applyFix = (step, snapshot, identity, events) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  try {
    assertBlockerReconciliation(
      progress.blockers,
      step.addressed_blockers,
      [],
    );
  } catch {
    terminalize(snapshot, identity, 'blocked-child-contract-error');
    appendEvent(events, identity.lane_id, 'fix.malformed', identity.pr_url, {});
    return;
  }
  const newHead = requireSha(step.new_head, 'fix.new_head');
  if (newHead === identity.head_sha) {
    terminalize(snapshot, identity, 'blocked-budget-exhausted');
    appendEvent(events, identity.lane_id, 'fix.noprogress', identity.pr_url, {
      head_sha: identity.head_sha,
    });
    return;
  }
  progress.blockers = step.addressed_blockers;
  identity.head_sha = newHead;
  progress.head_sha = newHead;
  progress.status = 'in_review';
  progress.retry_count += 1;
  lane.status = 'in_review';
  lane.retry_count = progress.retry_count;
  appendEvent(events, identity.lane_id, 'fix.completed', identity.pr_url, {
    head_sha: newHead,
  });
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

export const applyCleanup = (
  step,
  snapshot,
  identity,
  receipts,
  events,
) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  const authorized =
    snapshot.authority_scope.cleanup_command_worktrees === true;
  const succeeded = authorized ? cleanupSucceeded(step, identity) : true;
  if (succeeded) {
    progress.status = 'done';
    progress.cleanup = authorized
      ? {
          status: 'done',
          worktree_removed: true,
          local_branch_deleted: true,
          remote_branch_deleted: true,
        }
      : { status: 'skipped-authority' };
    advanceLane(snapshot, lane);
    receipts.push(
      ...cleanupReceipts(identity, authorized ? 'succeeded' : 'skipped'),
    );
    appendEvent(events, identity.lane_id, 'cleanup.observed', identity.lane_id, {
      status: progress.cleanup.status,
    });
    return;
  }
  progress.status = 'blocked-terminal';
  progress.blockers = [
    {
      reviewer: 'verification',
      signature: 'cleanup:observed:incomplete',
      evidence: identity.worktree,
      fix_back_eligible: false,
      status: 'unresolved',
    },
  ];
  terminalize(snapshot, identity, 'blocked-terminal', progress.blockers);
  snapshot.root_main_sync = { status: 'blocked-dirty', sha: null };
  appendEvent(events, identity.lane_id, 'cleanup.blocked', identity.lane_id, {
    status: 'blocked-terminal',
  });
};

export const applyRootSync = (
  step,
  snapshot,
  identity,
  receipts,
  events,
) => {
  const authorized = snapshot.authority_scope.root_main_sync_ff_only === true;
  const progress = progressFor(snapshot, identity);
  const syncedSha = authorized
    ? rootSyncObservation(step, snapshot, progress.merge_commit)
    : progress.merge_commit;
  snapshot.root_main_sync = {
    status: authorized ? 'done' : 'skipped-authority',
    sha: authorized ? syncedSha : null,
  };
  setRootStatus(snapshot, 'done');
  receipts.push(
    rootSyncReceipt(
      identity,
      snapshot.base_branch,
      syncedSha,
      authorized ? 'succeeded' : 'skipped',
    ),
  );
  appendEvent(events, identity.lane_id, 'root.sync', snapshot.base_branch, {
    status: snapshot.root_main_sync.status,
    sha: snapshot.root_main_sync.sha,
  });
};
