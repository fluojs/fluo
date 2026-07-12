/**
 * Validate an optional non-negative integer adapter option.
 *
 * @param name - Option name included in validation errors.
 * @param value - Optional numeric value to validate.
 */
export function validateNonNegativeIntegerOption(name: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} value: ${String(value)}. Expected a non-negative integer.`);
  }
}
