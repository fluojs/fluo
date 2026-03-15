import { Inject } from '@konekti/core';
import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
  type AuthStrategy,
} from '@konekti/passport';

import { JwtExpiredTokenError, JwtInvalidTokenError } from './errors.js';
import { DefaultJwtVerifier } from './verifier.js';

function extractBearerToken(value: string | string[] | undefined): string | undefined {
  const authorization = Array.isArray(value) ? value[0] : value;

  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return undefined;
  }

  return token;
}

@Inject([DefaultJwtVerifier])
export class JwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: Parameters<AuthStrategy['authenticate']>[0]) {
    const token = extractBearerToken(context.requestContext.request.headers.authorization);

    if (!token) {
      throw new AuthenticationRequiredError();
    }

    try {
      return await this.verifier.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof JwtExpiredTokenError) {
        throw new AuthenticationExpiredError();
      }

      if (error instanceof JwtInvalidTokenError) {
        throw new AuthenticationFailedError();
      }

      throw error;
    }
  }
}
