/**
 * Clone JSON-like OpenAPI snapshot values while preserving function and class references.
 *
 * @param value Snapshot value to clone.
 * @returns A detached clone of arrays and plain objects in the value graph.
 */
export function cloneSnapshotValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneSnapshotValue(entry)) as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const clone: Record<PropertyKey, unknown> = {};

  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneSnapshotValue((value as Record<PropertyKey, unknown>)[key]);
  }

  return clone as T;
}

/**
 * Recursively freeze arrays and objects in an OpenAPI snapshot.
 *
 * @param value Snapshot value to freeze.
 * @returns The same value after freezing nested object references.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }

  return Object.freeze(value);
}

/**
 * Create a detached immutable OpenAPI snapshot.
 *
 * @param value Snapshot value to clone and freeze.
 * @returns An immutable clone that cannot be mutated through caller-owned references.
 */
export function createFrozenSnapshot<T>(value: T): T {
  return deepFreeze(cloneSnapshotValue(value));
}
