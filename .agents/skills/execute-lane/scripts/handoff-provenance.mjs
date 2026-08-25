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

const stages = [
  'confirmed-issues',
  'suggested-additions',
  'lane-plan',
];

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

const canonicalValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
};

const sameValue = (left, right) =>
  JSON.stringify(canonicalValue(left)) ===
  JSON.stringify(canonicalValue(right));

const assertReceipt = (receipt, ledger, stage) => {
  const stageKeys =
    stage === 'lane-plan'
      ? [
          'version',
          'approval_id',
          'gate',
          'binding_sha256',
          'lane_id',
          'release_handoff_attestations',
          'plan',
        ]
      : [
          'version',
          'approval_id',
          'gate',
          'binding_sha256',
          'lane_id',
          'issue_numbers',
        ];
  if (
    !isRecord(receipt) ||
    !hasExactKeys(receipt, stageKeys) ||
    receipt.version !== 1 ||
    receipt.gate !== stage ||
    receipt.lane_id !== ledger.lane_id ||
    receipt.approval_id !== `approval-${ledger.lane_id}-${stage}` ||
    typeof receipt.binding_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(receipt.binding_sha256)
  ) {
    throw new TypeError(`Invalid ${stage} approval receipt.`);
  }
  if (
    stage === 'lane-plan'
      ? !Array.isArray(receipt.release_handoff_attestations) ||
        !isRecord(receipt.plan)
      : !Array.isArray(receipt.issue_numbers)
  ) {
    throw new TypeError(`Invalid ${stage} approval receipt payload.`);
  }
};

const approvalValue = (receipt) => ({
  gate: receipt.gate,
  approval_id: receipt.approval_id,
  approved: true,
  ...(receipt.gate === 'lane-plan'
    ? {
        release_handoff_attestations:
          receipt.release_handoff_attestations,
      }
    : { issue_numbers: receipt.issue_numbers }),
  binding_sha256: receipt.binding_sha256,
});

const immutablePlan = (ledger) => ({
  version: ledger.version,
  run_id: ledger.run_id,
  lane_id: ledger.lane_id,
  created_by: ledger.created_by,
  base_branch: ledger.base_branch,
  source: ledger.source,
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
  lane_plan_approval_sha256:
    ledger.lane_plan_approval_sha256 ?? null,
});

export const assertImmutableLaneBinding = (snapshot, canonicalLedger) => {
  if (
    !sameValue(
      immutablePlan(snapshot),
      immutablePlan(canonicalLedger),
    )
  ) {
    throw new TypeError(
      'persisted lane snapshot does not match the canonical immutable plan',
    );
  }
};

export const assertHandoffProvenance = ({
  ledger,
  receipts,
  artifact,
  artifactPath,
}) => {
  if (!Array.isArray(receipts) || receipts.length !== stages.length) {
    throw new TypeError(
      'canonical lane handoff requires all three approval receipts',
    );
  }
  for (const [index, stage] of stages.entries()) {
    assertReceipt(receipts[index], ledger, stage);
  }
  const [confirmed, additions, lanePlan] = receipts;
  assertContract('search-artifact-v2', artifact);
  assertLaneSourceBinding(ledger, artifact);
  if (!planIsCanonical(lanePlan.plan, artifact)) {
    throw new TypeError('lane-plan approval receipt is not canonical');
  }
  const initialIssues = artifact.selected_issues;
  const plannedIssues = lanePlan.plan.confirmed_issues;
  const includedIssues = plannedIssues.slice(initialIssues.length);
  if (
    !sameValue(confirmed.issue_numbers, initialIssues) ||
    !sameValue(
      plannedIssues.slice(0, initialIssues.length),
      initialIssues,
    ) ||
    !sameValue(additions.issue_numbers, includedIssues)
  ) {
    throw new TypeError(
      'approval issue sets do not match the canonical lane plan',
    );
  }
  for (const receipt of receipts) {
    if (
      receipt.binding_sha256 !==
      approvalBinding(approvalValue(receipt), artifact, lanePlan.plan)
    ) {
      throw new TypeError(
        `${receipt.gate} approval binding does not match`,
      );
    }
  }
  const expectedLedger = readyLedger(
    lanePlan.plan,
    artifact,
    artifactPath,
    ledger.release_handoffs.length === 0
      ? undefined
      : lanePlan.binding_sha256,
  );
  assertImmutableLaneBinding(ledger, expectedLedger);
};
