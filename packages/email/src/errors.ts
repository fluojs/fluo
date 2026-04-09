/**
 * Base error type for caller-visible email module configuration failures.
 */
export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailConfigurationError';
  }
}

/**
 * Thrown when an email message or notification payload is missing one required contract field.
 */
export class EmailMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailMessageValidationError';
  }
}
