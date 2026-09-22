import { Inject, Module } from '@fluojs/core';
import { JwtModule, JwtService } from '@fluojs/jwt';

/**
 * Runnable application for apps/docs/content/docs/packages/jwt.mdx.
 *
 * It is the guide's canonical example: `JwtModule.forRoot` registers the JWT
 * providers, and `TokenService` consumes `JwtService` through explicit
 * `@Inject` constructor tokens.
 */

@Inject(JwtService)
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issueSession(userId: string): Promise<string> {
    return this.jwt.sign(
      { roles: ['member'], scopes: ['profile:read'] },
      { subject: userId, expiresIn: '15m' },
    );
  }

  authenticate(token: string) {
    return this.jwt.verify(token, { issuer: 'guide-api', audience: 'guide-app' });
  }
}

@Module({
  imports: [
    JwtModule.forRoot({
      algorithms: ['HS256'],
      secret: 'jwt-guide-secret',
      issuer: 'guide-api',
      audience: 'guide-app',
      accessTokenTtlSeconds: 3600,
    }),
  ],
  providers: [TokenService],
  exports: [TokenService],
})
export class AuthModule {}
