import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';
import {
  assertIssueDagBundle,
  assertIssueDagDefinition,
  canonicalIssueDagDefinition,
  eventForIssueDagState,
} from './issue-dag-contracts.mjs';

const appendEvent = (bundle, kind, state, details = {}) => {
  const events = [
    ...bundle.events,
    eventForIssueDagState(bundle.events, kind, state, details),
  ];
  return assertIssueDagBundle({ state, events });
};

const requireNativeIdentity = (state, evidence) => {
  if (
    (evidence.run_id !== state.run_id && state.run_id !== null) ||
    evidence.run_key !== state.dag_key ||
    evidence.parent_session_id !== state.coordinator_session_id ||
    !Number.isSafeInteger(evidence.native_generation) ||
    evidence.native_generation < 1 ||
    !/^[a-f0-9]{64}$/u.test(evidence.definition_fingerprint ?? '')
  ) {
    throw new TypeError('Issue DAG native run identity does not match.');
  }
};

const canonicalAmendment = (state, input) => {
  assertIssueDagDefinition(
    input.definition,
    state.lane_id,
    state.issue_number,
  );
  const definition = canonicalIssueDagDefinition(
    input.definition,
    state.lane_id,
    state.issue_number,
  );
  const currentNodes = state.current_definition.nodes;
  const prefix = definition.nodes.slice(0, currentNodes.length);
  const added = definition.nodes.slice(currentNodes.length);
  if (
    payloadDigest(prefix) !== payloadDigest(currentNodes) ||
    JSON.stringify(added.map((node) => node.id)) !==
      JSON.stringify(input.added_node_ids) ||
    input.added_node_ids.some((id) => state.completed_node_ids.includes(id))
  ) {
    throw new TypeError('Issue DAG amendment must append only new nodes.');
  }
  return {
    base_native_generation: state.native_generation,
    base_definition_fingerprint: state.definition_fingerprint,
    base_definition_sha256: state.current_definition_sha256,
    definition: structuredClone(definition),
    definition_sha256: payloadDigest(definition),
    phase_key: input.phase_key,
    head_sha: input.head_sha,
    added_node_ids: [...input.added_node_ids],
    continue_active_phase: input.continue_active_phase === true,
  };
};

export const prepareIssueDagAmendment = (bundle, input) => {
  assertIssueDagBundle(bundle);
  const pending = canonicalAmendment(bundle.state, input);
  if (bundle.state.status === 'amend-intent') {
    const persisted = {
      ...structuredClone(bundle.state.pending_amendment),
      continue_active_phase:
        bundle.state.pending_amendment.continue_active_phase === true,
    };
    if (
      payloadDigest(persisted) ===
      payloadDigest(pending)
    ) {
      return bundle;
    }
    throw new TypeError('Issue DAG amendment intent is conflicting.');
  }
  const continuesActivePhase =
    pending.continue_active_phase &&
    bundle.state.status === 'native-completed-unverified' &&
    pending.phase_key === bundle.state.active_phase_key &&
    pending.head_sha === bundle.state.head_sha;
  const startsNewPhase =
    !pending.continue_active_phase &&
    bundle.state.status === 'phase-settled' &&
    !bundle.state.completed_phase_keys.includes(pending.phase_key);
  if (!continuesActivePhase && !startsNewPhase) {
    throw new TypeError('Issue DAG amendment requires a settled new phase.');
  }
  return appendEvent(
    bundle,
    'amend-intent',
    {
      ...structuredClone(bundle.state),
      status: 'amend-intent',
      pending_amendment: pending,
    },
    {
      phase_key: pending.phase_key,
      definition_sha256: pending.definition_sha256,
    },
  );
};

export const attachIssueDagAmendment = (bundle, evidence) => {
  assertIssueDagBundle(bundle);
  const state = bundle.state;
  if (state.status !== 'amend-intent') {
    throw new TypeError('Issue DAG amendment has no persisted intent.');
  }
  requireNativeIdentity(state, evidence);
  if (evidence.native_generation !== state.native_generation + 1) {
    throw new TypeError('Issue DAG amendment generation did not advance once.');
  }
  const pending = state.pending_amendment;
  const amendment = evidence.amendment;
  if (
    typeof amendment !== 'object' ||
    amendment === null ||
    !Number.isSafeInteger(amendment.event_sequence) ||
    amendment.event_sequence < 1 ||
    amendment.previous_fingerprint !== pending.base_definition_fingerprint ||
    amendment.fingerprint !== evidence.definition_fingerprint ||
    amendment.definition_sha256 !== pending.definition_sha256 ||
    JSON.stringify(amendment.added_node_ids) !==
      JSON.stringify(pending.added_node_ids) ||
    amendment.changed_node_ids?.length !== 0 ||
    amendment.invalidated_node_ids?.length !== 0
  ) {
    throw new TypeError('Issue DAG native amendment event does not match intent.');
  }
  const next = {
    ...structuredClone(state),
    status: 'phase-running',
    head_sha: pending.head_sha,
    definition_generation: state.definition_generation + 1,
    native_generation: evidence.native_generation,
    current_definition: pending.definition,
    current_definition_sha256: pending.definition_sha256,
    definition_fingerprint: evidence.definition_fingerprint,
    active_phase_key: pending.continue_active_phase
      ? state.active_phase_key
      : pending.phase_key,
    active_node_ids: pending.continue_active_phase
      ? pending.added_node_ids
      : pending.added_node_ids,
    completed_node_ids: pending.continue_active_phase
      ? [...state.completed_node_ids, ...state.active_node_ids]
      : state.completed_node_ids,
    pending_amendment: null,
  };
  return appendEvent(bundle, 'amend-attached', next, {
    phase_key: pending.phase_key,
  });
};

export const terminalizeIssueDagRun = (
  bundle,
  { issue_status: issueStatus, issue_event_hash: issueEventHash },
) => {
  assertIssueDagBundle(bundle);
  if (
    bundle.state.status !== 'phase-settled' ||
    typeof issueStatus !== 'string' ||
    issueStatus.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(issueEventHash ?? '')
  ) {
    throw new TypeError('Issue DAG terminalization requires a settled issue.');
  }
  const state = {
    ...structuredClone(bundle.state),
    status: 'terminal',
    terminal_issue_status: issueStatus,
    terminal_issue_event_hash: issueEventHash,
  };
  return appendEvent(bundle, 'terminal', state, {
    issue_status: issueStatus,
    issue_event_hash: issueEventHash,
  });
};
