import { FluoError, isFluoError, setFluoErrorContract } from '@fluojs/core';

/**
 * Error thrown when JWT verification fails due to signature or structural issues.
 */
export class JwtVerificationError extends FluoError {
  constructor(message: string, options: { cause?: unknown; code?: string } = {}) {
    super(message, {
      cause: options.cause,
      code: options.code ?? 'JWT_VERIFICATION_ERROR',
    });
    setFluoErrorContract(this, '@fluojs/jwt');
  }
}

/**
 * Error thrown when a provided JWT string is malformed or not a valid token.
 */
export class JwtInvalidTokenError extends JwtVerificationError {
  constructor(message = 'Invalid JWT.') {
    super(message, { code: 'JWT_INVALID_TOKEN' });
  }
}

/**
 * Error thrown when a JWT is valid but has exceeded its expiration time.
 */
export class JwtExpiredTokenError extends JwtVerificationError {
  constructor(message = 'JWT has expired.') {
    super(message, { code: 'JWT_EXPIRED' });
  }
}

/**
 * Error thrown when the JWT module is misconfigured (e.g. missing keys).
 */
export class JwtConfigurationError extends FluoError {
  constructor(message: string) {
    super(message, { code: 'JWT_CONFIGURATION_ERROR' });
    setFluoErrorContract(this, '@fluojs/jwt');
  }
}

const jwtErrorCodes = new Set([
  'JWT_VERIFICATION_ERROR',
  'JWT_INVALID_TOKEN',
  'JWT_EXPIRED',
  'JWT_CONFIGURATION_ERROR',
]);

/**
 * Recognizes compatible JWT errors across duplicate package copies.
 * @param value Candidate thrown value.
 * @returns Whether the value satisfies the JWT error contract.
 */
export function isJwtError(value: unknown): value is JwtVerificationError | JwtConfigurationError {
  return isFluoError(value, '@fluojs/jwt') && jwtErrorCodes.has(value.code);
}
