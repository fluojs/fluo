import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { PassportModule } from '../module.js';
import {
  REFRESH_TOKEN_SERVICE,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
  type RefreshTokenService,
  RefreshTokenStrategy,
} from './refresh-token.js';

class ApplicationRefreshTokenService implements RefreshTokenService {
  async issueRefreshToken(subject: string): Promise<string> {
    return `refresh:${subject}`;
  }

  async rotateRefreshToken(currentToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return {
      accessToken: `access:${currentToken}`,
      refreshToken: `rotated:${currentToken}`,
    };
  }

  async revokeRefreshToken(): Promise<void> {}

  async revokeAllForSubject(): Promise<void> {}
}

describe('RefreshTokenModule application wiring', () => {
  it('compiles the documented application graph with module-owned service provider ownership', async () => {
    // Given — the documented topology passes the service class to RefreshTokenModule without
    // re-registering it in the importing application module.
    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'refresh-integration-secret',
        }),
        RefreshTokenModule.forRoot(ApplicationRefreshTokenService),
        PassportModule.forRoot(
          { defaultStrategy: REFRESH_TOKEN_STRATEGY_NAME },
          [{ name: REFRESH_TOKEN_STRATEGY_NAME, token: RefreshTokenStrategy }],
        ),
      ],
    })
    class AuthModule {}

    // When
    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const strategy = await app.container.resolve(RefreshTokenStrategy);
      const service = await app.container.resolve(REFRESH_TOKEN_SERVICE);

      // Then
      expect(strategy).toBeInstanceOf(RefreshTokenStrategy);
      expect(service).toBeInstanceOf(ApplicationRefreshTokenService);
    } finally {
      await app.close();
    }
  });

  it('resolves an application-registered symbol service through the exported alias', async () => {
    // Given — non-class service tokens remain application-owned.
    const serviceToken = Symbol('fluo.passport.refresh-token-service');
    const service = new ApplicationRefreshTokenService();

    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'refresh-integration-secret',
        }),
        RefreshTokenModule.forRoot(serviceToken),
      ],
      providers: [{ provide: serviceToken, useValue: service }],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      // When
      const resolvedService = await app.container.resolve(REFRESH_TOKEN_SERVICE);

      // Then
      expect(resolvedService).toBe(service);
    } finally {
      await app.close();
    }
  });

});
