import { createHash } from 'node:crypto';

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
};

export const approvalBinding = (
  approval: Readonly<Record<string, unknown>>,
  artifact: Readonly<Record<string, unknown>>,
  plan: Readonly<Record<string, unknown>>,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonicalValue({
          version: 1,
          gate: approval['gate'],
          approval_id: approval['approval_id'],
          artifact_id: artifact['artifact_id'],
          artifact_sha256: artifact['sha256'],
          issue_numbers: approval['issue_numbers'] ?? [],
          plan,
        }),
      ),
    )
    .digest('hex');
