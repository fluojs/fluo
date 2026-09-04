/**
 * Normalizes a public Drizzle registration name before it becomes part of a DI token.
 *
 * @internal
 * @param name Optional registration name supplied by a module or token helper.
 * @returns The trimmed registration name, or `undefined` for the default registration.
 */
export function normalizeDrizzleRegistrationName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new Error('DrizzleModule name must be a non-empty string when provided.');
  }

  return normalizedName;
}
