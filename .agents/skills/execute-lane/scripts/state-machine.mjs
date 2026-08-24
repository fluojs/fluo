import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  applyReview,
  appendEvent,
  cleanupReceipts,
  initialiseExecution,
  progressFor,
  rootSyncReceipt,
  setRootStatus,
  terminalize,
} from './transition-application.mjs';
import {
  cleanupSucceeded,
  identityFrom,
  requireRecord,
  requireSha,
  resumeMatches,
  rootSyncObservation,
} from './transition-contracts.mjs';

const terminalStatuses = new Set([
  'done',
  'needs-human-check-terminal',
  'blocked-budget-exhausted',
  'blocked-child-contract-error',
  'blocked-ledger-conflict',
  'blocked-terminal',
]);

const applyFix = (step, snapshot, identity, events) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  const newHead = requireSha(step.new_head, 'fix.new_head');
  const unresolved = progress.blockers
    .filter((blocker) => blocker.status === 'unresolved')
    .map((blocker) => blocker.signature);
  if (
    !Array.isArray(step.addressed_blockers) ||
    step.addressed_blockers.length !== unresolved.length ||
    !unresolved.every((signature) =>
      step.addressed_blockers.includes(signature),
    ) ||
    newHead === identity.head_sha
  ) {
    terminalize(snapshot, identity, 'blocked-budget-exhausted');
    appendEvent(events, identity.lane_id, 'fix.noprogress', identity.pr_url, {
      head_sha: identity.head_sha,
    });
    return;
  }
  progress.blockers = progress.blockers.map((blocker) => ({
    ...blocker,
    status: 'remediated',
  }));
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

const applyCleanup = (step, snapshot, identity, receipts, events) => {
  const lane = snapshot.lanes[identity.lane_index];
  const progress = progressFor(snapshot, identity);
  if (cleanupSucceeded(step, identity)) {
    Object.assign(progress, {
      status: 'done',
      cleanup: {
        status: 'done',
        worktree_removed: true,
        local_branch_deleted: true,
        remote_branch_deleted: true,
      },
    });
    Object.assign(lane, {
      status: 'done',
      current_issue: null,
      branch: null,
      worktree: null,
      pr: null,
      retry_count: 0,
    });
    receipts.push(...cleanupReceipts(identity));
    appendEvent(events, identity.lane_id, 'cleanup.observed', identity.lane_id, {
      status: 'done',
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

const applyRootSync = (step, snapshot, identity, receipts, events) => {
  const progress = progressFor(snapshot, identity);
  const syncedSha = rootSyncObservation(
    step,
    snapshot,
    progress.merge_commit,
  );
  snapshot.root_main_sync = { status: 'done', sha: syncedSha };
  setRootStatus(snapshot, 'done');
  receipts.push(rootSyncReceipt(identity, snapshot.base_branch, syncedSha));
  appendEvent(events, identity.lane_id, 'root.sync', snapshot.base_branch, {
    sha: syncedSha,
  });
};

export const runReplay = (input, persisted) => {
  const scenario = requireRecord(input, 'scenario');
  const snapshot = structuredClone(persisted.snapshot);
  const events = structuredClone(persisted.events);
  const receipts = structuredClone(persisted.receipts);
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  const identity = identityFrom(scenario, snapshot);
  initialiseExecution(snapshot, identity, events);
  const steps = scenario.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError('scenario.steps must be a non-empty array.');
  }
  let interrupted = false;

  for (const rawStep of steps) {
    if (terminalStatuses.has(snapshot.status)) {
      break;
    }
    const step = requireRecord(rawStep, 'scenario step');
    if (step.kind === 'interrupt') {
      appendEvent(events, identity.lane_id, 'lane.interrupted', identity.lane_id, {
        head_sha: identity.head_sha,
      });
      interrupted = true;
      break;
    }
    if (step.kind === 'malformed-review') {
      terminalize(snapshot, identity, 'blocked-child-contract-error');
      appendEvent(events, identity.lane_id, 'review.malformed', identity.pr_url, {});
      continue;
    }
    if (step.kind === 'resume') {
      if (!resumeMatches(step, identity)) {
        terminalize(snapshot, identity, 'blocked-ledger-conflict');
      }
      appendEvent(events, identity.lane_id, 'resume.reconciled', identity.pr_url, {
        matched: snapshot.status !== 'blocked-ledger-conflict',
        head_sha: identity.head_sha,
      });
      continue;
    }
    if (step.kind === 'review') {
      applyReview(step, snapshot, identity, receipts, events);
      continue;
    }
    const lane = snapshot.lanes[identity.lane_index];
    const progress = progressFor(snapshot, identity);
    if (step.kind === 'fix' && progress.status === 'running') {
      applyFix(step, snapshot, identity, events);
      continue;
    }
    if (step.kind === 'cleanup' && progress.status === 'merged') {
      applyCleanup(step, snapshot, identity, receipts, events);
      continue;
    }
    if (
      step.kind === 'root-sync' &&
      snapshot.lanes.every((candidate) => candidate.status === 'done')
    ) {
      applyRootSync(step, snapshot, identity, receipts, events);
      continue;
    }
    terminalize(snapshot, identity, 'blocked-child-contract-error');
    appendEvent(events, identity.lane_id, 'step.invalid', identity.lane_id, {
      kind: step.kind,
    });
  }

  if (!interrupted) {
    const progress = progressFor(snapshot, identity);
    if (
      !terminalStatuses.has(snapshot.status) &&
      progress.status === 'running'
    ) {
      terminalize(snapshot, identity, 'blocked-budget-exhausted');
      appendEvent(events, identity.lane_id, 'lane.terminal', identity.lane_id, {
        status: snapshot.status,
      });
    }
  }
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  assertEventChain(events);
  return {
    lane_id: identity.lane_id,
    issue_number: identity.issue_number,
    branch: identity.branch,
    worktree: identity.worktree,
    pr_number: identity.pr_number,
    pr_url: identity.pr_url,
    head_sha: identity.head_sha,
    status: snapshot.status,
    merge_count: receipts.filter(
      (item) =>
        item.side_effect === 'pr.merge' && item.status === 'succeeded',
    ).length,
    events,
    receipts,
    snapshot,
  };
};

export const runLaneBatch = (entries) => {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array.');
  }
  return entries.map(({ scenario, persisted }) =>
    runReplay(scenario, persisted),
  );
};
