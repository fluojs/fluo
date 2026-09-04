/**
 * Returns collection members for supported nested collection values.
 *
 * @param value Candidate collection value.
 * @returns Collection members, or `undefined` for unsupported values.
 */
export function getIterableValues(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value.values());
  if (value instanceof Map) return Array.from(value.values());
  return undefined;
}

/**
 * Identifies plain records accepted at DTO boundaries.
 *
 * @param value Candidate record value.
 * @returns Whether the value has an object or null prototype.
 */
export function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Identifies an enumerable own property that is safe to copy onto a DTO.
 *
 * @param source Source object.
 * @param key Candidate property key.
 * @returns Whether the property is own, enumerable, and not prototype-sensitive.
 */
export function isSafeOwnEnumerableProperty(source: object, key: PropertyKey): boolean {
  return !(typeof key === 'string' && dangerousKeys.has(key))
    && Object.prototype.propertyIsEnumerable.call(source, key);
}

/**
 * Copies safe enumerable own properties between records.
 *
 * @param target Destination record.
 * @param source Source record.
 */
export function assignSafeOwnEnumerableProperties(
  target: Record<PropertyKey, unknown>,
  source: Record<PropertyKey, unknown>,
): void {
  for (const key of Reflect.ownKeys(source)) {
    if (!isSafeOwnEnumerableProperty(source, key)) {
      continue;
    }

    target[key] = source[key as keyof typeof source];
  }
}
