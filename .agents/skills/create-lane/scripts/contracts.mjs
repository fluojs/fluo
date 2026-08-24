import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  WorkflowContractError,
  assertContract,
  assertLaneSourceBinding,
} from '../../../workflow-contracts/contracts.mjs';

const nativeArtifactPattern = /^\.omo\/search-issue\/artifacts\/([A-Za-z0-9][A-Za-z0-9+._-]*)\.json$/u;
const approvalGates = [
  'confirmed-issues',
  'suggested-additions',
  'lane-plan',
];

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (record, keys) => {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isIssueArray = (value) =>
  Array.isArray(value) &&
  value.every((issue) => Number.isSafeInteger(issue) && issue > 0) &&
  new Set(value).size === value.length;

const rejected = (reason) => ({ kind: 'rejected', result: { status: 'rejected', reason } });

const readScenario = (scenarioPath) => {
  const value = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  if (!isRecord(value)) {
    throw new TypeError(`Expected a JSON object at ${basename(scenarioPath)}.`);
  }
  return value;
};

const readArtifact = (scenario, input) => {
  if (!isRecord(scenario.artifacts) || !Object.hasOwn(scenario.artifacts, input)) {
    return undefined;
  }
  return scenario.artifacts[input];
};

const approvalsAreCanonical = (approvals, artifact, plan) => {
  if (!Array.isArray(approvals) || approvals.length !== approvalGates.length) {
    return false;
  }
  const approvalIds = new Set();
  for (const [index, approval] of approvals.entries()) {
    if (!isRecord(approval) || approval.gate !== approvalGates[index] || approval.approved !== true) {
      return false;
    }
    if (typeof approval.approval_id !== 'string' || approval.approval_id.length === 0) {
      return false;
    }
    approvalIds.add(approval.approval_id);
  }
  if (approvalIds.size !== approvalGates.length) {
    return false;
  }
  const confirmed = approvals[0];
  const suggested = approvals[1];
  const planApproval = approvals[2];
  if (
    !hasExactKeys(confirmed, ['gate', 'approval_id', 'approved', 'issue_numbers']) ||
    !hasExactKeys(suggested, ['gate', 'approval_id', 'approved', 'issue_numbers']) ||
    !hasExactKeys(planApproval, ['gate', 'approval_id', 'approved']) ||
    !isIssueArray(confirmed.issue_numbers) ||
    !isIssueArray(suggested.issue_numbers)
  ) {
    return false;
  }
  const selected = artifact.selected_issues;
  const finalIssues = [...confirmed.issue_numbers, ...suggested.issue_numbers];
  return (
    selected.length === confirmed.issue_numbers.length &&
    selected.every((issue, index) => issue === confirmed.issue_numbers[index]) &&
    finalIssues.length === 1 &&
    finalIssues[0] === plan.issue_number
  );
};

export const prepareScenario = (scenarioPath) => {
  const scenario = readScenario(scenarioPath);
  if (!Array.isArray(scenario.inputs) || scenario.inputs.length !== 1) {
    return rejected('mixed_input');
  }
  const input = scenario.inputs[0];
  if (typeof input !== 'string') {
    return rejected('mixed_input');
  }
  const pathMatch = nativeArtifactPattern.exec(input);
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
    assertLaneSourceBinding(plan, artifact);
  } catch (error) {
    if (error instanceof WorkflowContractError) {
      return rejected('invalid_artifact');
    }
    throw error;
  }
  if (`${pathMatch[1]}.json` !== basename(input) || pathMatch[1] !== artifact.search_run_id) {
    return rejected('invalid_artifact');
  }
  if (!approvalsAreCanonical(scenario.approvals, artifact, plan)) {
    return rejected('approval_not_distinct');
  }
  return { kind: 'ready', plan };
};
