import { Inject, Module } from '@fluojs/core';
import { Controller, Get, Post, type RequestContext } from '@fluojs/http';
import { JwtModule, JwtService } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  COOKIE_AUTH_STRATEGY_NAME,
  CookieAuthModule,
  CookieManager,
  createBearerJwtStrategyRegistration,
  UseAuth,
  UseOptionalAuth,
} from '@fluojs/passport';

/**
 * Runnable application for apps/docs/content/docs/packages/passport.mdx
 * (cookie-auth preset section).
 *
 * `CookieAuthModule` owns the single passport registry: the cookie strategy is
 * the default, and the bearer registration is passed as an additional
 * strategy. `JwtModule` is a sibling import and must be globally visible so
 * `DefaultJwtVerifier` resolves for the cookie strategy.
 */

@Inject(JwtService, CookieManager)
@Controller('/sessions')
export class SessionController {
  constructor(
    private readonly jwt: JwtService,
    private readonly cookies: CookieManager,
  ) {}

  @Post()
  async login(_input: unknown, ctx: RequestContext) {
    const accessToken = await this.jwt.sign(
      { scopes: ['profile:read'] },
      { subject: 'session-user' },
    );

    this.cookies.setAccessTokenCookie(ctx.response, accessToken, 900);
    return { subject: 'session-user' };
  }

  @Post('/logout')
  logout(_input: unknown, ctx: RequestContext) {
    this.cookies.clearAllCookies(ctx.response);
    return { ok: true };
  }

  @Get('/current')
  @UseOptionalAuth(COOKIE_AUTH_STRATEGY_NAME)
  current(_input: unknown, ctx: RequestContext) {
    return { subject: ctx.principal?.subject ?? null };
  }
}

@Controller('/bearer')
export class BearerSessionController {
  @Get('/current')
  @UseAuth(BEARER_JWT_STRATEGY_NAME)
  current(_input: unknown, ctx: RequestContext) {
    return { subject: ctx.principal?.subject };
  }
}

@Module({
  imports: [
    CookieAuthModule.forRoot(
      {
        accessTokenCookieName: 'session_access',
        refreshTokenCookieName: 'session_refresh',
        // Missing cookies resolve to an explicit unauthenticated result so the
        // optional-auth route can serve guests; present-but-malformed cookies
        // still fail authentication.
        requireAccessToken: false,
        cookieOptions: { path: '/sessions' },
      },
      { defaultStrategy: COOKIE_AUTH_STRATEGY_NAME },
      [createBearerJwtStrategyRegistration()],
    ),
    JwtModule.forRoot({
      algorithms: ['HS256'],
      global: true,
      secret: 'cookie-guide-secret',
    }),
  ],
  providers: [BearerJwtStrategy],
  controllers: [SessionController, BearerSessionController],
})
export class SessionAppModule {}

/**
 * Guest variant used by the strategy-level test: with
 * `requireAccessToken: false`, a *missing* cookie resolves to an explicit
 * unauthenticated result instead of an authentication failure.
 */
@Module({
  imports: [
    CookieAuthModule.forRoot({ requireAccessToken: false, accessTokenCookieName: 'guest_access' }),
    JwtModule.forRoot({
      algorithms: ['HS256'],
      global: true,
      secret: 'cookie-guide-secret',
    }),
  ],
})
export class GuestSessionModule {}