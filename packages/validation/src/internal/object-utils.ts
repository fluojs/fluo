export function getIterableValues(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value.values());
  if (value instanceof Map) return Array.from(value.values());
  return undefined;
}

export function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

export function assignSafeOwnEnumerableProperties(
  target: Record<PropertyKey, unknown>,
  source: Record<PropertyKey, unknown>,
): void {
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key === 'string' && dangerousKeys.has(key)) {
      continue;
    }

    if (!Object.prototype.propertyIsEnumerable.call(source, key)) {
      continue;
    }

    target[key] = source[key as keyof typeof source];
  }
}
