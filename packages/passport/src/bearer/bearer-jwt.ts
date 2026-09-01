import { Inject } from '@fluojs/core';
import { getRequestHeader, type GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier, JwtExpiredTokenError, JwtInvalidTokenError } from '@fluojs/jwt';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
} from '../errors.js';
import type { AuthStrategy, AuthStrategyRegistration, AuthStrategyResult } from '../types.js';

/**
 * Identifies the built-in bearer JWT strategy in the `PassportModule` strategy registry.
 *
 * @remarks
 * The name is intentionally `'jwt'` so existing routes stay on `@UseAuth('jwt')`
 * when an application adopts the built-in preset instead of an application-owned
 * bearer strategy.
 */
export const BEARER_JWT_STRATEGY_NAME = 'jwt';

const BEARER_CREDENTIAL = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseBearerCredential(authorization: string): string | undefined {
  return BEARER_CREDENTIAL.exec(authorization)?.[1];
}

function addBearerChallenge(context: GuardContext, value = 'Bearer'): void {
  context.requestContext.response?.setHeader('WWW-Authenticate', value);
}

function readAuthorizationHeader(context: GuardContext): string | undefined {
  const value = getRequestHeader(context.requestContext.request, 'Authorization');

  if (isNonEmptyString(value)) {
    return value;
  }

  if (Array.isArray(value) && isNonEmptyString(value[0])) {
    return value[0];
  }

  return undefined;
}

/**
 * Authenticates requests by verifying `Authorization: Bearer <token>` credentials.
 *
 * @remarks
 * Credential extraction is strict and matches the documented preset contract:
 * an absent or empty `Authorization` header (including an array-valued header
 * whose first entry is empty) raises {@link AuthenticationRequiredError}; a
 * wrong-scheme or malformed header raises {@link AuthenticationFailedError}.
 * Credentials use the RFC 6750 `b64token` grammar: one or more ASCII letters,
 * digits, `-`, `.`, `_`, `~`, `+`, or `/`, followed only by optional trailing
 * `=` padding. Missing or malformed credentials set the bare
 * `WWW-Authenticate: Bearer` challenge, while expired and invalid verifier
 * failures set `WWW-Authenticate: Bearer error="invalid_token"`;
 * an expired token raises {@link AuthenticationExpiredError} with the original
 * `JwtExpiredTokenError` preserved as `cause`; an invalid token raises
 * {@link AuthenticationFailedError} with the original `JwtInvalidTokenError`
 * preserved as `cause`; JWT configuration and verifier-provider errors
 * propagate unchanged. The Bearer scheme is matched case-insensitively per RFC
 * 7235 and is separated from the token by one or more ASCII spaces. When an
 * adapter surfaces an array-valued `Authorization` header, only the first entry
 * is read.
 *
 * The strategy returns the normalized `JwtPrincipal` produced by
 * `DefaultJwtVerifier.verifyAccessToken(...)` unchanged, so `subject`,
 * `claims`, `issuer`, `audience`, `roles`, and `scopes` normalization stays
 * owned by `@fluojs/jwt` and `AuthGuard` continues to write the principal to
 * `requestContext.principal`.
 *
 * Register the class as a provider in the module that imports
 * `PassportModule.forRoot(...)` (which also imports `JwtModule.forRoot(...)` so
 * `DefaultJwtVerifier` resolves), and register its name with
 * {@link createBearerJwtStrategyRegistration}.
 *
 * Use a custom `AuthStrategy` instead when the application needs token
 * revocation, account-state checks, alternate extraction, or other
 * application-owned policy beyond this contract.
 */
@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext): Promise<AuthStrategyResult> {
    const authorization = readAuthorizationHeader(context);

    if (!authorization) {
      addBearerChallenge(context);
      throw new AuthenticationRequiredError('Authorization header is required.');
    }

    const token = parseBearerCredential(authorization);

    if (!token) {
      addBearerChallenge(context);
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }

    try {
      return await this.verifier.verifyAccessToken(token);
    } catch (error: unknown) {
      if (error instanceof JwtExpiredTokenError) {
        addBearerChallenge(context, 'Bearer error="invalid_token"');
        throw new AuthenticationExpiredError('Access token has expired.', { cause: error });
      }

      if (error instanceof JwtInvalidTokenError) {
        addBearerChallenge(context, 'Bearer error="invalid_token"');
        throw new AuthenticationFailedError('Access token verification failed.', { cause: error });
      }

      throw error;
    }
  }
}

/**
 * Creates the passport strategy registration for the built-in bearer JWT preset.
 *
 * @returns The named strategy registration consumed by `PassportModule.forRoot(...)`.
 *
 * @example
 * ```ts
 * import { Module } from '@fluojs/core';
 * import { JwtModule } from '@fluojs/jwt';
 * import {
 *   BEARER_JWT_STRATEGY_NAME,
 *   BearerJwtStrategy,
 *   createBearerJwtStrategyRegistration,
 *   PassportModule,
 * } from '@fluojs/passport';
 *
 * @Module({
 *   imports: [
 *     JwtModule.forRoot({
 *       algorithms: ['HS256'],
 *       audience: 'my-app',
 *       issuer: 'my-api',
 *       secret: 'your-secure-secret',
 *     }),
 *     PassportModule.forRoot(
 *       { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
 *       [createBearerJwtStrategyRegistration()],
 *     ),
 *   ],
 *   providers: [BearerJwtStrategy],
 * })
 * export class AuthModule {}
 * ```
 */
export function createBearerJwtStrategyRegistration(): AuthStrategyRegistration {
  return {
    name: BEARER_JWT_STRATEGY_NAME,
    token: BearerJwtStrategy,
  };
}
