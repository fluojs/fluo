import {
  payloadDigest,
} from '../../../workflow-contracts/contracts.mjs';

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const LANE_ID = /^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const statuses = new Set([
  'dispatch-intent',
  'phase-running',
  'native-completed-unverified',
  'phase-settled',
  'amend-intent',
  'terminal',
]);

const record = (value, name) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const string = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

const uniqueStrings = (value, name) => {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError(`${name} must contain unique strings.`);
  }
  return value;
};

export const issueDagKey = (laneId, issueNumber) => {
  if (!LANE_ID.test(laneId) || !Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new TypeError('Issue DAG identity is invalid.');
  }
  return `fluo:lane:${laneId}:issue-${String(issueNumber)}:lifecycle:v3`;
};

export const assertIssueDagDefinition = (
  input,
  laneId,
  issueNumber,
) => {
  const definition = record(input, 'issue DAG definition');
  if (
    definition.key !== issueDagKey(laneId, issueNumber) ||
    typeof definition.name !== 'string' ||
    !Array.isArray(definition.nodes) ||
    definition.nodes.length === 0
  ) {
    throw new TypeError('Issue DAG definition identity is invalid.');
  }
  const ids = new Set();
  for (const candidate of definition.nodes) {
    const node = record(candidate, 'issue DAG node');
    const id = string(node.id, 'issue DAG node id');
    const hasCategory = typeof node.category === 'string';
    const hasAgent = typeof node.subagent_type === 'string';
    if (
      ids.has(id) ||
      hasCategory === hasAgent ||
      typeof node.prompt !== 'string' ||
      node.prompt.length === 0
    ) {
      throw new TypeError('Issue DAG node contract is invalid.');
    }
    uniqueStrings(node.dependsOn, 'issue DAG dependencies');
    ids.add(id);
  }
  for (const node of definition.nodes) {
    if (node.dependsOn.some((dependency) => !ids.has(dependency))) {
      throw new TypeError('Issue DAG dependency target is missing.');
    }
  }
  return definition;
};

export const canonicalIssueDagDefinition = (
  input,
  laneId,
  issueNumber,
) => {
  const definition = assertIssueDagDefinition(
    input,
    laneId,
    issueNumber,
  );
  return {
    key: definition.key,
    name: definition.name,
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      description: node.description,
      task_summary: node.task_summary,
      ...(typeof node.category === 'string'
        ? { category: node.category }
        : { subagent_type: node.subagent_type }),
      ...(typeof node.model === 'string' ? { model: node.model } : {}),
      load_skills: [...(node.load_skills ?? [])],
      dependsOn: [...node.dependsOn],
      prompt: node.prompt,
    })),
  };
};

const assertPendingAmendment = (value, state) => {
  if (value === null) return null;
  const pending = record(value, 'issue DAG pending amendment');
  assertIssueDagDefinition(
    pending.definition,
    state.lane_id,
    state.issue_number,
  );
  if (
    pending.definition_sha256 !==
      payloadDigest(
        canonicalIssueDagDefinition(
          pending.definition,
          state.lane_id,
          state.issue_number,
        ),
      ) ||
    pending.base_definition_sha256 !== state.current_definition_sha256 ||
    pending.base_definition_fingerprint !== state.definition_fingerprint ||
    pending.base_native_generation !== state.native_generation ||
    typeof pending.phase_key !== 'string' ||
    !SHA.test(pending.head_sha ?? '') ||
    (pending.continue_active_phase !== undefined &&
      typeof pending.continue_active_phase !== 'boolean') ||
    !Array.isArray(pending.added_node_ids) ||
    pending.added_node_ids.length === 0
  ) {
    throw new TypeError('Issue DAG pending amendment is invalid.');
  }
  uniqueStrings(pending.added_node_ids, 'issue DAG added node IDs');
  return pending;
};

