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
    ]) ||
    receipt.version !== 1 ||
    receipt.gate !== 'lane-plan' ||
    receipt.lane_id !== ledger.lane_id ||
    typeof receipt.approval_id !== 'string' ||
    receipt.approval_id.length === 0 ||
    typeof receipt.binding_sha256 !== 'string' ||
    !sha256.test(receipt.binding_sha256) ||
    !Array.isArray(receipt.release_handoff_attestations)
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
      !sha256.test(attestation.issue_evidence_sha256) ||
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
