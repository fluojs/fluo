/** HTTP-approved native destination and enhanced post-save read policy. */
export type ReactFormResultOptions<Data = unknown> = {
  readonly destination: string;
  readonly followUp: 'navigate' | 'refresh';
  /** Explicit JSON saved data, never server implementation or credentials. */
  readonly data?: Data;
  /** Application-issued nonsecret session transition after confirmed persistence. */
  readonly session?: ReactSessionChange;
};

/** A confirmed mutation result carrying the existing HTTP-owned response writer. */
export type ReactFormResult<Data = unknown> = ReactFormResultOptions<Data>;

/** One explicit application notification, not cookie or Set-Cookie inference. */
export type ReactSessionChange = {
  readonly epoch: string;
  readonly reason: 'login' | 'logout' | 'permissions';
};

/**
 * Parse the explicit session shape shared by form acknowledgements and router notifications.
 *
 * @param value Untrusted application or HTTP notification.
 * @returns A safe nonsecret epoch and transition reason, or undefined for malformed input.
 */
export function parseReactSessionChange(value: unknown): ReactSessionChange | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const epoch: unknown = Reflect.get(value, 'epoch');
  const reason: unknown = Reflect.get(value, 'reason');
  if (typeof epoch !== 'string' || epoch.trim().length === 0
    || reason !== 'login' && reason !== 'logout' && reason !== 'permissions') return undefined;
  return { epoch, reason };
}

/**
 * Copy saved data through the limited JSON boundary without invoking application hooks.
 *
 * @param value Explicit saved data.
 * @returns A detached JSON value with the same supported shape.
 * @throws TypeError For exotic objects, nonfinite numbers, unsupported members or cycles.
 */
export function copyReactFormData(value: unknown): unknown {
  const ancestors = new Set<object>();
  const copy = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null || ancestors.has(item)) {
      throw new TypeError('Saved form data must contain only finite JSON values without cycles.');
    }
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    if (array && prototype !== Array.prototype || !array && prototype !== Object.prototype && prototype !== null
      || Object.getOwnPropertySymbols(item).length !== 0) {
      throw new TypeError('Saved form data must use plain JSON objects and arrays.');
    }
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    let result: unknown;
    if (array) {
      const values: unknown[] = [];
      if (Object.keys(descriptors).length !== item.length + 1) {
        throw new TypeError('Saved form arrays cannot contain holes or extra properties.');
      }
      for (let index = 0; index < item.length; index++) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
          throw new TypeError('Saved form data cannot contain accessors or sparse arrays.');
        }
        values.push(copy(descriptor.value));
      }
      result = values;
    } else {
      const values: Record<string, unknown> = Object.create(null);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Saved form data cannot contain accessors or hidden properties.');
        }
        values[key] = copy(descriptor.value);
      }
      result = values;
    }
    ancestors.delete(item);
    return result;
  };
  return copy(value);
}
