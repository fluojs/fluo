function fallbackClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => fallbackClone(item));
  }

  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(source)) {
      cloned[key] = fallbackClone(item);
    }

    return cloned;
  }

  return value;
}

export function cloneConfigDictionary<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}
