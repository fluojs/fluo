import { fallbackClone } from '@konekti/core/internal';
import type { CqrsEventType, IEvent } from './types.js';

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return fallbackClone(value) as T;
  }
}

/**
 * Creates an isolated event instance by cloning the source payload before rehydrating the event prototype.
 *
 * @param eventType Event class whose prototype should back the isolated event.
 * @param source Source payload to clone and assign onto the event instance.
 * @returns A detached event instance with the requested event prototype.
 */
export function createIsolatedEvent<TEvent extends IEvent>(eventType: CqrsEventType<TEvent>, source: unknown): TEvent {
  const clonedPayload = cloneValue(source);

  if (typeof clonedPayload !== 'object' || clonedPayload === null) {
    return clonedPayload as TEvent;
  }

  return Object.assign(Object.create(eventType.prototype) as object, clonedPayload) as TEvent;
}
