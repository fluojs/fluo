import {
  assertContract,
  assertEventChain,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  assertDagBindingMatches,
  createDagBinding,
  loadDagBinding,
  persistDagBinding,
} from './dag-binding.mjs';
import { appendEvent } from './transition-application.mjs';

const dispatchIntentFor = (events, laneId) => {
  if (events.length > 0) {
    assertEventChain(events);
  }
  const intents = events.filter(
    (event) =>
      event.event_type === 'lane.dag.dispatch.intent' &&
      event.subject_id === laneId,
  );
  if (intents.length > 1) {
    throw new TypeError(`lane ${laneId} has conflicting DAG dispatch intents.`);
  }
  return intents[0] ?? null;
};

const prepareLaneSupervisorDispatch = (persisted, definition) => {
  const snapshot = structuredClone(persisted.snapshot);
  const events = structuredClone(persisted.events);
  const receipts = structuredClone(persisted.receipts);
  assertContract('lane-ledger-v2', snapshot);
  validateLedger('lane-ledger-v2', snapshot);
  if (
    definition.key !==
    `fluo:lane:${snapshot.lane_id}:issue-supervisors:v2`
  ) {
    throw new TypeError('Lane DAG definition key is not canonical.');
  }
  appendEvent(
    events,
    snapshot.lane_id,
    'lane.dag.dispatch.intent',
    snapshot.lane_id,
    { dag_key: definition.key },
  );
  assertEventChain(events);
  return {
    snapshot,
    events,
    receipts,
    dispatch_event_hash: events.at(-1).event_hash,
  };
};

export const reconcileLaneSupervisorDispatch = ({
  persisted,
  runtime_root,
  definition,
}) => {
  assertContract('lane-ledger-v2', persisted.snapshot);
  validateLedger('lane-ledger-v2', persisted.snapshot);
  const laneId = persisted.snapshot.lane_id;
  const intent = dispatchIntentFor(persisted.events, laneId);
  const binding = loadDagBinding(runtime_root, laneId);
  if (binding !== null) {
    if (intent === null) {
      return {
        action: 'blocked-ledger-conflict',
        reason: 'lane DAG binding exists without dispatch intent',
      };
    }
    assertDagBindingMatches(binding, {
      definition,
      lane_id: laneId,
      run_id: binding.run_id,
      dispatch_event_hash: intent.event_hash,
    });
    return { action: 'attach', run_id: binding.run_id, binding };
  }
  if (intent !== null) {
    return {
      action: 'blocked-ledger-conflict',
      reason: 'dispatch intent exists without lane DAG binding',
    };
  }
  const prepared = prepareLaneSupervisorDispatch(persisted, definition);
  return {
    action: 'persist-intent',
    persisted: prepared,
    dispatch_event_hash: prepared.dispatch_event_hash,
  };
};

export const attachLaneSupervisorRun = ({
  persisted,
  runtime_root,
  definition,
  run_id,
}) => {
  assertContract('lane-ledger-v2', persisted.snapshot);
  validateLedger('lane-ledger-v2', persisted.snapshot);
  const laneId = persisted.snapshot.lane_id;
  const intent = dispatchIntentFor(persisted.events, laneId);
  if (intent === null) {
    throw new TypeError(`lane ${laneId} has no DAG dispatch intent.`);
  }
  const existing = loadDagBinding(runtime_root, laneId);
  if (existing !== null) {
    assertDagBindingMatches(existing, {
      definition,
      lane_id: laneId,
      run_id,
      dispatch_event_hash: intent.event_hash,
    });
    return existing;
  }
  const binding = createDagBinding({
    definition,
    lane_id: laneId,
    run_id,
    dispatch_event_hash: intent.event_hash,
  });
  persistDagBinding(runtime_root, binding);
  return binding;
};
