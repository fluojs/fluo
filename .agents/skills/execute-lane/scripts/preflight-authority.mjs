import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertContract,
  payloadDigest,
  searchArtifactDigest,
} from '../../../workflow-contracts/contracts.mjs';
import { approvalBinding } from '../../create-lane/scripts/approval-contracts.mjs';
import { planIsCanonical } from '../../create-lane/scripts/plan-contracts.mjs';
import { canonicalLaneLedgerPath } from './lane-runtime-paths.mjs';
import {
  assertLiveIssueContract,
  assertLiveIssueContractCurrent,
  observeLiveIssueContract,
} from './trusted-evidence.mjs';

const sha256 = /^[a-f0-9]{64}$/u;

const readCanonicalJson = (path, name) => {
  if (!existsSync(path)) throw new TypeError(`${name} must exist.`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(path) !== path) {
    throw new TypeError(`${name} must be a real canonical file.`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new TypeError(`${name} must contain valid JSON.`);
  }
};

const planFromLedger = (ledger) => ({
  version: 2,
  lane_id: ledger.lane_id,
  base_branch: ledger.base_branch,
  source: { artifact_id: ledger.source.artifact_id, sha256: ledger.source.sha256 },
  merge_policy: ledger.merge_policy,
  pr_merge_method: ledger.pr_merge_method,
  authority_scope: ledger.authority_scope,
  retry_policy: ledger.retry_policy,
  confirmed_issues: ledger.confirmed_issues,
  suggested_but_excluded: ledger.suggested_but_excluded,
  backlog_candidates: ledger.backlog_candidates,
  release_handoffs: ledger.release_handoffs,
  lanes: ledger.lanes.map(({ name, queue }) => ({ name, queue })),
  dependency_graph: ledger.dependency_graph,
});

const authorityValue = (receipt) => ({
  version: 1,
  lane_id: receipt.lane_id,
  issue_number: receipt.issue_number,
  issue_authority_gate: receipt.issue_authority_gate,
  ledger_path: receipt.ledger_path,
  lane_ledger_sha256: receipt.lane_ledger_sha256,
  approval_path: receipt.approval_path,
  approval_id: receipt.approval_id,
  lane_plan_approval_sha256: receipt.lane_plan_approval_sha256,
  issue_authority_approval_path: receipt.issue_authority_approval_path,
  issue_authority_approval_sha256: receipt.issue_authority_approval_sha256,
  source_path: receipt.source_path,
  source_artifact_id: receipt.source_artifact_id,
  source_artifact_sha256: receipt.source_artifact_sha256,
  authority_scope: receipt.authority_scope,
  retry_policy: receipt.retry_policy,
  release_handoff: receipt.release_handoff,
  canonical_acceptance_ids: receipt.canonical_acceptance_ids,
  canonical_acceptance_criteria: receipt.canonical_acceptance_criteria,
  canonical_sources: receipt.canonical_sources,
  live_issue_contract: receipt.live_issue_contract,
  issue_contract_revision: receipt.issue_contract_revision,
  issue_contract_sha256: receipt.issue_contract_sha256,
});

const validSource = (source) =>
  typeof source?.source === 'string' &&
  source.source.length > 0 &&
  typeof source.revision === 'string' &&
  source.revision.length > 0 &&
  sha256.test(source.content_sha256 ?? '');

export const assertPreflightAuthority = (value) => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.issue_number) ||
    value.issue_number <= 0 ||
    !['confirmed-issues', 'suggested-additions'].includes(value.issue_authority_gate) ||
    !Array.isArray(value.canonical_acceptance_ids) ||
    value.canonical_acceptance_ids.length === 0 ||
    new Set(value.canonical_acceptance_ids).size !== value.canonical_acceptance_ids.length ||
    value.canonical_acceptance_ids.some((id) => typeof id !== 'string' || id.length === 0) ||
    !Array.isArray(value.canonical_acceptance_criteria) ||
    value.canonical_acceptance_criteria.length !== value.canonical_acceptance_ids.length ||
    value.canonical_acceptance_criteria.some((criterion, index) =>
      criterion?.id !== value.canonical_acceptance_ids[index] ||
      typeof criterion.content !== 'string' || criterion.content.length === 0 ||
      !sha256.test(criterion.content_sha256 ?? '') ||
      criterion.content_sha256 !== payloadDigest({ content: criterion.content })) ||
    !Array.isArray(value.canonical_sources) ||
    value.canonical_sources.length !== 5 ||
    value.canonical_sources.some((source) => !validSource(source)) ||
    new Set(value.canonical_sources.map(({ source }) => source)).size !== value.canonical_sources.length ||
    !sha256.test(value.authority_sha256 ?? '') ||
    value.authority_sha256 !== payloadDigest(authorityValue(value))
  ) {
    throw new TypeError('preflight authority receipt is malformed or has been tampered with.');
  }
  const live = assertLiveIssueContract(value.live_issue_contract);
  if (
    live.issue.number !== value.issue_number ||
    live.sha256 !== value.issue_contract_sha256 ||
    live.issue.updated_at !== value.issue_contract_revision ||
    JSON.stringify(live.acceptance_criteria.map(({ id }) => id)) !==
      JSON.stringify(value.canonical_acceptance_ids) ||
    JSON.stringify(live.acceptance_criteria) !==
      JSON.stringify(value.canonical_acceptance_criteria)
  ) {
    throw new TypeError('preflight authority live issue contract binding is invalid.');
  }
  return value;
};