export const assertIssueDagState = (input) => {
  const state = record(input, 'issue DAG state');
  if (
    state.version !== 3 ||
    !LANE_ID.test(state.lane_id ?? '') ||
    !Number.isSafeInteger(state.issue_number) ||
    state.issue_number < 1 ||
    state.dag_key !== issueDagKey(state.lane_id, state.issue_number) ||
    !statuses.has(state.status) ||
    !SHA.test(state.head_sha ?? '') ||
    !DIGEST.test(state.dispatch_event_hash ?? '') ||
    !Number.isSafeInteger(state.definition_generation) ||
    state.definition_generation < 0
  ) {
    throw new TypeError('Issue DAG state identity is invalid.');
  }
  string(state.coordinator_session_id, 'issue DAG coordinator session');
  if (
    !Array.isArray(state.dependencies) ||
    state.dependencies.some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    ) ||
    new Set(state.dependencies).size !== state.dependencies.length
  ) {
    throw new TypeError('Issue DAG dependencies are invalid.');
  }
  const definition = assertIssueDagDefinition(
    state.current_definition,
    state.lane_id,
    state.issue_number,
  );
  if (
    state.current_definition_sha256 !==
    payloadDigest(
      canonicalIssueDagDefinition(
        definition,
        state.lane_id,
        state.issue_number,
      ),
    )
  ) {
    throw new TypeError('Issue DAG definition digest is invalid.');
  }
  if (
    (state.run_id !== null && typeof state.run_id !== 'string') ||
    (state.native_generation !== null &&
      (!Number.isSafeInteger(state.native_generation) ||
        state.native_generation < 1)) ||
    (state.definition_fingerprint !== null &&
      !DIGEST.test(state.definition_fingerprint))
  ) {
    throw new TypeError('Issue DAG native binding is invalid.');
  }
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const active = uniqueStrings(state.active_node_ids, 'active node IDs');
  const completed = uniqueStrings(
    state.completed_node_ids,
    'completed node IDs',
  );
  const lastCompleted = uniqueStrings(
    state.last_completed_node_ids,
    'last completed node IDs',
  );
  const completedPhases = uniqueStrings(
    state.completed_phase_keys,
    'completed phase keys',
  );
  if (
    [...active, ...completed, ...lastCompleted].some(
      (id) => !nodeIds.has(id),
    ) ||
    lastCompleted.some((id) => !completed.includes(id)) ||
    active.some((id) => completed.includes(id))
  ) {
    throw new TypeError('Issue DAG node projection is invalid.');
  }
  const pending = assertPendingAmendment(state.pending_amendment, state);
  if (
    (state.active_phase_key !== null &&
      typeof state.active_phase_key !== 'string') ||
    (state.active_phase_key !== null &&
      completedPhases.includes(state.active_phase_key)) ||
    (state.status === 'dispatch-intent' && state.run_id !== null) ||
    (state.status === 'amend-intent') !== (pending !== null) ||
    (['phase-running', 'native-completed-unverified'].includes(state.status) &&
      (active.length === 0 || state.active_phase_key === null)) ||
    (state.status === 'phase-settled' && active.length !== 0) ||
    (state.status === 'terminal' &&
      (typeof state.terminal_issue_status !== 'string' ||
        !DIGEST.test(state.terminal_issue_event_hash ?? '')))
  ) {
    throw new TypeError('Issue DAG phase state is invalid.');
  }
  return state;
};

export const eventForIssueDagState = (previous, kind, state, details = {}) => {
  assertIssueDagState(state);
  const base = {
    version: 3,
    sequence: previous.length + 1,
    previous_hash: previous.at(-1)?.event_hash ?? null,
    kind: string(kind, 'issue DAG event kind'),
    state: structuredClone(state),
    details: structuredClone(record(details, 'issue DAG event details')),
  };
  return { ...base, event_hash: payloadDigest(base) };
};

export const assertIssueDagBundle = (input) => {
  const bundle = record(input, 'issue DAG bundle');
  if (!Array.isArray(bundle.events) || bundle.events.length === 0) {
    throw new TypeError('Issue DAG event history is missing.');
  }
  bundle.events.forEach((event, index) => {
    const { event_hash: eventHash, ...base } = event;
    if (
      event.version !== 3 ||
      event.sequence !== index + 1 ||
      event.previous_hash !== (bundle.events[index - 1]?.event_hash ?? null) ||
      eventHash !== payloadDigest(base)
    ) {
      throw new TypeError('Issue DAG event chain is invalid.');
    }
    assertIssueDagState(event.state);
  });
  const state = assertIssueDagState(bundle.state);
  if (payloadDigest(state) !== payloadDigest(bundle.events.at(-1).state)) {
    throw new TypeError('Issue DAG event projection is stale.');
  }
  return bundle;
};
