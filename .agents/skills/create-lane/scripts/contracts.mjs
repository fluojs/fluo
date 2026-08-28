import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  WorkflowContractError,
  assertContract,
  assertLaneSourceBinding,
} from '../../../workflow-contracts/contracts.mjs';
import { validateLedger } from '../../../../tooling/governance/lane-ledger-state.mjs';
import { validateApprovals } from './approval-contracts.mjs';
import { normalizeIntake } from './intake-contracts.mjs';
import { planIsCanonical, readyLedger } from './plan-contracts.mjs';

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

export const prepareScenario = (scenarioPath) => {
  const scenario = readScenario(scenarioPath);
  const recommendedIssueNumbers = scenario.recommended_issue_numbers;
  if (
    (scenario.recommend_issues !== undefined &&
      typeof scenario.recommend_issues !== 'boolean') ||
    (!scenario.recommend_issues &&
      Array.isArray(recommendedIssueNumbers) &&
      recommendedIssueNumbers.length > 0)
  ) {
    return rejected('recommendations_not_requested');
  }
  const normalized = normalizeIntake(scenario);
  if (normalized.reason !== undefined) {
    return rejected(normalized.reason);
  }
  const { artifact, artifactPath, publishArtifact } = normalized;
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
    !planIsCanonical(plan, artifact)
  ) {
    return rejected('invalid_artifact');
  }
  const approvalFailure = validateApprovals(
    scenario.approvals,
    artifact,
    plan,
    recommendedIssueNumbers,
  );
  if (approvalFailure !== null) {
    return rejected(approvalFailure);
  }
  const releaseApprovalSha256 =
    plan.release_handoffs.length === 0
      ? undefined
      : scenario.approvals[2].binding_sha256;
  const ledger = readyLedger(
    plan,
    artifact,
    artifactPath,
    releaseApprovalSha256,
  );
  try {
    assertLaneSourceBinding(ledger, artifact);
    validateLedger('lane-ledger-v2', ledger);
  } catch (error) {
    if (error instanceof Error) {
      return rejected('invalid_artifact');
    }
    throw error;
  }
  return {
    kind: 'ready',
    ledger,
    approvals: scenario.approvals,
    plan,
    artifact,
    artifactPath,
    publishArtifact,
  };
};
