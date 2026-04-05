import { fallbackClone } from '@konekti/core/internal';

export function cloneConfigDictionary<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}
