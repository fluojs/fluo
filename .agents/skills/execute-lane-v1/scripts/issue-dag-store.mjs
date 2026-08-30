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
    run_epoch: 1,
    predecessor_runs: [],
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

export const rolloverIssueDagRun = (bundle, {
  coordinator_session_id: coordinatorSessionId,
  phase_key: phaseKey,
  head_sha: headSha,
  definition,
}) => {
  assertIssueDagBundle(bundle);
  const state = bundle.state;
  const preservesPendingPhase = [
    'dispatch-intent',
    'phase-running',
  ].includes(state.status);
  const recoversPendingAmendment =
    state.status === 'amend-intent' &&
    state.pending_amendment?.phase_key === phaseKey;
  if (
    ![
      'dispatch-intent',
      'phase-running',
      'phase-settled',
      'amend-intent',
    ].includes(state.status) ||
    typeof coordinatorSessionId !== 'string' ||
    coordinatorSessionId.length === 0 ||
    coordinatorSessionId === state.coordinator_session_id ||
    (preservesPendingPhase && phaseKey !== state.active_phase_key) ||
    (state.status === 'amend-intent' && !recoversPendingAmendment) ||
    headSha !== state.head_sha
  ) {
    throw new TypeError(
      state.status === 'native-completed-unverified'
        ? 'Issue DAG native completion requires phase import before rollover.'
        : 'Issue DAG rollover requires one pending phase and a new coordinator session.',
    );
  }
  const canonicalDefinition = canonicalIssueDagDefinition(
    definition,
    state.lane_id,
    state.issue_number,
  );
  const currentEpoch = state.run_epoch ?? 1;
  const predecessorRuns = state.predecessor_runs ?? [];
  const predecessor =
    state.run_id === null
      ? []
      : [
          {
            run_epoch: currentEpoch,
            run_id: state.run_id,
            coordinator_session_id: state.coordinator_session_id,
            native_generation: state.native_generation,
            definition_fingerprint: state.definition_fingerprint,
          },
        ];
  const next = {
    ...structuredClone(state),
    coordinator_session_id: coordinatorSessionId,
    run_id: null,
    run_epoch: currentEpoch + 1,
    predecessor_runs: [
      ...structuredClone(predecessorRuns),
      ...predecessor,
    ],
    status: 'dispatch-intent',
    current_definition: canonicalDefinition,
    current_definition_sha256: payloadDigest(canonicalDefinition),
    definition_fingerprint: null,
    native_generation: null,
    active_phase_key: phaseKey,
    active_node_ids: [],
    completed_node_ids: [],
    last_completed_node_ids: [],
    pending_amendment: null,
  };
  return appendEvent(bundle, 'run-rollover-intent', next, {
    ...(state.run_id === null
      ? {}
      : { predecessor_run_id: state.run_id }),
    successor_run_epoch: currentEpoch + 1,
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


