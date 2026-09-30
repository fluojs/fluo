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
