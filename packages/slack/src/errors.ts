/**
 * Base error type for caller-visible Slack module configuration failures.
 */
export class SlackConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackConfigurationError';
  }
}

/**
 * Thrown when caller-supplied Slack message data violates the public delivery contract.
 *
 * @remarks
 * Direct messages surface this error when normalized content has no Slack-visible `text`, `blocks`, or `attachments`.
 * Notification-backed delivery also surfaces it when one dispatch resolves to more than one Slack destination and callers
 * should use `sendMany(...)` for fan-out instead.
 */
export class SlackMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackMessageValidationError';
  }
}

/**
 * Thrown when Slack delivery, transport initialization, verification, or owned-resource cleanup is blocked by lifecycle state.
 *
 * @remarks
 * Direct and notification-backed delivery require a ready service. Calls made before module initialization finishes,
 * after initialization fails, or after shutdown starts surface this error instead of lazily creating or reusing a transport.
 * Bootstrap also wraps transport factory or `verify()` failures in this type, and application shutdown wraps failures from
 * factory-owned transport cleanup so callers can distinguish lifecycle failures from provider delivery failures.
 */
export class SlackLifecycleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SlackLifecycleError';
  }
}

/**
 * Thrown when one concrete Slack transport reports a caller-visible delivery failure.
 */
export class SlackTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackTransportError';
  }
}
