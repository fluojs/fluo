import { lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

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

const prepareLane = (scenario, normalized) => {
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

/** Fixture adapter retains legacy input shape and exact approval bindings. */
export const prepareScenario = (scenarioPath) => {
  const scenario = readScenario(scenarioPath);
  return prepareLane(scenario, normalizeIntake(scenario));
};

/** Read only the canonical artifact selected by the trusted lead. */
export const preparePublication = (input, repositoryRoot) => {
  const keys = ['artifact_path', 'plan', 'approvals', 'recommend_issues', 'recommended_issue_numbers'];
  if (!isRecord(input) || !Object.keys(input).every((key) => keys.includes(key)) ||
    !['artifact_path', 'plan', 'approvals', 'recommended_issue_numbers'].every((key) => Object.hasOwn(input, key)) ||
    typeof input.artifact_path !== 'string' ||
    !/^\.omo\/search-issue\/artifacts\/(?:legacy\/)?[A-Za-z0-9][A-Za-z0-9+._-]*\.json$/u.test(input.artifact_path)) {
    return rejected('invalid_artifact');
  }
  // These fields must be established before approval collection, never backfilled.
  if (!isRecord(input.plan) || input.plan.preflight_overlap !== 1 ||
    !Object.hasOwn(input.plan, 'dependency_reasons')) return rejected('invalid_artifact');
  const root = resolve(repositoryRoot);
  let artifact;
  try {
    const parts = [root];
    for (const part of input.artifact_path.split('/')) parts.push(resolve(parts.at(-1), part));
    for (const path of parts) {
      if (lstatSync(path).isSymbolicLink()) return rejected('unsafe_output_path');
    }
    artifact = JSON.parse(readFileSync(resolve(root, input.artifact_path), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError ||
      (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code))) {
      return rejected('invalid_artifact');
    }
    throw error;
  }
  const scenario = {
    ...input,
    intake: { mode: 'artifact', artifact_path: input.artifact_path },
    artifacts: { [input.artifact_path]: artifact },
  };
  return prepareLane(scenario, normalizeIntake(scenario));
};
