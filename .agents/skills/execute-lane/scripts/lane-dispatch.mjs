import { watch } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertContract,
  assertEventChain,
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  assertDagBindingMatches,
  createDagBinding,
  loadDagBinding,
  persistDagBinding,
} from './dag-binding.mjs';
import { canonicalLaneRuntimeRoot } from './lane-runtime-paths.mjs';
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

const assertDispatchDefinition = (intent, definition) => {
  const expected = intent?.payload?.definition_sha256;
  if (expected === undefined) {
    return;
  }
  if (
    typeof expected !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(expected) ||
    expected !== payloadDigest(definition)
  ) {
    throw new TypeError(
      'dispatch definition digest does not match the compiled definition.',
    );
  }
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

export const reconcileLaneSupervisorDispatch = ({
  persisted,
  repository_root,
  definition,
}) => {
  assertContract('lane-ledger-v2', persisted.snapshot);
  validateLedger('lane-ledger-v2', persisted.snapshot);
  const laneId = persisted.snapshot.lane_id;
  const runtimeRoot = canonicalLaneRuntimeRoot(repository_root);
  const intent = dispatchIntentFor(persisted.events, laneId);
  assertDispatchDefinition(intent, definition);
  const binding = loadDagBinding(runtimeRoot, laneId);
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
  repository_root,
  definition,
  run_id,
}) => {
  assertContract('lane-ledger-v2', persisted.snapshot);
  validateLedger('lane-ledger-v2', persisted.snapshot);
  const laneId = persisted.snapshot.lane_id;
  const runtimeRoot = canonicalLaneRuntimeRoot(repository_root);
  const intent = dispatchIntentFor(persisted.events, laneId);
  if (intent === null) {
    throw new TypeError(`lane ${laneId} has no DAG dispatch intent.`);
  }
  assertDispatchDefinition(intent, definition);
  const existing = loadDagBinding(runtimeRoot, laneId);
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
  persistDagBinding(runtimeRoot, binding);
  return binding;
};

const missingBindingCrashWindow = (result) =>
  result.action === 'blocked-ledger-conflict' &&
  result.reason === 'dispatch intent exists without lane DAG binding';

export const awaitLaneSupervisorDispatch = ({
  persisted,
  repository_root,
  definition,
  timeout_ms = 30_000,
}) => {
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms <= 0) {
    throw new TypeError('timeout_ms must be a positive integer.');
  }
  const initial = reconcileLaneSupervisorDispatch({
    persisted,
    repository_root,
    definition,
  });
  if (initial.action === 'attach') {
    return Promise.resolve(initial);
  }
  if (!missingBindingCrashWindow(initial)) {
    throw new TypeError(
      initial.reason ?? 'lane supervisor dispatch is not attachable.',
    );
  }

  const runtimeRoot = canonicalLaneRuntimeRoot(repository_root);
  const laneDirectory = resolve(runtimeRoot, persisted.snapshot.lane_id);
  return new Promise((resolveWait, rejectWait) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      watcher.close();
      callback(value);
    };
    const inspect = () => {
      try {
        const current = reconcileLaneSupervisorDispatch({
          persisted,
          repository_root,
          definition,
        });
        if (current.action === 'attach') {
          finish(resolveWait, current);
        } else if (!missingBindingCrashWindow(current)) {
          finish(
            rejectWait,
            new TypeError(
              current.reason ??
                'lane supervisor dispatch became non-attachable.',
            ),
          );
        }
      } catch (error) {
        finish(rejectWait, error);
      }
    };
    const watcher = watch(
      laneDirectory,
      { persistent: false },
      (_eventType, filename) => {
        if (
          filename === null ||
          String(filename) === 'dag-binding.json'
        ) {
          inspect();
        }
      },
    );
    watcher.on('error', (error) => {
      finish(rejectWait, error);
    });
    const timeout = setTimeout(() => {
      inspect();
      if (!settled) {
        finish(
          rejectWait,
          new TypeError(
            `lane ${persisted.snapshot.lane_id} DAG binding did not appear before the startup deadline.`,
          ),
        );
      }
    }, timeout_ms);
    inspect();
  });
};
