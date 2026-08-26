import { watch } from 'node:fs';
import { resolve } from 'node:path';

import { assertContract } from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  assertDagBindingMatches,
  createDagBinding,
  loadDagBinding,
  persistDagBinding,
} from './dag-binding.mjs';
import {
  dispatchDefinitionDigestFor,
  dispatchIntentFor,
  prepareLaneSupervisorDispatch,
} from './lane-dispatch-intent.mjs';
import { canonicalLaneRuntimeRoot } from './lane-runtime-paths.mjs';
import { loadLaneNativeDagRun } from './native-dag-run.mjs';

const assertNativeRunMatchesIntent = (
  intent,
  nativeRun,
  allowLegacyBinding,
) => {
  const expected = dispatchDefinitionDigestFor(intent);
  if (expected === null) {
    if (allowLegacyBinding) {
      return;
    }
    throw new TypeError(
      'legacy dispatch intent without a binding requires a successor lane.',
    );
  }
  if (expected !== nativeRun.definition_sha256) {
    throw new TypeError(
      'native DAG definition digest does not match the dispatch intent.',
    );
  }
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
  const binding = loadDagBinding(runtimeRoot, laneId);
  if (binding !== null) {
    if (intent === null) {
      return {
        action: 'blocked-ledger-conflict',
        reason: 'lane DAG binding exists without dispatch intent',
      };
    }
    const nativeRun = loadLaneNativeDagRun({
      repository_root,
      lane_id: laneId,
      run_id: binding.run_id,
    });
    assertNativeRunMatchesIntent(intent, nativeRun, true);
    assertDagBindingMatches(binding, {
      definition: nativeRun.definition,
      lane_id: laneId,
      run_id: binding.run_id,
      dispatch_event_hash: intent.event_hash,
    });
    return {
      action: 'attach',
      run_id: binding.run_id,
      binding,
      definition: nativeRun.definition,
    };
  }
  if (intent !== null) {
    const legacy = dispatchDefinitionDigestFor(intent) === null;
    return {
      action: 'blocked-ledger-conflict',
      reason: legacy
        ? 'legacy dispatch intent without a binding requires a successor lane'
        : 'dispatch intent exists without lane DAG binding',
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
  const existing = loadDagBinding(runtimeRoot, laneId);
  const nativeRun = loadLaneNativeDagRun({
    repository_root,
    lane_id: laneId,
    run_id,
  });
  assertNativeRunMatchesIntent(intent, nativeRun, existing !== null);
  if (existing !== null) {
    assertDagBindingMatches(existing, {
      definition: nativeRun.definition,
      lane_id: laneId,
      run_id,
      dispatch_event_hash: intent.event_hash,
    });
    return existing;
  }
  const binding = createDagBinding({
    definition: nativeRun.definition,
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
  timeout_ms = 30_000,
}) => {
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms <= 0) {
    throw new TypeError('timeout_ms must be a positive integer.');
  }
  const initial = reconcileLaneSupervisorDispatch({
    persisted,
    repository_root,
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
