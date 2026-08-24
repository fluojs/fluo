import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  WorkflowContractError,
  assertContract,
  assertLaneSourceBinding,
} from '../../../workflow-contracts/contracts.mjs';
import { validateApprovals } from './approval-contracts.mjs';
import { planIsCanonical, readyLedger } from './plan-contracts.mjs';

const nativeArtifactPattern =
  /^\.omo\/search-issue\/artifacts\/([A-Za-z0-9][A-Za-z0-9+._-]*)\.json$/u;

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rejected = (reason) => ({
  kind: 'rejected',
  result: { status: 'rejected', reason },
});

const readScenario = (scenarioPath) => {
  const value = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  if (!isRecord(value)) {
    throw new TypeError(`Expected a JSON object at ${basename(scenarioPath)}.`);
  }
  return value;
};

const readArtifact = (scenario, input) =>
  isRecord(scenario.artifacts) && Object.hasOwn(scenario.artifacts, input)
    ? scenario.artifacts[input]
    : undefined;

export const prepareScenario = (scenarioPath) => {
  const scenario = readScenario(scenarioPath);
  if (!Array.isArray(scenario.inputs) || scenario.inputs.length !== 1) {
    return rejected('mixed_input');
  }
  const input = scenario.inputs[0];
  const pathMatch =
    typeof input === 'string' ? nativeArtifactPattern.exec(input) : null;
  if (pathMatch === null) {
    return rejected('mixed_input');
  }
  const artifact = readArtifact(scenario, input);
  const plan = scenario.plan;
  if (!isRecord(artifact) || !isRecord(plan)) {
    return rejected('invalid_artifact');
  }
  try {
    assertContract('search-artifact-v2', artifact);
  } catch (error) {
    if (error instanceof WorkflowContractError) {
      return rejected('invalid_artifact');
    }
    throw error;
  }
  if (
    `${pathMatch[1]}.json` !== basename(input) ||
    pathMatch[1] !== artifact.search_run_id ||
    !planIsCanonical(plan, artifact)
  ) {
    return rejected('invalid_artifact');
  }
  const approvalFailure = validateApprovals(
    scenario.approvals,
    artifact,
    plan,
  );
  if (approvalFailure !== null) {
    return rejected(approvalFailure);
  }
  const ledger = readyLedger(plan, artifact);
  try {
    assertLaneSourceBinding(ledger, artifact);
  } catch (error) {
    if (error instanceof WorkflowContractError) {
      return rejected('invalid_artifact');
    }
    throw error;
  }
  return { kind: 'ready', ledger, approvals: scenario.approvals };
};
