import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  applyCleanup,
  applyFix,
  applyRootSync,
  parkReleaseHandoff,
  unmetDependencies,
} from './lane-progression.mjs';
import {
  applyReview,
  appendEvent,
  initialiseExecution,
  progressFor,
  setRootStatus,
  terminalize,
} from './transition-application.mjs';
import {
  identityFrom,
  requireRecord,
  resumeMatches,
} from './transition-contracts.mjs';

const terminalStatuses = new Set([
  'done',
  'needs-human-check-terminal',
  'blocked-budget-exhausted',
  'blocked-maintainer-decision',
  'blocked-child-contract-error',
  'blocked-ledger-conflict',
  'blocked-terminal',
]);

const resultFrom = (
  identity,
  snapshot,
  events,
  receipts,
  status = snapshot.status,
) => ({
  lane_id: identity.lane_id,
  issue_number: identity.issue_number,
  branch: identity.branch,
  worktree: identity.worktree,
  pr_number: identity.pr_number,
  pr_url: identity.pr_url,
  head_sha: identity.head_sha,
  status,
  merge_count: receipts.filter(
    (item) =>
      item.side_effect === 'pr.merge' && item.status === 'succeeded',
  ).length,
  events,
  receipts,
  snapshot,
});

const validateResult = (result) => {
  assertContract('lane-ledger-v2', result.snapshot);
  validateLedger('lane-ledger-v2', result.snapshot);
  assertEventChain(result.events);
  return result;
};

export const runReplay = (input, persisted) => {
  const scenario = requireRecord(input, 'scenario');
  const snapshot = structuredClone(persisted.snapshot);
  const events = structuredClone(persisted.events);
  const receipts = structuredClone(persisted.receipts);
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  const identity = identityFrom(scenario, snapshot);

  if (identity.conflict) {
    terminalize(snapshot, identity, 'blocked-ledger-conflict');
    appendEvent(events, identity.lane_id, 'resume.conflict', identity.pr_url, {
      branch: identity.branch,
      pr_url: identity.pr_url,
    });
    return validateResult(resultFrom(identity, snapshot, events, receipts));
  }
  const unmet = unmetDependencies(scenario, snapshot, identity);
  if (unmet.length > 0) {
    appendEvent(events, identity.lane_id, 'dependency.waiting', identity.lane_id, {
      issue_number: identity.issue_number,
      unmet,
    });
    return validateResult(
      resultFrom(identity, snapshot, events, receipts, 'dependency-blocked'),
    );
  }
  if (snapshot.release_handoffs.includes(identity.issue_number)) {
    parkReleaseHandoff(snapshot, identity, events);
    return validateResult(resultFrom(identity, snapshot, events, receipts));
  }

  initialiseExecution(snapshot, identity, events);
  const steps = scenario.steps;
  if (!Array.isArray(steps) || steps.length !== 1) {
    throw new TypeError('runReplay requires exactly one persisted transition.');
  }
  const step = requireRecord(steps[0], 'scenario step');
  if (!terminalStatuses.has(snapshot.status)) {
    if (step.kind === 'interrupt') {
      appendEvent(events, identity.lane_id, 'lane.interrupted', identity.lane_id, {
        head_sha: identity.head_sha,
      });
    } else if (step.kind === 'malformed-review') {
      terminalize(snapshot, identity, 'blocked-child-contract-error');
      appendEvent(events, identity.lane_id, 'review.malformed', identity.pr_url, {});
    } else if (step.kind === 'resume') {
      if (!resumeMatches(step, identity)) {
        terminalize(snapshot, identity, 'blocked-ledger-conflict');
      }
      appendEvent(events, identity.lane_id, 'resume.reconciled', identity.pr_url, {
        matched: snapshot.status !== 'blocked-ledger-conflict',
        head_sha: identity.head_sha,
      });
    } else if (step.kind === 'review') {
      applyReview(step, snapshot, identity, receipts, events);
    } else {
      const lane = snapshot.lanes[identity.lane_index];
      const progress = progressFor(snapshot, identity);
      if (step.kind === 'fix' && progress.status === 'running') {
        applyFix(step, snapshot, identity, events);
      } else if (step.kind === 'cleanup' && progress.status === 'merged') {
        applyCleanup(step, snapshot, identity, receipts, events);
      } else if (
        step.kind === 'root-sync' &&
        snapshot.lanes.every(
          (candidate) =>
            candidate.status === 'done' ||
            terminalStatuses.has(candidate.status),
        )
      ) {
        const blockedLane = snapshot.lanes.find(
          (candidate) => candidate.status !== 'done',
        );
        if (blockedLane === undefined) {
          applyRootSync(step, snapshot, identity, receipts, events);
        } else {
          setRootStatus(snapshot, blockedLane.status);
          appendEvent(
            events,
            identity.lane_id,
            'root.blocked',
            snapshot.base_branch,
            { lane_status: blockedLane.status },
          );
        }
      } else {
        terminalize(snapshot, identity, 'blocked-child-contract-error');
        appendEvent(events, identity.lane_id, 'step.invalid', identity.lane_id, {
          kind: step.kind,
        });
      }
      if (lane.status === 'queued') {
        snapshot.status = 'running';
        snapshot.execution.status = 'running';
      }
    }
  }
  return validateResult(resultFrom(identity, snapshot, events, receipts));
};

export const runLaneBatch = (entries) => {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array.');
  }
  return entries.map(({ scenario, persisted }) =>
    runReplay(scenario, persisted),
  );
};
