import type {
  NotificationDispatchRequest,
  NotificationLifecycleEvent,
  NotificationSnapshot,
  NotificationSnapshotArrayBuffer,
  NotificationSnapshotArrayBufferView,
  NotificationSnapshotDate,
  NotificationSnapshotMap,
  NotificationSnapshotRegExp,
  NotificationSnapshotSet,
  NotificationSnapshotUrl,
  NotificationSnapshotUrlSearchParams,
} from './types.js';

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
  return freezeSnapshot(
    createLifecycleSnapshot(event, new Map<object, object>()),
  ) as NotificationLifecycleEvent<TRequest>;
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
    clone.lastIndex = value.lastIndex;
    seen.set(value, clone);

    return clone as T;
  }

  if (value instanceof ArrayBuffer) {
    const clone = value.slice(0);
    seen.set(value, clone);

    return clone as T;
  }

  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer)) {
      throw new TypeError('Notification snapshots only support ArrayBuffer-backed views.');
    }

    const buffer = cloneSnapshot(value.buffer, seen);
    const clone = cloneArrayBufferView(value, buffer);
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

  assertSnapshotObjectIsDataOnly(value);
  const clone: object = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
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

function createLifecycleSnapshot<T>(value: T, seen: Map<object, object>): NotificationSnapshot<T> {
  if (value === null || typeof value !== 'object') {
    return value as NotificationSnapshot<T>;
  }

  const existing = seen.get(value);

  if (existing) {
    return existing as NotificationSnapshot<T>;
  }

  if (value instanceof Date) {
    const snapshot: NotificationSnapshotDate = {
      epochMilliseconds: Number.isNaN(value.getTime()) ? null : value.getTime(),
      kind: 'Date',
    };
    seen.set(value, snapshot);

    return snapshot as NotificationSnapshot<T>;
  }

  if (value instanceof URL) {
    const snapshot: NotificationSnapshotUrl = { href: value.href, kind: 'URL' };
    seen.set(value, snapshot);

    return snapshot as NotificationSnapshot<T>;
  }

  if (value instanceof URLSearchParams) {
    const snapshot: NotificationSnapshotUrlSearchParams = {
      kind: 'URLSearchParams',
      query: value.toString(),
    };
    seen.set(value, snapshot);

    return snapshot as NotificationSnapshot<T>;
  }

  if (value instanceof RegExp) {
    const snapshot: NotificationSnapshotRegExp = {
      flags: value.flags,
      kind: 'RegExp',
      lastIndex: value.lastIndex,
      source: value.source,
    };
    seen.set(value, snapshot);

    return snapshot as NotificationSnapshot<T>;
  }

  if (value instanceof ArrayBuffer) {
    const snapshot: NotificationSnapshotArrayBuffer = {
      byteLength: value.byteLength,
      bytes: Array.from(new Uint8Array(value)),
      kind: 'ArrayBuffer',
    };
    seen.set(value, snapshot);

    return snapshot as NotificationSnapshot<T>;
  }

  if (ArrayBuffer.isView(value)) {
    const snapshot: NotificationSnapshotArrayBufferView = {
      byteLength: value.byteLength,
      byteOffset: value.byteOffset,
      bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      kind: 'ArrayBufferView',
      view: Object.prototype.toString.call(value).slice(8, -1),
    };
    seen.set(value, snapshot);

    return snapshot as NotificationSnapshot<T>;
  }

  if (value instanceof Map) {
    const snapshot: { entries: unknown[]; kind: 'Map' } = { entries: [], kind: 'Map' };
    seen.set(value, snapshot);

    for (const [key, entry] of value) {
      snapshot.entries.push([
        createLifecycleSnapshot(key, seen),
        createLifecycleSnapshot(entry, seen),
      ]);
    }

    return snapshot as NotificationSnapshotMap<unknown, unknown> as NotificationSnapshot<T>;
  }

  if (value instanceof Set) {
    const snapshot: { kind: 'Set'; values: unknown[] } = { kind: 'Set', values: [] };
    seen.set(value, snapshot);

    for (const entry of value) {
      snapshot.values.push(createLifecycleSnapshot(entry, seen));
    }

    return snapshot as NotificationSnapshotSet<unknown> as NotificationSnapshot<T>;
  }

  assertSnapshotObjectIsDataOnly(value);
  const snapshot: object = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, snapshot);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!descriptor) {
      continue;
    }

    if ('value' in descriptor) {
      descriptor.value = createLifecycleSnapshot(descriptor.value, seen);
    }

    Object.defineProperty(snapshot, key, descriptor);
  }

  return snapshot as NotificationSnapshot<T>;
}

function freezeSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }

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

interface TypedArrayConstructor {
  new (buffer: ArrayBuffer, byteOffset?: number, length?: number): ArrayBufferView;
}

function cloneArrayBufferView(value: ArrayBufferView, buffer: ArrayBuffer): ArrayBufferView {
  if (value instanceof DataView) {
    return new DataView(buffer, value.byteOffset, value.byteLength);
  }

  const typedArray = value as ArrayBufferView & {
    readonly constructor: TypedArrayConstructor;
    readonly length: number;
  };

  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
}

function assertSnapshotObjectIsDataOnly(value: object): void {
  const prototype = Object.getPrototypeOf(value);

  if (
    (Array.isArray(value) && prototype !== Array.prototype)
    || (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype)
  ) {
    throw new TypeError('Notification snapshots only support data properties on plain objects.');
  }

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (descriptor && !('value' in descriptor)) {
      throw new TypeError('Notification snapshots only support data properties on plain objects.');
    }
  }
}
