import { Inject, InvariantError, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { GuardContext, RequestContext } from '@fluojs/http';
import { DefaultJwtVerifier, JwtExpiredTokenError, JwtInvalidTokenError } from '@fluojs/jwt';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
} from '../errors.js';
import type { AuthStrategy, AuthStrategyRegistration } from '../types.js';

/**
 * Defines the operations required to issue, rotate, and revoke refresh tokens.
 */
export interface RefreshTokenService {
  issueRefreshToken(subject: string): Promise<string>;
  rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  revokeRefreshToken(tokenId: string): Promise<void>;
  revokeAllForSubject(subject: string): Promise<void>;
}

/**
 * Identifies the active refresh-token service implementation in dependency injection.
 */
export const REFRESH_TOKEN_SERVICE = Symbol.for('fluo.passport.refresh-token-service');

/**
 * Represents the refresh-token payload accepted by refresh endpoints.
 */
export interface RefreshTokenInput {
  refreshToken: string;
}

/**
 * Captures the token pair returned after a successful refresh-token exchange.
 *
 * @remarks
 * This is the application-facing exchange payload shape refresh endpoints return to
 * clients. It is not the shape `RefreshTokenStrategy` places on `ctx.principal`;
 * that principal result is typed by {@link RefreshTokenPrincipal}.
 */
export interface RefreshTokenAuthResult {
  accessToken: string;
  refreshToken: string;
  subject: string;
}

/**
 * The principal `RefreshTokenStrategy` resolves onto `ctx.principal` after a
 * successful exchange, with the rotated token pair nested under `claims`.
 */
export interface RefreshTokenPrincipal {
  /**
   * Principal claims carrying the rotated pair under `accessToken` and `refreshToken`.
   */
  claims: Record<string, unknown> & { accessToken: string; refreshToken: string };
  /**
   * Verified subject the rotated access token was issued for.
   */
  subject: string;
}

/**
 * Identifies the built-in refresh-token authentication strategy.
 */
export const REFRESH_TOKEN_STRATEGY_NAME = 'refresh-token';

const MALFORMED_REFRESH_TOKEN = Symbol('MALFORMED_REFRESH_TOKEN');

type RefreshTokenModuleType = ModuleType;

/**
 * Configures application modules that supply refresh-token service dependencies.
 */
export interface RefreshTokenModuleImportOptions {
  /**
   * Modules that export dependencies injected into the refresh-token service.
   *
   * @remarks
   * `RefreshTokenModule` keeps ownership of a class service token. Import modules
   * that own and export its constructor dependencies so they are visible without
   * duplicating the service provider in the importing application module.
   */
  imports?: ModuleType[];
}

/**
 * Authenticates refresh-token requests and exchanges them for a fresh token pair.
 */
@Inject(REFRESH_TOKEN_SERVICE, DefaultJwtVerifier)
export class RefreshTokenStrategy implements AuthStrategy {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
    private readonly verifier: DefaultJwtVerifier,
  ) {}

  async authenticate(context: GuardContext): Promise<RefreshTokenPrincipal> {
    const request = context.requestContext.request;
    const refreshToken = this.extractRefreshToken(request);

    if (refreshToken === MALFORMED_REFRESH_TOKEN) {
      throw new AuthenticationFailedError('Refresh token is malformed.');
    }

    if (!refreshToken) {
      throw new AuthenticationRequiredError('Refresh token is required.');
    }

    const result = await this.rotateRefreshToken(refreshToken);
    const subject = await this.extractVerifiedSubject(result.accessToken);

    return {
      claims: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      subject,
    };
  }

  private async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      return await this.refreshTokenService.rotateRefreshToken(currentToken);
    } catch (error: unknown) {
      if (error instanceof AuthenticationRequiredError
        || error instanceof AuthenticationExpiredError
        || error instanceof AuthenticationFailedError) {
        throw error;
      }
      if (error instanceof JwtExpiredTokenError) {
        throw new AuthenticationExpiredError('Refresh token has expired.', { cause: error });
      }
      if (error instanceof JwtInvalidTokenError) {
        throw new AuthenticationFailedError('Refresh token is invalid or has been reused.', { cause: error });
      }
      throw error;
    }
  }

  private extractRefreshToken(request: RequestContext['request']): string | typeof MALFORMED_REFRESH_TOKEN | undefined {
    if (request.body && typeof request.body === 'object' && 'refreshToken' in request.body) {
      return this.normalizeRefreshToken((request.body as { refreshToken?: unknown }).refreshToken);
    }

    const authHeaderRaw = request.headers?.authorization;
    const authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      return this.normalizeRefreshToken(authHeader.slice(7));
    }

    const customHeader = request.headers?.['x-refresh-token'];
    return this.normalizeRefreshToken(Array.isArray(customHeader) ? customHeader[0] : customHeader);
  }

  private normalizeRefreshToken(token: unknown): string | typeof MALFORMED_REFRESH_TOKEN | undefined {
    if (token === undefined || token === null) {
      return undefined;
    }

    if (typeof token !== 'string') {
      return MALFORMED_REFRESH_TOKEN;
    }

    return token.length > 0 ? token : undefined;
  }

  private async extractVerifiedSubject(accessToken: string): Promise<string> {
    const principal = await this.verifier.verifyAccessToken(accessToken);
    if (typeof principal.subject !== 'string' || principal.subject.length === 0) {
      throw new InvariantError('Refresh token service returned an access token without a valid subject claim.');
    }

    return principal.subject;
  }
}

