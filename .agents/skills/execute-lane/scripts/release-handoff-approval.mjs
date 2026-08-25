import {
  approvalBinding,
} from '../../create-lane/scripts/approval-contracts.mjs';
import {
  planIsCanonical,
  readyLedger,
} from '../../create-lane/scripts/plan-contracts.mjs';
import {
  assertContract,
  assertLaneSourceBinding,
} from '../../../workflow-contracts/contracts.mjs';

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (record, keys) => {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

export const assertReleaseHandoffApproval = (ledger, receipt) => {
  if (ledger.release_handoffs.length === 0) {
    return;
  }
  if (
    !isRecord(receipt) ||
    !hasExactKeys(receipt, [
      'version',
      'approval_id',
      'gate',
      'binding_sha256',
      'lane_id',
      'release_handoff_attestations',
      'plan',
    ]) ||
    receipt.version !== 1 ||
    receipt.gate !== 'lane-plan' ||
    receipt.lane_id !== ledger.lane_id ||
    receipt.approval_id !==
      `approval-${ledger.lane_id}-lane-plan` ||
    !Array.isArray(receipt.release_handoff_attestations) ||
    !isRecord(receipt.plan)
  ) {
    throw new TypeError(
      'release handoffs require their consumed lane-plan approval receipt',
    );
  }
  const issues = [];
  for (const attestation of receipt.release_handoff_attestations) {
    if (
      !isRecord(attestation) ||
      !hasExactKeys(attestation, [
        'issue_number',
        'issue_evidence_sha256',
        'decision',
        'changeset_only',
      ]) ||
      !Number.isSafeInteger(attestation.issue_number) ||
      attestation.issue_number <= 0 ||
      typeof attestation.issue_evidence_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(attestation.issue_evidence_sha256) ||
      attestation.decision !== 'release-or-publish-is-core' ||
      attestation.changeset_only !== false
    ) {
      throw new TypeError(
        'release handoff approval receipt contains an invalid attestation',
      );
    }
    issues.push(attestation.issue_number);
  }
  if (
    issues.length !== ledger.release_handoffs.length ||
    !issues.every((issue, index) => issue === ledger.release_handoffs[index])
  ) {
    throw new TypeError(
      'release handoffs do not match their lane-plan approval receipt',
    );
  }
};

const immutableLedgerPlan = (ledger) => ({
  version: ledger.version,
  lane_id: ledger.lane_id,
  base_branch: ledger.base_branch,
  source: {
    artifact_id: ledger.source.artifact_id,
    sha256: ledger.source.sha256,
  },
  merge_policy: ledger.merge_policy,
  pr_merge_method: ledger.pr_merge_method,
  authority_scope: ledger.authority_scope,
  retry_policy: ledger.retry_policy,
  confirmed_issues: ledger.confirmed_issues,
  suggested_but_excluded: ledger.suggested_but_excluded,
  backlog_candidates: ledger.backlog_candidates,
  release_handoffs: receiptHandoffs(ledger),
  lanes: ledger.lanes.map(({ name, queue }) => ({ name, queue })),
  dependency_graph: ledger.dependency_graph,
});

const receiptHandoffs = (ledger) =>
  ledger.release_handoffs.map((issue_number) => {
    const attestation =
      ledger.releaseHandoffApproval.release_handoff_attestations.find(
        (candidate) => candidate.issue_number === issue_number,
      );
    return {
      issue_number,
      reason: 'release-or-publish-is-core',
      issue_evidence_sha256: attestation.issue_evidence_sha256,
    };
  });

export const assertReleaseHandoffBinding = (
  ledger,
  receipt,
  artifact,
  artifactPath,
) => {
  if (ledger.release_handoffs.length === 0) {
    return;
  }
  assertReleaseHandoffApproval(ledger, receipt);
  assertContract('search-artifact-v2', artifact);
  assertLaneSourceBinding(ledger, artifact);
  if (!planIsCanonical(receipt.plan, artifact)) {
    throw new TypeError('release handoff receipt plan is not canonical');
  }
  const plannedHandoffs = receipt.plan.release_handoffs;
  if (
    plannedHandoffs.length !==
      receipt.release_handoff_attestations.length ||
    !plannedHandoffs.every((handoff, index) => {
      const attestation = receipt.release_handoff_attestations[index];
      return (
        handoff.issue_number === attestation.issue_number &&
        handoff.issue_evidence_sha256 ===
          attestation.issue_evidence_sha256 &&
        handoff.reason === attestation.decision &&
        attestation.changeset_only === false
      );
    })
  ) {
    throw new TypeError(
      'release handoff attestations do not match the approved plan',
    );
  }
  const approval = {
    gate: 'lane-plan',
    approval_id: receipt.approval_id,
    approved: true,
    release_handoff_attestations: receipt.release_handoff_attestations,
    binding_sha256: receipt.binding_sha256,
  };
  if (
    receipt.binding_sha256 !==
    approvalBinding(approval, artifact, receipt.plan)
  ) {
    throw new TypeError('release handoff approval binding does not match');
  }
  if (ledger.lane_plan_approval_sha256 !== receipt.binding_sha256) {
    throw new TypeError(
      'release handoff receipt binding does not match the ledger',
    );
  }
  const expected = readyLedger(receipt.plan, artifact, artifactPath);
  const expectedPlan = immutableLedgerPlan({
    ...expected,
    releaseHandoffApproval: receipt,
  });
  const actualPlan = immutableLedgerPlan({
    ...ledger,
    releaseHandoffApproval: receipt,
  });
  if (JSON.stringify(actualPlan) !== JSON.stringify(expectedPlan)) {
    throw new TypeError(
      'release handoff ledger does not match its approved immutable plan',
    );
  }
};
