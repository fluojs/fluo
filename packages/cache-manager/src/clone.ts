export function cloneCacheValue<T>(value: T): T {
  return structuredClone(value);
}