function isClassToken<T>(token: Token<T>): token is Extract<Token<T>, Provider> {
  return typeof token === 'function';
}

function createRefreshTokenAliasProviders(
  service: Token<RefreshTokenService>,
): Provider[] {
  return [
    ...(
      isClassToken(service) ? [service] : []
    ),
    {
      provide: REFRESH_TOKEN_SERVICE,
      useExisting: service,
    },
  ];
}

/**
 * Creates the passport strategy registration for the built-in refresh-token strategy.
 *
 * @returns The named strategy registration consumed by `PassportModule.forRoot(...)`.
 */
export function createRefreshTokenStrategyRegistration(): AuthStrategyRegistration {
  return {
    name: REFRESH_TOKEN_STRATEGY_NAME,
    token: RefreshTokenStrategy,
  };
}

/**
 * Canonical module-first entrypoint for refresh-token strategy support.
 */
export class RefreshTokenModule {
  /**
   * Registers the shared refresh-token service alias together with `RefreshTokenStrategy`.
   *
   * @param service DI token for the concrete refresh-token service implementation.
   *   Class tokens are registered inside this module.
   *   String and symbol tokens must be exported by a module passed through `options.imports`.
   * @param options Optional module imports that export class-service constructor dependencies.
   * @returns A module definition that exports `RefreshTokenStrategy` and `REFRESH_TOKEN_SERVICE`.
   * @remarks
   * To register a class service with constructor dependencies, place those
   * dependencies in an application-owned module, export them, and pass that module
   * through `options.imports`. This preserves strict
   * `duplicateProviderPolicy: 'throw'` behavior because the service class remains
   * registered exactly once by `RefreshTokenModule`. Do not re-register the service
   * class in the importing application module. String and symbol service tokens are
   * owned by and exported from a module in `options.imports`.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import {
   *   PassportModule,
   *   RefreshTokenModule,
   *   RefreshTokenStrategy,
   *   REFRESH_TOKEN_STRATEGY_NAME,
   * } from '@fluojs/passport';
   *
   * @Module({
   *   imports: [
   *     RefreshTokenModule.forRoot(MyRefreshTokenService),
   *     PassportModule.forRoot(
   *       { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
   *       [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
   *     ),
   *   ],
   * })
   * export class AuthModule {}
   * ```
   */
  static forRoot(
    service: Token<RefreshTokenService>,
    options: RefreshTokenModuleImportOptions = {},
  ): RefreshTokenModuleType {
    class RefreshTokenRuntimeModule extends RefreshTokenModule {}

    return defineModule(RefreshTokenRuntimeModule, {
      exports: [RefreshTokenStrategy, REFRESH_TOKEN_SERVICE],
      imports: options.imports ? [...options.imports] : undefined,
      providers: [
        RefreshTokenStrategy,
        ...createRefreshTokenAliasProviders(service),
      ],
    });
  }
}
