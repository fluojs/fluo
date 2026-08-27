import {
  assertContract,
} from '../../../workflow-contracts/contracts.mjs';
import {
  validateLedger,
} from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  dependencyGate,
  dispatchableIssueNumbers,
} from './dependency-gate.mjs';
import {
  assertIssueDagState,
} from './issue-dag-contracts.mjs';

const activeStatuses = new Set([
  'dispatch-intent',
  'phase-running',
  'native-completed-unverified',
  'phase-settled',
  'amend-intent',
]);

const stateFor = (issueDags, issueNumber) => {
  const value = issueDags[String(issueNumber)] ?? null;
  if (value !== null) assertIssueDagState(value);
  return value;
};

export const planLaneCoordinator = ({
  lane,
  issue_dags: issueDags,
  max_active_issue_dags: capacity,
}) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  if (
    typeof issueDags !== 'object' ||
    issueDags === null ||
    Array.isArray(issueDags) ||
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > 64
  ) {
    throw new TypeError('Issue DAG coordinator capacity is invalid.');
  }
  const active = lane.confirmed_issues.filter((issueNumber) => {
    const state = stateFor(issueDags, issueNumber);
    return state !== null && activeStatuses.has(state.status);
  });
  const ready = new Set(dispatchableIssueNumbers(lane));
  const blocked = [];
  const candidates = [];
  for (const issueNumber of lane.confirmed_issues) {
    const state = stateFor(issueDags, issueNumber);
    if (state !== null || lane.completed_issues.includes(issueNumber)) continue;
    const gate = dependencyGate(lane, issueNumber);
    if (gate.status === 'blocked') {
      blocked.push(issueNumber);
    } else if (ready.has(issueNumber)) {
      candidates.push(issueNumber);
    }
  }
  const slots = Math.max(0, capacity - active.length);
  const admit = candidates.slice(0, slots);
  const admitted = new Set(admit);
  const blockedSet = new Set(blocked);
  const activeSet = new Set(active);
  const waiting = lane.confirmed_issues.filter(
    (issueNumber) =>
      !lane.completed_issues.includes(issueNumber) &&
      !activeSet.has(issueNumber) &&
      !admitted.has(issueNumber) &&
      !blockedSet.has(issueNumber),
  );
  return {
    version: 3,
    lane_id: lane.lane_id,
    capacity,
    active_issue_numbers: active,
    admit_issue_numbers: admit,
    waiting_issue_numbers: waiting,
    blocked_issue_numbers: blocked,
  };
};

const nativeIdentity = (state, run) => {
  if (
    run.runKey !== state.dag_key ||
    run.parentSessionId !== state.coordinator_session_id ||
    (state.run_id !== null && run.runId !== state.run_id)
  ) {
    throw new TypeError('Issue DAG native run identity does not match.');
  }
  if (
    !Number.isSafeInteger(run.generation) ||
    run.generation < 1 ||
    !/^[a-f0-9]{64}$/u.test(run.definitionFingerprint ?? '')
  ) {
    throw new TypeError('Issue DAG native run evidence is invalid.');
  }
};

export const reconcileIssueDagRun = ({
  state,
  native_run: nativeRun,
}) => {
  assertIssueDagState(state);
  if (nativeRun === null) {
    if (state.status === 'dispatch-intent') {
      return {
        action: 'start',
        definition: state.current_definition,
      };
    }
    throw new TypeError('Issue DAG bound native run is missing.');
  }
  nativeIdentity(state, nativeRun);
  if (state.status === 'dispatch-intent') {
    return {
      action: 'attach-run',
      run_id: nativeRun.runId,
      definition_fingerprint: nativeRun.definitionFingerprint,
      native_generation: nativeRun.generation,
    };
  }
  if (state.status === 'amend-intent') {
    if (
      nativeRun.generation === state.native_generation &&
      nativeRun.definitionFingerprint === state.definition_fingerprint
    ) {
      return {
        action: 'amend',
        run_id: state.run_id,
        definition: state.pending_amendment.definition,
      };
    }
    if (nativeRun.generation === state.native_generation + 1) {
      const amendment = nativeRun.amendments?.at(-1);
      const pending = state.pending_amendment;
      if (
        amendment?.previous_fingerprint !==
          pending.base_definition_fingerprint ||
        amendment.fingerprint !== nativeRun.definitionFingerprint ||
        amendment.definition_sha256 !== pending.definition_sha256 ||
        JSON.stringify(amendment.added_node_ids) !==
          JSON.stringify(pending.added_node_ids) ||
        amendment.changed_node_ids?.length !== 0 ||
        amendment.invalidated_node_ids?.length !== 0
      ) {
        throw new TypeError(
          'Issue DAG native amendment event does not match intent.',
        );
      }
      return {
        action: 'attach-amendment',
        run_id: state.run_id,
        definition_fingerprint: nativeRun.definitionFingerprint,
        native_generation: nativeRun.generation,
        amendment,
      };
    }
    throw new TypeError('Issue DAG amendment recovery evidence conflicts.');
  }
  if (
    nativeRun.definitionFingerprint !== state.definition_fingerprint ||
    nativeRun.generation !== state.native_generation
  ) {
    throw new TypeError('Issue DAG native definition identity does not match.');
  }
  if (state.status === 'phase-running') {
    if (nativeRun.status === 'running') {
      return { action: 'wait', run_id: state.run_id };
    }
    if (nativeRun.status === 'completed') {
      return {
        action: 'record-native-completion',
        run_id: state.run_id,
        node_ids: state.active_node_ids,
      };
    }
    return {
      action: 'recover-nodes',
      run_id: state.run_id,
      node_ids: state.active_node_ids,
    };
  }
  if (state.status === 'native-completed-unverified') {
    return {
      action: 'verify-phase',
      run_id: state.run_id,
      node_ids: state.active_node_ids,
    };
  }
  if (state.status === 'phase-settled') {
    return { action: 'plan-next', run_id: state.run_id };
  }
  return { action: 'terminal', run_id: state.run_id };
};
