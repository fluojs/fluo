import {
  assertContract,
} from '../../../workflow-contracts/contracts.mjs';
import {
  validateLedger,
} from '../../../../tooling/governance/lane-ledger-state.mjs';
import {
  assertIssueDagDefinition,
  canonicalIssueDagDefinition,
  issueDagKey,
} from './issue-dag-contracts.mjs';
import {
  implementerRoute,
  phaseDagNodes,
  preflightDagNode,
} from './issue-dag-nodes.mjs';

export {
  implementerRoute,
};
export const maxIssueDagNodes = 64;

const assertPhaseOrder = (phase, priorKind, priorGeneration) => {
  if (
    phase.kind === 'implementation' &&
    !['preflight', 'review', 'ci-observe'].includes(priorKind)
  ) {
    throw new TypeError('Implementation phase ordering is invalid.');
  }
  if (
    phase.kind === 'review' &&
    (priorKind !== 'implementation' ||
      phase.generation !== priorGeneration)
  ) {
    throw new TypeError('Review phase requires its implementation phase.');
  }
};

export const compileIssueLifecycleDag = (
  lane,
  issueNumber,
  { bootstrap, phases = [] },
) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  if (!lane.confirmed_issues.includes(issueNumber)) {
    throw new TypeError('Issue DAG issue is not confirmed by the lane.');
  }
  const dagKey = issueDagKey(lane.lane_id, issueNumber);
  const nodes = [
    preflightDagNode(lane, issueNumber, dagKey, bootstrap),
  ];
  let priorKind = 'preflight';
  let priorGeneration = null;
  let dependsOn = [nodes[0].id];
  for (const phase of phases) {
    assertPhaseOrder(phase, priorKind, priorGeneration);
    const wave = phaseDagNodes(
      lane,
      issueNumber,
      dagKey,
      phase,
      dependsOn,
    );
    nodes.push(...wave);
    if (nodes.length > maxIssueDagNodes) {
      throw new TypeError('Issue DAG node budget is exhausted.');
    }
    dependsOn = wave.map((node) => node.id);
    priorKind = phase.kind;
    if (phase.kind === 'implementation') {
      priorGeneration = phase.generation;
    }
  }
  return canonicalIssueDagDefinition({
    key: dagKey,
    name: `Fluo lane ${lane.lane_id} issue ${String(issueNumber)} lifecycle`,
    nodes,
  }, lane.lane_id, issueNumber);
};

export const compileIssueLifecycleSegment = (
  lane,
  issueNumber,
  phase,
) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  if (!lane.confirmed_issues.includes(issueNumber)) {
    throw new TypeError('Issue DAG issue is not confirmed by the lane.');
  }
  const dagKey = issueDagKey(lane.lane_id, issueNumber);
  const nodes = phaseDagNodes(
    lane,
    issueNumber,
    dagKey,
    phase,
    [],
  );
  if (nodes.length === 0 || nodes.length > maxIssueDagNodes) {
    throw new TypeError('Issue DAG segment node budget is invalid.');
  }
  return canonicalIssueDagDefinition({
    key: dagKey,
    name:
      `Fluo lane ${lane.lane_id} issue ${String(issueNumber)} lifecycle segment`,
    nodes,
  }, lane.lane_id, issueNumber);
};

export const amendIssueLifecycleDag = (
  lane,
  issueNumber,
  definition,
  phase,
  dependsOn,
) => {
  assertContract('lane-ledger-v2', lane);
  validateLedger('lane-ledger-v2', lane);
  assertIssueDagDefinition(definition, lane.lane_id, issueNumber);
  if (
    !Array.isArray(dependsOn) ||
    dependsOn.length === 0 ||
    dependsOn.some(
      (id) => !definition.nodes.some((node) => node.id === id),
    )
  ) {
    throw new TypeError('Issue DAG amendment dependencies are invalid.');
  }
  const wave = phaseDagNodes(
    lane,
    issueNumber,
    definition.key,
    phase,
    dependsOn,
  );
  if (definition.nodes.length + wave.length > maxIssueDagNodes) {
    throw new TypeError('Issue DAG node budget is exhausted.');
  }
  const existingIds = new Set(definition.nodes.map((node) => node.id));
  if (wave.some((node) => existingIds.has(node.id))) {
    throw new TypeError('Issue DAG amendment node identity already exists.');
  }
  return canonicalIssueDagDefinition({
    ...definition,
    nodes: [...definition.nodes, ...wave],
  }, lane.lane_id, issueNumber);
};
