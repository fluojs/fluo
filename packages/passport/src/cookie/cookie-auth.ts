import { Inject } from '@fluojs/core';
import type { GuardContext } from '@fluojs/http';
import { DefaultJwtVerifier } from '@fluojs/jwt';

import { AuthenticationRequiredError } from '../errors.js';
import type { AuthStrategy, AuthStrategyResult } from '../types.js';

/**
 * Provides cookie-auth strategy options through dependency injection.
 */
export const COOKIE_AUTH_OPTIONS = Symbol.for('fluo.passport.cookie-auth-options');

/**
 * Configures cookie names and missing-cookie behavior for cookie-based authentication.
 */
export interface CookieAuthOptions {
  /** Cookie name used for access-token lookup. */
  accessTokenCookieName?: string;
  /** Cookie name used for refresh-token lookup. */
  refreshTokenCookieName?: string;
  /** Whether protected routes should fail immediately when the access-token cookie is missing. */
  requireAccessToken?: boolean;
}

/**
 * Supplies the default cookie names and protected-route requirement for cookie auth.
 */
export const DEFAULT_COOKIE_AUTH_OPTIONS: Required<CookieAuthOptions> = {
  accessTokenCookieName: 'access_token',
  refreshTokenCookieName: 'refresh_token',
  requireAccessToken: true,
};

/**
 * Normalizes optional cookie-auth settings into a fully populated options object.
 *
 * @param options Partial cookie-auth configuration supplied by the caller.
 * @returns Cookie-auth options with defaults applied.
 */
export function normalizeCookieAuthOptions(options?: CookieAuthOptions): Required<CookieAuthOptions> {
  return {
    accessTokenCookieName: options?.accessTokenCookieName ?? DEFAULT_COOKIE_AUTH_OPTIONS.accessTokenCookieName,
    refreshTokenCookieName: options?.refreshTokenCookieName ?? DEFAULT_COOKIE_AUTH_OPTIONS.refreshTokenCookieName,
    requireAccessToken: options?.requireAccessToken ?? DEFAULT_COOKIE_AUTH_OPTIONS.requireAccessToken,
  };
}

/**
 * Authenticates requests by reading and verifying JWTs from HTTP cookies.
 *
 * @remarks
 * When `requireAccessToken` is `false`, missing cookies produce an explicit
 * unauthenticated result. Routes still need `@UseOptionalAuth(...)` to allow
 * guest access; protected `@UseAuth(...)` routes continue to reject requests
 * without an access-token cookie.
 */
@Inject(DefaultJwtVerifier, COOKIE_AUTH_OPTIONS)
export class CookieAuthStrategy implements AuthStrategy {
  private readonly options: Required<CookieAuthOptions>;

  constructor(
    private readonly verifier: DefaultJwtVerifier,
    options?: CookieAuthOptions,
  ) {
    this.options = normalizeCookieAuthOptions(options);
  }

  async authenticate(context: GuardContext): Promise<AuthStrategyResult> {
    const request = context.requestContext.request;
    const cookies = request.cookies;

    if (!cookies || typeof cookies !== 'object') {
      if (this.options.requireAccessToken) {
        throw new AuthenticationRequiredError('Access token cookie is required.');
      }

      return { authenticated: false };
    }

    const accessToken = cookies[this.options.accessTokenCookieName];

    if (!accessToken) {
      if (this.options.requireAccessToken) {
        throw new AuthenticationRequiredError('Access token cookie is required.');
      }

      return { authenticated: false };
    }

    try {
      const principal = await this.verifier.verifyAccessToken(accessToken);

      return {
        audience: principal.audience,
        claims: principal.claims,
        issuer: principal.issuer,
        roles: principal.roles,
        scopes: principal.scopes,
        subject: principal.subject,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new AuthenticationRequiredError(error.message);
      }

      throw new AuthenticationRequiredError('Access token verification failed.');
    }
  }
}

/**
 * Identifies the built-in cookie authentication strategy.
 */
export const COOKIE_AUTH_STRATEGY_NAME = 'cookie';
