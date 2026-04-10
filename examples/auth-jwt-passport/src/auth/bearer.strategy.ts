import { Inject } from '@konekti/core';
import type { GuardContext } from '@konekti/http';
import { DefaultJwtVerifier } from '@konekti/jwt';
import {
  AuthenticationFailedError,
  AuthenticationRequiredError,
  type AuthStrategy,
} from '@konekti/passport';

function readAuthorizationHeader(context: GuardContext): string | undefined {
  const value = context.requestContext.request.headers.authorization;

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authorization = readAuthorizationHeader(context);
    if (!authorization) {
      throw new AuthenticationRequiredError('Authorization header is required.');
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }

    try {
      return await this.verifier.verifyAccessToken(token);
    } catch (error) {
      throw new AuthenticationFailedError('Access token verification failed.', { cause: error });
    }
  }
}