const requireIssueApproval = ({ root, laneId, gate, issueNumber, artifact, plan }) => {
  const approvalId = `approval-${laneId}-${gate}`;
  const relativePath = `.omo/approvals/${approvalId}.json`;
  const approval = readCanonicalJson(resolve(root, relativePath), `canonical ${gate} approval receipt`);
  const bindingInput = {
    gate: approval.gate,
    approval_id: approval.approval_id,
    issue_numbers: approval.issue_numbers,
  };
  if (
    approval.version !== 1 ||
    approval.gate !== gate ||
    approval.approval_id !== approvalId ||
    approval.lane_id !== laneId ||
    !Array.isArray(approval.issue_numbers) ||
    !approval.issue_numbers.includes(issueNumber) ||
    approval.binding_sha256 !== approvalBinding(bindingInput, artifact, plan)
  ) {
    throw new TypeError(`canonical ${gate} approval does not authorize this issue.`);
  }
  return { approval, relativePath };
};

export const resolveCanonicalPreflightAuthority = ({
  repository_root: repositoryRoot,
  lane_id: laneId,
  issue_number: issueNumber,
  command_runner: commandRunner,
}) => {
  const ledgerIdentity = canonicalLaneLedgerPath(repositoryRoot, `.omo/lanes/${laneId}.json`);
  const root = ledgerIdentity.repositoryRoot;
  const ledger = readCanonicalJson(ledgerIdentity.ledgerPath, 'canonical lane ledger');
  assertContract('lane-ledger-v2', ledger);
  if (
    ledger.lane_id !== laneId ||
    !ledger.confirmed_issues.includes(issueNumber) ||
    typeof ledger.lane_plan_approval_sha256 !== 'string'
  ) {
    throw new TypeError('canonical lane ledger does not authorize this issue preflight.');
  }

  const sourcePath = resolve(root, ledger.source.search_ledger);
  if (!sourcePath.startsWith(`${root}/.omo/search-issue/artifacts/`)) {
    throw new TypeError('canonical lane source path is invalid.');
  }
  const artifact = readCanonicalJson(sourcePath, 'canonical lane source artifact');
  assertContract('search-artifact-v2', artifact);
  if (
    artifact.sha256 !== searchArtifactDigest(artifact) ||
    artifact.artifact_id !== ledger.source.artifact_id ||
    artifact.sha256 !== ledger.source.sha256
  ) {
    throw new TypeError('canonical lane source artifact does not match the lane ledger.');
  }

  const approvalPath = resolve(root, '.omo', 'approvals', `approval-${laneId}-lane-plan.json`);
  const approval = readCanonicalJson(approvalPath, 'canonical lane-plan approval receipt');
  const plan = approval.plan;
  const ledgerPlan = { ...planFromLedger(ledger), release_handoffs: plan?.release_handoffs };
  const approvalInput = {
    gate: approval.gate,
    approval_id: approval.approval_id,
    release_handoff_attestations: approval.release_handoff_attestations ?? [],
  };
  if (
    approval.version !== 1 ||
    approval.gate !== 'lane-plan' ||
    approval.lane_id !== laneId ||
    approval.approval_id !== `approval-${laneId}-lane-plan` ||
    !planIsCanonical(plan, artifact) ||
    JSON.stringify(plan) !== JSON.stringify(ledgerPlan) ||
    !Array.isArray(plan.release_handoffs) ||
    JSON.stringify(plan.release_handoffs.map(({ issue_number: number }) => number)) !==
      JSON.stringify(ledger.release_handoffs) ||
    approval.binding_sha256 !== approvalBinding(approvalInput, artifact, plan) ||
    approval.binding_sha256 !== ledger.lane_plan_approval_sha256
  ) {
    throw new TypeError('canonical lane-plan approval does not match the lane ledger and source.');
  }

  const selected = artifact.selected_issues.includes(issueNumber);
  const gate = selected ? 'confirmed-issues' : 'suggested-additions';
  if (!selected && !plan.confirmed_issues.includes(issueNumber)) {
    throw new TypeError('unapproved suggested addition is not canonical issue authority.');
  }
  const issueApproval = requireIssueApproval({
    root,
    laneId,
    gate,
    issueNumber,
    artifact,
    plan,
  });
  const liveIssueContract = observeLiveIssueContract({
    repository_root: root,
    issue_number: issueNumber,
    command_runner: commandRunner,
  });
  const ledgerSha256 = payloadDigest(ledger);
  const issueApprovalSha256 = issueApproval.approval.binding_sha256;
  const laneApprovalContentSha256 = payloadDigest(approval);
  const canonicalSources = [
    { source: `.omo/lanes/${laneId}.json`, revision: ledgerSha256, content_sha256: ledgerSha256 },
    { source: ledger.source.search_ledger, revision: artifact.sha256, content_sha256: payloadDigest(artifact) },
    {
      source: issueApproval.relativePath,
      revision: issueApprovalSha256,
      content_sha256: payloadDigest(issueApproval.approval),
    },
    {
      source: `.omo/approvals/${approval.approval_id}.json`,
      revision: approval.binding_sha256,
      content_sha256: laneApprovalContentSha256,
    },
    {
      source: liveIssueContract.issue.url,
      revision: liveIssueContract.issue.updated_at,
      content_sha256: liveIssueContract.sha256,
    },
  ];
  const receipt = {
    version: 1,
    lane_id: laneId,
    issue_number: issueNumber,
    issue_authority_gate: gate,
    ledger_path: `.omo/lanes/${laneId}.json`,
    lane_ledger_sha256: ledgerSha256,
    approval_path: `.omo/approvals/${approval.approval_id}.json`,
    approval_id: approval.approval_id,
    lane_plan_approval_sha256: approval.binding_sha256,
    issue_authority_approval_path: issueApproval.relativePath,
    issue_authority_approval_sha256: issueApprovalSha256,
    source_path: ledger.source.search_ledger,
    source_artifact_id: artifact.artifact_id,
    source_artifact_sha256: artifact.sha256,
    authority_scope: {
      pr_creation: ledger.authority_scope.pr_creation,
      pr_merge: ledger.authority_scope.pr_merge,
      cleanup_command_worktrees: ledger.authority_scope.cleanup_command_worktrees,
    },
    retry_policy: ledger.retry_policy,
    release_handoff: ledger.release_handoffs.includes(issueNumber),
    canonical_acceptance_ids: liveIssueContract.acceptance_criteria.map(({ id }) => id),
    canonical_acceptance_criteria: structuredClone(liveIssueContract.acceptance_criteria),
    canonical_sources: canonicalSources,
    live_issue_contract: liveIssueContract,
    issue_contract_revision: liveIssueContract.issue.updated_at,
    issue_contract_sha256: liveIssueContract.sha256,
  };
  return assertPreflightAuthority({ ...receipt, authority_sha256: payloadDigest(receipt) });
};

export const assertCanonicalPreflightAuthority = (state, options = {}) => {
  const actual = assertPreflightAuthority(state.preflight_authority);
  assertLiveIssueContractCurrent(actual.live_issue_contract, options);
  const expected = resolveCanonicalPreflightAuthority({
    ...state,
    command_runner: options.command_runner,
  });
  if (payloadDigest(actual) !== payloadDigest(expected)) {
    throw new TypeError('persisted preflight authority does not match canonical live repository artifacts.');
  }
  return expected;
};
