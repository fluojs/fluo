/**
 * Base error type for caller-visible Discord module configuration failures.
 */
export class DiscordConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordConfigurationError';
  }
}

/**
 * Thrown when a Discord message or notification payload is missing one required contract field.
 */
export class DiscordMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordMessageValidationError';
  }
}

/**
 * Thrown when one concrete Discord transport reports a caller-visible delivery failure.
 */
export class DiscordTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordTransportError';
  }
}
