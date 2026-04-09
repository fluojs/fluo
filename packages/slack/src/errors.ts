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
 * Thrown when one concrete Slack transport reports a caller-visible delivery failure.
 */
export class SlackTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlackTransportError';
  }
}
