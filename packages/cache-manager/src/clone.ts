/**
 * Clone cache value.
 *
 * @param value The value.
 * @returns The clone cache value result.
 */
export function cloneCacheValue<T>(value: T): T {
  return structuredClone(value);
}
