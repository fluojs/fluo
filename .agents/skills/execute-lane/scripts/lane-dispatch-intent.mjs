import {
  assertContract,
  assertEventChain,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import { appendEvent } from './transition-application.mjs';

export const dispatchIntentFor = (events, laneId) => {
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

export const dispatchDefinitionDigestFor = (intent) => {
  const digest = intent?.payload?.definition_sha256;
  if (digest === undefined) {
    return null;
  }
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new TypeError('dispatch definition digest is malformed.');
  }
  return digest;
};

export const prepareLaneSupervisorDispatch = (persisted, definition) => {
  if (
    typeof definition !== 'object' ||
    definition === null ||
    Array.isArray(definition)
  ) {
    throw new TypeError('compiled lane DAG definition is required.');
  }
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
    {
      dag_key: definition.key,
      definition_sha256: payloadDigest(definition),
    },
  );
  assertEventChain(events);
  return {
    snapshot,
    events,
    receipts,
    dispatch_event_hash: events.at(-1).event_hash,
  };
};
