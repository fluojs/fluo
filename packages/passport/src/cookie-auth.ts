import { Inject } from '@konekti/core';
import type { GuardContext } from '@konekti/http';
import { DefaultJwtVerifier } from '@konekti/jwt';

import { AuthenticationRequiredError } from './errors.js';
import type { AuthStrategy, AuthStrategyResult } from './types.js';

export const COOKIE_AUTH_OPTIONS = Symbol.for('konekti.passport.cookie-auth-options');

export interface CookieAuthOptions {
  accessTokenCookieName?: string;
  refreshTokenCookieName?: string;
  requireAccessToken?: boolean;
}

export const DEFAULT_COOKIE_AUTH_OPTIONS: Required<CookieAuthOptions> = {
  accessTokenCookieName: 'access_token',
  refreshTokenCookieName: 'refresh_token',
  requireAccessToken: true,
};

export function normalizeCookieAuthOptions(options?: CookieAuthOptions): Required<CookieAuthOptions> {
  return {
    accessTokenCookieName: options?.accessTokenCookieName ?? DEFAULT_COOKIE_AUTH_OPTIONS.accessTokenCookieName,
    refreshTokenCookieName: options?.refreshTokenCookieName ?? DEFAULT_COOKIE_AUTH_OPTIONS.refreshTokenCookieName,
    requireAccessToken: options?.requireAccessToken ?? DEFAULT_COOKIE_AUTH_OPTIONS.requireAccessToken,
  };
}

@Inject([DefaultJwtVerifier, COOKIE_AUTH_OPTIONS])
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

    const accessToken = cookies[this.options.accessTokenCookieName];

    if (!accessToken) {
      if (this.options.requireAccessToken) {
        throw new AuthenticationRequiredError('Access token cookie is required.');
      }

      return {
        claims: {},
        subject: 'anonymous',
      };
    }

    try {
      const principal = await this.verifier.verifyAccessToken(accessToken);

      return {
        claims: principal.claims,
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

export const COOKIE_AUTH_STRATEGY_NAME = 'cookie';
