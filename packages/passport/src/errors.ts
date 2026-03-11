import { KonektiError } from '@konekti/core';

export class AuthStrategyResolutionError extends KonektiError {
  constructor(message: string) {
    super(message, { code: 'AUTH_STRATEGY_RESOLUTION_ERROR' });
  }
}

export class AuthenticationRequiredError extends KonektiError {
  constructor(message = 'Authentication required.') {
    super(message, { code: 'AUTHENTICATION_REQUIRED' });
  }
}

export class AuthenticationFailedError extends KonektiError {
  constructor(message = 'Authentication failed.') {
    super(message, { code: 'AUTHENTICATION_FAILED' });
  }
}

export class AuthenticationExpiredError extends KonektiError {
  constructor(message = 'Authentication token has expired.') {
    super(message, { code: 'AUTHENTICATION_EXPIRED' });
  }
}
