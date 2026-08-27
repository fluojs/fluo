import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  assertIssueDagBundle,
  canonicalIssueDagDefinition,
  eventForIssueDagState,
} from './issue-dag-contracts.mjs';
import {
  loadIssueDagRunBundle,
  persistIssueDagRunBundle,
} from './issue-dag-files.mjs';
import {
  attachIssueDagAmendment,
  prepareIssueDagAmendment,
  terminalizeIssueDagRun,
} from './issue-dag-amendment.mjs';

export {
  attachIssueDagAmendment,
  loadIssueDagRunBundle,
  persistIssueDagRunBundle,
  prepareIssueDagAmendment,
  terminalizeIssueDagRun,
};

const appendEvent = (bundle, kind, state, details = {}) => {
  const events = [
    ...bundle.events,
    eventForIssueDagState(bundle.events, kind, state, details),
  ];
  return assertIssueDagBundle({ state, events });
};

const requireNativeIdentity = (state, evidence) => {
  if (
    evidence.run_id !== state.run_id &&
    state.run_id !== null ||
    evidence.run_key !== state.dag_key ||
    evidence.parent_session_id !== state.coordinator_session_id
  ) {
    throw new TypeError('Issue DAG native run identity does not match.');
  }
  if (
    !Number.isSafeInteger(evidence.native_generation) ||
    evidence.native_generation < 1 ||
    !/^[a-f0-9]{64}$/u.test(evidence.definition_fingerprint ?? '')
  ) {
    throw new TypeError('Issue DAG native generation evidence is invalid.');
  }
};

export const createIssueDagRunBundle = ({
  lane_id,
  issue_number,
  dependencies,
  coordinator_session_id,
  head_sha,
  definition,
  dispatch_event_hash,
}) => {
  const canonicalDefinition = canonicalIssueDagDefinition(
    definition,
    lane_id,
    issue_number,
  );
  const state = {
    version: 3,
    lane_id,
    issue_number,
    dependencies: structuredClone(dependencies),
    coordinator_session_id,
    dag_key: canonicalDefinition.key,
    run_id: null,
    status: 'dispatch-intent',
    head_sha,
    dispatch_event_hash,
    definition_generation: 0,
    native_generation: null,
    current_definition: canonicalDefinition,
    current_definition_sha256: payloadDigest(canonicalDefinition),
    definition_fingerprint: null,
    active_phase_key: 'preflight',
    active_node_ids: [],
    completed_phase_keys: [],
    completed_node_ids: [],
    last_completed_node_ids: [],
    pending_amendment: null,
    terminal_issue_status: null,
    terminal_issue_event_hash: null,
  };
  return appendEvent({ state, events: [] }, 'dispatch-intent', state);
};

export const attachIssueDagRun = (bundle, evidence) => {
  assertIssueDagBundle(bundle);
  if (bundle.state.status !== 'dispatch-intent') {
    throw new TypeError('Issue DAG run can attach only after dispatch intent.');
  }
  requireNativeIdentity(bundle.state, evidence);
  const state = {
    ...structuredClone(bundle.state),
    run_id: evidence.run_id,
    status: 'phase-running',
    native_generation: evidence.native_generation,
    definition_fingerprint: evidence.definition_fingerprint,
    active_node_ids: bundle.state.current_definition.nodes.map(
      (node) => node.id,
    ),
  };
  return appendEvent(bundle, 'run-attached', state, {
    run_id: evidence.run_id,
  });
};

export const settleIssueDagPhase = (bundle, evidence) => {
  assertIssueDagBundle(bundle);
  const state = bundle.state;
  if (
    state.status !== 'native-completed-unverified' ||
    evidence.definition_fingerprint !== state.definition_fingerprint ||
    evidence.native_generation !== state.native_generation ||
    JSON.stringify(evidence.completed_node_ids) !==
      JSON.stringify(state.active_node_ids)
  ) {
    throw new TypeError('Issue DAG phase settlement evidence does not match.');
  }
  const next = {
    ...structuredClone(state),
    status: 'phase-settled',
    active_phase_key: null,
    active_node_ids: [],
    completed_phase_keys: [
      ...state.completed_phase_keys,
      state.active_phase_key,
    ],
    completed_node_ids: [
      ...state.completed_node_ids,
      ...state.active_node_ids,
    ],
    last_completed_node_ids: [...state.active_node_ids],
  };
  return appendEvent(bundle, 'phase-settled', next, {
    completed_node_ids: evidence.completed_node_ids,
  });
};

export const observeIssueDagCompletion = (bundle, evidence) => {
  assertIssueDagBundle(bundle);
  const state = bundle.state;
  if (
    state.status !== 'phase-running' ||
    !Array.isArray(evidence.completed_node_ids) ||
    evidence.completed_node_ids.some(
      (nodeId) =>
        typeof nodeId !== 'string' ||
        !state.current_definition.nodes.some(
          (node) => node.id === nodeId,
        ),
    ) ||
    new Set(evidence.completed_node_ids).size !==
      evidence.completed_node_ids.length ||
    evidence.definition_fingerprint !== state.definition_fingerprint ||
    evidence.native_generation !== state.native_generation ||
    !state.active_node_ids.every((nodeId) =>
      evidence.completed_node_ids.includes(nodeId)
    )
  ) {
    throw new TypeError('Issue DAG native completion evidence does not match.');
  }
  return appendEvent(
    bundle,
    'native-completed',
    {
      ...structuredClone(state),
      status: 'native-completed-unverified',
    },
    { completed_node_ids: state.active_node_ids },
  );
};


