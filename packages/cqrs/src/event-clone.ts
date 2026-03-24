import type { CqrsEventType, IEvent } from './types.js';

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

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}

export function createIsolatedEvent<TEvent extends IEvent>(eventType: CqrsEventType<TEvent>, source: unknown): TEvent {
  const clonedPayload = cloneValue(source);

  if (typeof clonedPayload !== 'object' || clonedPayload === null) {
    return clonedPayload as TEvent;
  }

  return Object.assign(Object.create(eventType.prototype) as object, clonedPayload) as TEvent;
}
