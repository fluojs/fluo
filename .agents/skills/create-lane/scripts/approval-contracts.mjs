import { createHash } from 'node:crypto';

const approvalGates = [
  'confirmed-issues',
  'suggested-additions',
  'lane-plan',
];
const safeIdentifier = /^(?!.*(?:\.|\.lock)$)[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const sha256 = /^[a-f0-9]{64}$/u;

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

const isIssueArray = (value) =>
  Array.isArray(value) &&
  value.every((issue) => Number.isSafeInteger(issue) && issue > 0) &&
  new Set(value).size === value.length;

const releaseHandoffAttestations = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }
  const attestations = [];
  for (const attestation of value) {
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
      !sha256.test(attestation.issue_evidence_sha256) ||
      attestation.decision !== 'release-or-publish-is-core' ||
      attestation.changeset_only !== false
    ) {
      return null;
    }
    attestations.push(attestation);
  }
  return new Set(attestations.map(({ issue_number }) => issue_number)).size ===
    attestations.length
    ? attestations
    : null;
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

export const approvalBinding = (approval, artifact, plan) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonicalValue({
          version: 1,
          gate: approval.gate,
          approval_id: approval.approval_id,
          artifact_id: artifact.artifact_id,
          artifact_sha256: artifact.sha256,
          issue_numbers: approval.issue_numbers ?? [],
          ...(Array.isArray(approval.release_handoff_attestations) &&
          approval.release_handoff_attestations.length > 0
            ? {
                release_handoff_attestations:
                  approval.release_handoff_attestations,
              }
            : {}),
          plan,
        }),
      ),
    )
    .digest('hex');

export const validateApprovals = (approvals, artifact, plan) => {
  if (!Array.isArray(approvals) || approvals.length !== approvalGates.length) {
    return 'approval_not_distinct';
  }
  const approvalIds = new Set();
  for (const [index, approval] of approvals.entries()) {
    const keys =
      approvalGates[index] === 'lane-plan'
        ? [
            'gate',
            'approval_id',
            'approved',
            'release_handoff_attestations',
            'binding_sha256',
          ]
        : [
            'gate',
            'approval_id',
            'approved',
            'issue_numbers',
            'binding_sha256',
          ];
    if (
      !isRecord(approval) ||
      !hasExactKeys(approval, keys) ||
      approval.gate !== approvalGates[index] ||
      approval.approved !== true ||
      typeof approval.approval_id !== 'string' ||
      !safeIdentifier.test(approval.approval_id)
    ) {
      return 'approval_not_distinct';
    }
    approvalIds.add(approval.approval_id);
  }
  if (approvalIds.size !== approvalGates.length) {
    return 'approval_not_distinct';
  }
  if (
    approvals.some(
      (approval) =>
        approval.approval_id !==
        `approval-${plan.lane_id}-${approval.gate}`,
    )
  ) {
    return 'approval_binding_mismatch';
  }
  const confirmed = approvals[0].issue_numbers;
  const suggested = approvals[1].issue_numbers;
  if (
    !isIssueArray(confirmed) ||
    !isIssueArray(suggested) ||
    confirmed.some((issue) => suggested.includes(issue)) ||
    confirmed.length !== artifact.selected_issues.length ||
    !artifact.selected_issues.every((issue, index) => issue === confirmed[index])
  ) {
    return 'approval_not_distinct';
  }
  const finalIssues = [...confirmed, ...suggested];
  if (
    finalIssues.length !== plan.confirmed_issues.length ||
    !finalIssues.every((issue, index) => issue === plan.confirmed_issues[index])
  ) {
    return 'approval_not_distinct';
  }
  const planHandoffs = Array.isArray(plan.release_handoffs)
    ? plan.release_handoffs
    : [];
  const attestations = releaseHandoffAttestations(
    approvals[2].release_handoff_attestations,
  );
  if (
    attestations === null ||
    attestations.length !== planHandoffs.length ||
    !attestations.every((attestation, index) => {
      const handoff = planHandoffs[index];
      return (
        isRecord(handoff) &&
        attestation.issue_number === handoff.issue_number &&
        attestation.issue_evidence_sha256 ===
          handoff.issue_evidence_sha256
      );
    })
  ) {
    return 'release_handoff_attestation_mismatch';
  }
  return approvals.some(
    (approval) =>
      approval.binding_sha256 !== approvalBinding(approval, artifact, plan),
  )
    ? 'approval_binding_mismatch'
    : null;
};
