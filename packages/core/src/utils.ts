export function fallbackClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => fallbackClone(item)) as T;
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
