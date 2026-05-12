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

/**
 * Thrown when email delivery is requested after the service lifecycle has started shutting down.
 */
export class EmailLifecycleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmailLifecycleError';
  }
}
