export function fallbackClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => fallbackClone(item)) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof Map) {
    return new Map(
      Array.from((value as Map<unknown, unknown>).entries(), ([k, v]) => [k, fallbackClone(v)]),
    ) as T;
  }

  if (value instanceof Set) {
    return new Set(Array.from((value as Set<unknown>).values(), (v) => fallbackClone(v))) as T;
  }

  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(source)) {
      cloned[key] = fallbackClone(item);
    }

    return cloned as T;
  }

  return value;
}
