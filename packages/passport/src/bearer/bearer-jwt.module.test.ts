import { describe, expect, it } from 'vitest';

import { Module } from '@fluojs/core';
import type { GuardContext, Principal, RequestContext } from '@fluojs/http';
import { DefaultJwtSigner, JwtExpiredTokenError, JwtModule } from '@fluojs/jwt';
import { FluoFactory } from '@fluojs/runtime';

import { AuthenticationExpiredError } from '../errors.js';
import { PassportModule } from '../module.js';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
} from './bearer-jwt.js';

function createGuardContext(authorization: string): GuardContext {
  return {
    handler: {
      controllerToken: class {},
      methodName: 'test',
      metadata: {} as never,
      route: {} as never,
    },
    requestContext: {
      request: {
        headers: { authorization },
      } as unknown as RequestContext['request'],
      principal: undefined,
    } as RequestContext,
  };
}

@Module({
  imports: [
    JwtModule.forRoot({
      accessTokenTtlSeconds: 3600,
      algorithms: ['HS256'],
      audience: 'fluo-bearer-preset-clients',
      issuer: 'fluo-bearer-preset',
      secret: 'fluo-bearer-preset-secret',
    }),
    PassportModule.forRoot(
      { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
      [createBearerJwtStrategyRegistration()],
    ),
  ],
  providers: [BearerJwtStrategy],
})
class BearerWiringModule {}

describe('BearerJwtStrategy JwtModule wiring', () => {
  it('resolves the preset strategy with the real DefaultJwtVerifier through JwtModule', async () => {
    const app = await FluoFactory.createApplicationContext(BearerWiringModule);

    try {
      const strategy = await app.container.resolve(BearerJwtStrategy);
      const signer = await app.container.resolve(DefaultJwtSigner);

      expect(strategy).toBeInstanceOf(BearerJwtStrategy);

      const token = await signer.signAccessToken({
        roles: ['admin'],
        scope: 'profile:read admin:audit',
        sub: 'user-42',
      });

      const result = await strategy.authenticate(createGuardContext(`Bearer ${token}`));

      expect(result).toMatchObject({
        audience: 'fluo-bearer-preset-clients',
        issuer: 'fluo-bearer-preset',
        roles: ['admin'],
        scopes: ['profile:read', 'admin:audit'],
        subject: 'user-42',
      });
      expect((result as Principal).claims.sub).toBe('user-42');
    } finally {
      await app.close();
    }
  });

  it('maps a real expired token to AuthenticationExpiredError with the verifier cause', async () => {
    const app = await FluoFactory.createApplicationContext(BearerWiringModule);

    try {
      const strategy = await app.container.resolve(BearerJwtStrategy);
      const signer = await app.container.resolve(DefaultJwtSigner);
      const expiredToken = await signer.signAccessToken({
        exp: Math.floor(Date.now() / 1000) - 60,
        sub: 'user-42',
      });

      const failure = await strategy
        .authenticate(createGuardContext(`Bearer ${expiredToken}`))
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AuthenticationExpiredError);
      expect((failure as Error).cause).toBeInstanceOf(JwtExpiredTokenError);
    } finally {
      await app.close();
    }
  });
});
