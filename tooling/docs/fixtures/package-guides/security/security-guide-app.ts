import { Inject, Module } from '@fluojs/core';
import {
  Controller,
  Get,
  Post,
  UseGuards,
  type MiddlewareContext,
  type RequestContext,
} from '@fluojs/http';
import { JwtModule, JwtService, RefreshTokenService } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
  PassportModule,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
  RefreshTokenStrategy,
  RequireScopes,
  UseAuth,
} from '@fluojs/passport';
import {
  SkipThrottle,
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
} from '@fluojs/throttler';

/**
 * Runnable application composing all three security packages for
 * apps/docs/content/docs/packages/{jwt,passport,throttler}.mdx:
 *
 * - `@fluojs/jwt` owns token crypto and the refresh store configuration
 *   (`global: true` so sibling modules see `RefreshTokenService`).
 * - `@fluojs/passport` aliases the JWT-owned refresh service and registers the
 *   bearer and refresh-token strategies under stable names.
 * - `@fluojs/throttler` bounds credential endpoints with an API-key generator.
 */

export function apiKeyKeyGenerator(context: MiddlewareContext): string {
  const header = context.request.headers['x-api-key'];
  const apiKey = Array.isArray(header) ? header[0] : header;

  if (!apiKey) {
    throw new Error('Missing API key for throttler tracking.');
  }

  return `api-key:${apiKey}`;
}

@Inject(JwtService, RefreshTokenService)
@Controller('/auth')
@UseGuards(ThrottlerGuard)
export class TokenController {
  constructor(
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @Post('/login')
  @Throttle({ ttl: 60, limit: 3 })
  async login(_input: unknown, ctx: RequestContext) {
    void ctx;
    const subject = 'session-user';
    const accessToken = await this.jwt.sign({ scopes: ['profile:read'] }, { subject, expiresIn: 900 });
    const refreshToken = await this.refreshTokens.issueRefreshToken(subject);

    return { accessToken, refreshToken, subject };
  }

  @Post('/refresh')
  @UseAuth(REFRESH_TOKEN_STRATEGY_NAME)
  @Throttle({ ttl: 60, limit: 10 })
  refresh(_input: unknown, ctx: RequestContext) {
    const claims = (ctx.principal?.claims ?? {}) as { accessToken?: string; refreshToken?: string };

    return { accessToken: claims.accessToken, refreshToken: claims.refreshToken, subject: ctx.principal?.subject };
  }
}

@Controller('/profile')
export class ProfileController {
  @Get()
  @UseAuth(BEARER_JWT_STRATEGY_NAME)
  @RequireScopes('profile:read')
  profile(_input: unknown, ctx: RequestContext) {
    return { user: ctx.principal?.subject };
  }
}

@Controller('/meta')
export class MetaController {
  @Get('/providers')
  @SkipThrottle()
  providers() {
    return { providers: ['password'] };
  }
}

@Module({
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      global: true,
      issuer: 'security-guide',
      audience: 'security-guide-app',
      secret: 'security-guide-access-secret',
      accessTokenTtlSeconds: 900,
      refreshToken: {
        secret: 'security-guide-refresh-secret',
        expiresInSeconds: 300,
        rotation: true,
        store: 'memory',
      },
    }),
    RefreshTokenModule.forRoot(),
    PassportModule.forRoot(
      { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
      [createBearerJwtStrategyRegistration(), { name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
    ),
    ThrottlerModule.forRoot({ ttl: 60, limit: 100, keyGenerator: apiKeyKeyGenerator }),
  ],
  providers: [BearerJwtStrategy],
  controllers: [TokenController, ProfileController, MetaController],
})
export class SecurityAppModule {}
