import type { NotificationDispatchRequest, NotificationLifecycleEvent } from './types.js';

/**
 * Copies and freezes one notification envelope at dispatch admission.
 *
 * @param notification Notification envelope supplied by the caller.
 * @returns The immutable dispatch snapshot.
 * @internal
 */
export function createNotificationDispatchSnapshot<TRequest extends NotificationDispatchRequest>(
  notification: TRequest,
): TRequest {
  return freezeSnapshot(cloneSnapshot(notification, new Map<object, object>()));
}

/**
 * Copies and freezes one lifecycle event before publication.
 *
 * @param event Lifecycle event details captured by the dispatch service.
 * @returns The immutable lifecycle event snapshot.
 * @internal
 */
export function createNotificationLifecycleEventSnapshot<TRequest extends NotificationDispatchRequest>(
  event: {
    channel: string;
    deliveryId?: string;
    error?: {
      message: string;
      name: string;
    };
    name: NotificationLifecycleEvent<TRequest>['name'];
    notification: TRequest;
    occurredAt: string;
  },
): NotificationLifecycleEvent<TRequest> {
  return freezeSnapshot(cloneSnapshot(event, new Map<object, object>())) as NotificationLifecycleEvent<TRequest>;
}

function cloneSnapshot<T>(value: T, seen: Map<object, object>): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const existing = seen.get(value);

  if (existing) {
    return existing as T;
  }

  if (value instanceof Date) {
    const clone = new Date(value.getTime());
    seen.set(value, clone);

    return clone as T;
  }

  if (value instanceof URL) {
    const clone = new URL(value.href);
    seen.set(value, clone);

    return clone as T;
  }

  if (value instanceof URLSearchParams) {
    const clone = new URLSearchParams(value);
    seen.set(value, clone);

    return clone as T;
  }

  if (value instanceof RegExp) {
    const clone = new RegExp(value.source, value.flags);
    seen.set(value, clone);

    return clone as T;
  }

  if (value instanceof Map) {
    const clone = new Map();
    seen.set(value, clone);

    for (const [key, entry] of value) {
      clone.set(cloneSnapshot(key, seen), cloneSnapshot(entry, seen));
    }

    return clone as T;
  }

  if (value instanceof Set) {
    const clone = new Set();
    seen.set(value, clone);

    for (const entry of value) {
      clone.add(cloneSnapshot(entry, seen));
    }

    return clone as T;
  }

  const clone: object = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!descriptor) {
      continue;
    }

    if ('value' in descriptor) {
      descriptor.value = cloneSnapshot(descriptor.value, seen);
    }

    Object.defineProperty(clone, key, descriptor);
  }

  return clone as T;
}

function freezeSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      freezeSnapshot(key, seen);
      freezeSnapshot(entry, seen);
    }
  } else if (value instanceof Set) {
    for (const entry of value) {
      freezeSnapshot(entry, seen);
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (descriptor && 'value' in descriptor) {
        freezeSnapshot(descriptor.value, seen);
      }
    }
  }

  return Object.freeze(value);
}
