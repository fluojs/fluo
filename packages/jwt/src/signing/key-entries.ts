import { JwtConfigurationError } from '../errors.js';
import type { JwtKeyEntry } from '../types.js';

/**
 * Rejects static key entries whose IDs cannot unambiguously select one key.
 *
 * @param keys Static JWT key entries to validate.
 */
export function assertJwtKeyEntries(keys: JwtKeyEntry[] | undefined): void {
  if (!Array.isArray(keys)) {
    return;
  }

  const keyIds = new Set<string>();

  for (const entry of keys) {
    if (typeof entry.kid !== 'string' || entry.kid.length === 0 || keyIds.has(entry.kid)) {
      throw new JwtConfigurationError('JWT key entries require non-empty unique kid values.');
    }

    keyIds.add(entry.kid);
  }
}
