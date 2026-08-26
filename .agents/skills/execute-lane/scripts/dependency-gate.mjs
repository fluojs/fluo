import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import { isStrictRfc3339DateTime } from '../../../workflow-contracts/schema-validator.mjs';
import { terminalStatuses } from '../../../../tooling/governance/lane-ledger-contract.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  appendEvent,
  terminalize,
} from './transition-application.mjs';

const dependencySucceeded = (snapshot, issueNumber) =>
  snapshot.completed_issues.includes(issueNumber) &&
  snapshot.issue_progress[String(issueNumber)]?.status === 'done';

export const dependencyGate = (snapshot, issueNumber) => {
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  if (!snapshot.confirmed_issues.includes(issueNumber)) {
    throw new TypeError(
      `issue ${String(issueNumber)} is not confirmed by the lane.`,
    );
  }
  const dependencies = snapshot.dependency_graph[String(issueNumber)] ?? [];
  const unsatisfiedDependencies = dependencies.filter(
    (dependency) => !dependencySucceeded(snapshot, dependency),
  );
  const blocked = unsatisfiedDependencies.some((dependency) => {
    const status = snapshot.issue_progress[String(dependency)]?.status;
    return (
      status !== undefined &&
      status !== 'done' &&
      terminalStatuses.has(status)
    );
  });
  return {
    status:
      unsatisfiedDependencies.length === 0
        ? 'ready'
        : blocked
          ? 'blocked'
          : 'waiting',
    dependencies,
    unsatisfied_dependencies: unsatisfiedDependencies,
  };
};

export const dispatchableIssueNumbers = (snapshot) => {
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  return snapshot.confirmed_issues.filter((issueNumber) => {
    const lane = snapshot.lanes.find(
      (candidate) =>
        candidate.status === 'queued' &&
        candidate.current_issue === issueNumber,
    );
    return (
      lane !== undefined &&
      dependencyGate(snapshot, issueNumber).status === 'ready'
    );
  });
};

export const prepareIssueSupervisorDispatch = (persisted, issueNumber) => {
  const snapshot = structuredClone(persisted.snapshot);
  const events = structuredClone(persisted.events);
  const receipts = structuredClone(persisted.receipts);
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  if (events.length > 0) {
    assertEventChain(events);
  }
  if (
    events.some(
      (event) =>
        event.event_type === 'supervisor.dispatch.intent' &&
        event.subject_id === String(issueNumber),
    )
  ) {
    throw new TypeError(
      `issue ${String(issueNumber)} dispatch intent already exists.`,
    );
  }
  if (!dispatchableIssueNumbers(snapshot).includes(issueNumber)) {
    throw new TypeError(
      `issue ${String(issueNumber)} dependency gate is not ready.`,
    );
  }
  const dependencies =
    snapshot.dependency_graph[String(issueNumber)] ?? [];
  appendEvent(
    events,
    snapshot.lane_id,
    'supervisor.dispatch.intent',
    String(issueNumber),
    { dependencies },
  );
  assertEventChain(events);
  return {
    snapshot,
    events,
    receipts,
    dispatch_event_hash: events.at(-1).event_hash,
  };
};

const artifactAbsenceFor = (observations, issueNumber) => {
  if (!Array.isArray(observations)) {
    throw new TypeError('Artifact absence observations must be an array.');
  }
  const observation = observations.find(
    (candidate) => candidate?.issue_number === issueNumber,
  );
  const absenceKeys = [
    'issue_store_absent',
    'local_branch_absent',
    'remote_branch_absent',
    'worktree_absent',
    'task_absent',
    'pr_absent',
  ];
  if (
    observation === undefined ||
    absenceKeys.some((key) => observation[key] !== true) ||
    typeof observation.observed_at !== 'string' ||
    !isStrictRfc3339DateTime(observation.observed_at)
  ) {
    throw new TypeError(
      `issue ${String(issueNumber)} artifact absence observation is missing.`,
    );
  }
  return observation;
};

export const terminalizeBlockedDependents = (
  persisted,
  artifactObservations,
) => {
  const snapshot = structuredClone(persisted.snapshot);
  const events = structuredClone(persisted.events);
  const receipts = structuredClone(persisted.receipts);
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [laneIndex, lane] of snapshot.lanes.entries()) {
      const issueNumber = lane.current_issue;
      if (lane.status !== 'queued' || issueNumber === null) {
        continue;
      }
      const gate = dependencyGate(snapshot, issueNumber);
      if (gate.status !== 'blocked') {
        continue;
      }
      const artifactAbsence = artifactAbsenceFor(
        artifactObservations,
        issueNumber,
      );
      const evidence = `dependencies ${gate.unsatisfied_dependencies.join(', ')} did not reach canonical done`;
      const blockers = [
        {
          reviewer: 'contract',
          signature: 'dependency:not-done',
          evidence,
          fix_back_eligible: false,
          status: 'unresolved',
        },
      ];
      snapshot.issue_progress[String(issueNumber)] = {
        status: 'blocked-terminal',
        verification: evidence,
        retry_count: 0,
        blockers,
      };
      terminalize(
        snapshot,
        {
          lane_id: snapshot.lane_id,
          lane_index: laneIndex,
          issue_number: issueNumber,
        },
        'blocked-terminal',
        blockers,
      );
      appendEvent(
        events,
        snapshot.lane_id,
        'dependency.blocked',
        String(issueNumber),
        {
          unsatisfied_dependencies: gate.unsatisfied_dependencies,
          artifact_absence: artifactAbsence,
        },
      );
      changed = true;
    }
  }
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  if (events.length > 0) {
    assertEventChain(events);
  }
  return { snapshot, events, receipts };
};
