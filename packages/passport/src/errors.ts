import { FluoError, type FluoErrorOptions, isFluoError, setFluoErrorContract } from '@fluojs/core';

/**
 * Error thrown when a requested authentication strategy cannot be resolved.
 */
export class AuthStrategyResolutionError extends FluoError {
  constructor(message: string) {
    super(message, { code: 'AUTH_STRATEGY_RESOLUTION_ERROR' });
    setFluoErrorContract(this, '@fluojs/passport');
  }
}

/**
 * Error thrown when an anonymous user attempts to access a protected resource.
 */
export class AuthenticationRequiredError extends FluoError {
  constructor(message = 'Authentication required.', options: Omit<FluoErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'AUTHENTICATION_REQUIRED' });
    setFluoErrorContract(this, '@fluojs/passport');
  }
}

/**
 * Error thrown when authentication credentials are provided but invalid.
 */
export class AuthenticationFailedError extends FluoError {
  constructor(message = 'Authentication failed.', options: Omit<FluoErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'AUTHENTICATION_FAILED' });
    setFluoErrorContract(this, '@fluojs/passport');
  }
}

/**
 * Error thrown when an authentication token is well-formed but expired.
 */
export class AuthenticationExpiredError extends FluoError {
  constructor(message = 'Authentication token has expired.', options: Omit<FluoErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'AUTHENTICATION_EXPIRED' });
    setFluoErrorContract(this, '@fluojs/passport');
  }
}

const passportErrorCodes = new Set([
  'AUTH_STRATEGY_RESOLUTION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_FAILED',
  'AUTHENTICATION_EXPIRED',
]);

/**
 * Recognizes compatible Passport errors across duplicate package copies.
 * @param value Candidate thrown value.
 * @returns Whether the value satisfies the Passport error contract.
 */
export function isPassportError(value: unknown): value is FluoError {
  return isFluoError(value, '@fluojs/passport') && passportErrorCodes.has(value.code);
}
