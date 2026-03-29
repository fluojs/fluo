import type { GuardContext, RequestContext } from '@konekti/http';
import { Inject, type Token } from '@konekti/core';
import { DefaultJwtVerifier, JwtExpiredTokenError, JwtInvalidTokenError } from '@konekti/jwt';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
} from './errors.js';
import type { AuthStrategy, AuthStrategyResult } from './types.js';

export interface RefreshTokenService {
  issueRefreshToken(subject: string): Promise<string>;
  rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  revokeRefreshToken(tokenId: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
}

export const REFRESH_TOKEN_SERVICE = Symbol.for('konekti.passport.refresh-token-service');

export interface RefreshTokenInput {
  refreshToken: string;
}

export interface RefreshTokenAuthResult {
  accessToken: string;
  refreshToken: string;
  subject: string;
}

@Inject([REFRESH_TOKEN_SERVICE, DefaultJwtVerifier])
export class RefreshTokenStrategy implements AuthStrategy {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
    private readonly verifier: DefaultJwtVerifier,
  ) {}

  async authenticate(context: GuardContext): Promise<AuthStrategyResult> {
    const request = context.requestContext.request;
    const refreshToken = this.extractRefreshToken(request);
    
    if (!refreshToken) {
      throw new AuthenticationRequiredError('Refresh token is required.');
    }

    try {
      const result = await this.refreshTokenService.rotateRefreshToken(refreshToken);
      const subject = await this.extractVerifiedSubject(result.accessToken);

      return {
        claims: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
        subject,
      };
    } catch (error: unknown) {
      if (error instanceof AuthenticationRequiredError
        || error instanceof AuthenticationExpiredError
        || error instanceof AuthenticationFailedError) {
        throw error;
      }
      if (error instanceof JwtExpiredTokenError) {
        throw new AuthenticationExpiredError('Refresh token has expired.');
      }
      if (error instanceof JwtInvalidTokenError) {
        throw new AuthenticationFailedError('Refresh token is invalid or has been reused.');
      }
      throw new AuthenticationFailedError('Refresh token authentication failed.');
    }
  }

  private extractRefreshToken(request: RequestContext['request']): string | undefined {
    if (request.body && typeof request.body === 'object' && 'refreshToken' in request.body) {
      return (request.body as { refreshToken: string }).refreshToken;
    }

    const authHeaderRaw = request.headers?.authorization;
    const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7);
    }

    const customHeader = request.headers?.['x-refresh-token'];
    return Array.isArray(customHeader) ? customHeader[0] : customHeader;
  }

  private async extractVerifiedSubject(accessToken: string): Promise<string> {
    const principal = await this.verifier.verifyAccessToken(accessToken);
    const sub = principal.claims.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new AuthenticationFailedError('Access token is missing a valid subject claim.');
    }
    return sub;
  }
}

export function createRefreshTokenProviders(
  service: Token<RefreshTokenService>,
): Array<{ provide: Token<unknown>; useToken: Token<unknown> }> {
  return [
    {
      provide: REFRESH_TOKEN_SERVICE,
      useToken: service,
    },
  ];
}
