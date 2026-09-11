import { Inject, InvariantError, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { GuardContext, RequestContext } from '@fluojs/http';
import {
  DefaultJwtVerifier,
  JwtExpiredTokenError,
  JwtInvalidTokenError,
  RefreshTokenService as JwtRefreshTokenService,
} from '@fluojs/jwt';
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
export interface RefreshTokenServicePort {
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
    private readonly refreshTokenService: RefreshTokenServicePort,
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
  service: Token<RefreshTokenServicePort> | undefined,
): Provider[] {
  if (service === undefined || service === JwtRefreshTokenService) {
    return [{
      provide: REFRESH_TOKEN_SERVICE,
      useExisting: JwtRefreshTokenService,
    }];
  }

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
   * Registers `RefreshTokenStrategy` against the refresh service owned by `JwtModule`.
   *
   * @param service Optional application-owned refresh service port. Its rotated
   *   access tokens must be accepted by the `DefaultJwtVerifier` configured through
   *   `JwtModule`. Class tokens are registered inside this module. Omit this
   *   argument for the canonical JWT-owned registration path.
   * @param options Optional module imports that export a custom service token or dependencies.
   * @returns A module definition that exports `RefreshTokenStrategy` and `REFRESH_TOKEN_SERVICE`.
   * @remarks
   * The canonical path is `JwtModule.forRoot({ global: true, refreshToken })`
   * followed by `RefreshTokenModule.forRoot()`. Passport aliases the exported JWT
   * service instead of creating another store, refresh service, or crypto configuration.
   * A custom port remains available for application-owned refresh state, but
   * `JwtModule` remains required to provide the access-token verifier that
   * establishes the returned principal subject.
   *
   * @example
   * ```ts
   * import { JwtModule } from '@fluojs/jwt';
   * import {
   *   PassportModule,
   *   RefreshTokenModule,
   *   RefreshTokenStrategy,
   *   REFRESH_TOKEN_STRATEGY_NAME,
   * } from '@fluojs/passport';
   *
   * @Module({
   *   imports: [
   *     JwtModule.forRoot({
   *       global: true,
   *       refreshToken: { expiresInSeconds: 60, rotation: true, secret, store },
   *       secret,
   *     }),
   *     RefreshTokenModule.forRoot(),
   *     PassportModule.forRoot(
   *       { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
   *       [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
   *     ),
   *   ],
   * })
   * export class AuthModule {}
   * ```
   */
  static forRoot(): RefreshTokenModuleType;
  static forRoot(
    service: Token<RefreshTokenServicePort>,
    options?: RefreshTokenModuleImportOptions,
  ): RefreshTokenModuleType;
  static forRoot(
    service?: Token<RefreshTokenServicePort>,
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
