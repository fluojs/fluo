import { assertEventChain } from '../../../workflow-contracts/contracts.mjs';
import {
  assertIssueDagBindingMatches,
  createIssueDagBinding,
  loadIssueDagBinding,
  persistIssueDagBinding,
} from './dag-binding.mjs';
import {
  dependencyGate,
  dispatchableIssueNumbers,
  prepareIssueSupervisorDispatch,
} from './dependency-gate.mjs';

const dispatchIntentFor = (events, issueNumber) => {
  if (events.length > 0) {
    assertEventChain(events);
  }
  const intents = events.filter(
    (event) =>
      event.event_type === 'supervisor.dispatch.intent' &&
      event.subject_id === String(issueNumber),
  );
  if (intents.length > 1) {
    throw new TypeError(
      `issue ${String(issueNumber)} has conflicting dispatch intents.`,
    );
  }
  return intents[0] ?? null;
};

export const reconcileIssueSupervisorDispatch = ({
  persisted,
  runtime_root,
  issue_number,
  definition,
}) => {
  const snapshot = persisted.snapshot;
  const intent = dispatchIntentFor(persisted.events, issue_number);
  const binding = loadIssueDagBinding(
    runtime_root,
    snapshot.lane_id,
    issue_number,
  );
  if (binding !== null) {
    if (intent === null) {
      return {
        action: 'blocked-ledger-conflict',
        reason: 'issue DAG binding exists without dispatch intent',
      };
    }
    assertIssueDagBindingMatches(binding, {
      definition,
      lane_id: snapshot.lane_id,
      issue_number,
      dependencies:
        snapshot.dependency_graph[String(issue_number)] ?? [],
      run_id: binding.run_id,
      dispatch_event_hash: intent.event_hash,
    });
    return { action: 'attach', run_id: binding.run_id, binding };
  }
  if (intent !== null) {
    return {
      action: 'blocked-ledger-conflict',
      reason: 'dispatch intent exists without issue DAG binding',
    };
  }
  const gate = dependencyGate(snapshot, issue_number);
  if (gate.status === 'blocked') {
    return { action: 'dependency-blocked', gate };
  }
  if (
    gate.status === 'waiting' ||
    !dispatchableIssueNumbers(snapshot).includes(issue_number)
  ) {
    return { action: 'wait', gate };
  }
  const prepared = prepareIssueSupervisorDispatch(persisted, issue_number);
  return {
    action: 'persist-intent',
    persisted: prepared,
    dispatch_event_hash: prepared.dispatch_event_hash,
  };
};

export const attachIssueSupervisorRun = ({
  persisted,
  runtime_root,
  issue_number,
  definition,
  run_id,
}) => {
  const snapshot = persisted.snapshot;
  const intent = dispatchIntentFor(persisted.events, issue_number);
  if (intent === null) {
    throw new TypeError(
      `issue ${String(issue_number)} has no dispatch intent.`,
    );
  }
  if (!dispatchableIssueNumbers(snapshot).includes(issue_number)) {
    throw new TypeError(
      `issue ${String(issue_number)} is no longer dispatchable.`,
    );
  }
  const dependencies =
    snapshot.dependency_graph[String(issue_number)] ?? [];
  const existing = loadIssueDagBinding(
    runtime_root,
    snapshot.lane_id,
    issue_number,
  );
  if (existing !== null) {
    assertIssueDagBindingMatches(existing, {
      definition,
      lane_id: snapshot.lane_id,
      issue_number,
      dependencies,
      run_id,
      dispatch_event_hash: intent.event_hash,
    });
    return existing;
  }
  const binding = createIssueDagBinding({
    definition,
    lane_id: snapshot.lane_id,
    issue_number,
    dependencies,
    run_id,
    dispatch_event_hash: intent.event_hash,
  });
  persistIssueDagBinding(runtime_root, binding);
  return binding;
};
