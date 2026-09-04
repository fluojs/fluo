export function normalizeEnumValues(values: Record<string, unknown> | readonly unknown[]): readonly unknown[] {
  if (Array.isArray(values)) {
    return values;
  }

  const entries = Object.entries(values);
  const ownMembers = new Map(entries);
  const normalized = new Set<unknown>();

  for (const [key, value] of entries) {
    const numericValue = Number(key);
    const hasForwardMember = typeof value === 'string' && ownMembers.has(value);
    const forwardValue = typeof value === 'string' ? ownMembers.get(value) : undefined;
    const isReverseEntry =
      typeof value === 'string' &&
      key === String(numericValue) &&
      ((typeof forwardValue === 'number' && key === String(forwardValue)) ||
        (value === '__proto__' && !hasForwardMember && Number.isFinite(numericValue)));

    normalized.add(isReverseEntry ? numericValue : value);
  }

  return [...normalized];
}
