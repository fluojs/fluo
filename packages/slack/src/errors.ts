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
 * Thrown when a Slack message or notification payload is missing one required contract field.
 */
export class SlackMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackMessageValidationError';
  }
}

/**
 * Thrown when Slack delivery, transport initialization, verification, or cleanup is blocked by lifecycle state.
 *
 * @remarks
 * Direct and notification-backed delivery require a ready service. Calls made before module initialization finishes,
 * after initialization fails, or after shutdown starts surface this error instead of lazily creating or reusing a transport.
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
