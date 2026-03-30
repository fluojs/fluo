import { KonektiError, type KonektiErrorOptions } from '@konekti/core';

export class AuthStrategyResolutionError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'AUTH_STRATEGY_RESOLUTION_ERROR' });
  }
}

export class AuthenticationRequiredError extends KonektiError {
  constructor(message = 'Authentication required.', options: Omit<KonektiErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'AUTHENTICATION_REQUIRED' });
  }
}

export class AuthenticationFailedError extends KonektiError {
  constructor(message = 'Authentication failed.', options: Omit<KonektiErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'AUTHENTICATION_FAILED' });
  }
}

export class AuthenticationExpiredError extends KonektiError {
  constructor(message = 'Authentication token has expired.', options: Omit<KonektiErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'AUTHENTICATION_EXPIRED' });
  }
}
