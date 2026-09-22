import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { JwtModule } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
  PassportModule,
  RequireScopes,
  UseAuth,
  UseOptionalAuth,
  type AuthStrategy,
  type AuthStrategyResult,
  AuthenticationFailedError,
  AuthenticationRequiredError,
} from '@fluojs/passport';

/**
 * Runnable application for apps/docs/content/docs/packages/passport.mdx.
 *
 * It composes the bearer JWT preset with a custom `AuthStrategy` (API keys)
 * and an optional-auth route, mirroring the guide's example module and
 * fragments.
 */

export class ApiKeyStore {
  private readonly owners = new Map<string, string>([['guide-service-key', 'service-1']]);

  findOwner(apiKey: string): string | undefined {
    return this.owners.get(apiKey);
  }
}

@Inject(ApiKeyStore)
export class ApiKeyStrategy implements AuthStrategy {
  constructor(private readonly keys: ApiKeyStore) {}

  async authenticate(context: Parameters<AuthStrategy['authenticate']>[0]): Promise<AuthStrategyResult> {
    const header = context.requestContext.request.headers['x-api-key'];
    const apiKey = Array.isArray(header) ? header[0] : header;

    if (!apiKey) {
      throw new AuthenticationRequiredError('x-api-key header is required.');
    }

    const owner = this.keys.findOwner(apiKey);
    if (!owner) {
      throw new AuthenticationFailedError('Unknown API key.');
    }

    return { subject: owner, claims: { roles: ['service'] } };
  }
}

@Controller('/profile')
export class ProfileController {
  @Get()
  @UseAuth(BEARER_JWT_STRATEGY_NAME)
  @RequireScopes('profile:read')
  getProfile(_input: unknown, ctx: RequestContext) {
    return { user: ctx.principal?.subject, scopes: ctx.principal?.scopes };
  }
}
@Controller('/session')
export class SessionController {
  // Optional-auth boundary: the bearer preset raises on missing credentials,
  // so anonymous callers still get 401 here. Strategies that report missing
  // credentials (the cookie preset with requireAccessToken: false) are the
  // ones that let @UseOptionalAuth serve guests.
  @Get()
  @UseOptionalAuth(BEARER_JWT_STRATEGY_NAME)
  getSession(_input: unknown, ctx: RequestContext) {
    return { subject: ctx.principal?.subject ?? null };
  }
}

@Controller('/service')
export class ServiceController {
  @Get()
  @UseAuth('api-key')
  callService(_input: unknown, ctx: RequestContext) {
    return { caller: ctx.principal?.subject };
  }
}

@Controller('/unregistered')
export class UnregisteredStrategyController {
  @Get()
  @UseAuth('not-registered')
  call() {
    return { ok: true };
  }
}

@Module({
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      audience: 'guide-app',
      issuer: 'guide-api',
      secret: 'passport-guide-secret',
    }),
    PassportModule.forRoot({ defaultStrategy: BEARER_JWT_STRATEGY_NAME }, [
      createBearerJwtStrategyRegistration(),
      { name: 'api-key', token: ApiKeyStrategy },
    ]),
  ],
  providers: [BearerJwtStrategy, ApiKeyStrategy, ApiKeyStore],
  controllers: [ProfileController, SessionController, ServiceController, UnregisteredStrategyController],
})
export class AuthModule {}
