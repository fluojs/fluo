import { KonektiError } from '@fluojs/core';

export class JwtVerificationError extends KonektiError {
  constructor(message: string, options: { cause?: unknown; code?: string } = {}) {
    super(message, {
      cause: options.cause,
      code: options.code ?? 'JWT_VERIFICATION_ERROR',
    });
  }
}

export class JwtInvalidTokenError extends JwtVerificationError {
  constructor(message = 'Invalid JWT.') {
    super(message, { code: 'JWT_INVALID_TOKEN' });
  }
}

export class JwtExpiredTokenError extends JwtVerificationError {
  constructor(message = 'JWT has expired.') {
    super(message, { code: 'JWT_EXPIRED' });
  }
}

export class JwtConfigurationError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'JWT_CONFIGURATION_ERROR' });
  }
}
