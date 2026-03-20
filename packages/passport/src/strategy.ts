import { Inject } from '@konekti/core';
import { DefaultJwtVerifier, JwtExpiredTokenError, JwtInvalidTokenError } from '@konekti/jwt';

import { AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError } from './errors.js';
import type { AuthStrategy } from './types.js';

function extractBearerToken(value: string | string[] | undefined): string | undefined {
  const authorization = Array.isArray(value)
    ? value.find((header): header is string => typeof header === 'string' && header.trim().length > 0)
    : value;

  if (typeof authorization !== 'string') {
    return undefined;
  }

  const parts = authorization.trim().split(/\s+/);

  if (parts.length !== 2) {
    return undefined;
  }

  const [scheme, token] = parts;

  if (scheme.toLowerCase() !== 'bearer' || token.length === 0) {
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
    } catch (error: unknown) {
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
