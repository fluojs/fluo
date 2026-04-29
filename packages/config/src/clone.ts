import { fallbackClone } from '@fluojs/core/internal';

/**
 * Clone config dictionary.
 *
 * @param value The value.
 * @returns The clone config dictionary result.
 */
export function cloneConfigDictionary<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}
