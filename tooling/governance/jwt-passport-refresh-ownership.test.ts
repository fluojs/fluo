import { Module } from '../../packages/core/src/index.js';
import { JwtModule, RefreshTokenService } from '../../packages/jwt/src/index.js';
import {
  REFRESH_TOKEN_SERVICE,
  RefreshTokenModule,
  RefreshTokenStrategy,
} from '../../packages/passport/src/index.js';
import { FluoFactory } from '../../packages/runtime/src/index.js';
import { describe, expect, it } from 'vitest';

describe('JWT and Passport refresh ownership', () => {
  it('aliases the JWT-owned refresh service for a real Passport exchange', async () => {
    // Given
    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          refreshToken: {
            expiresInSeconds: 60,
            rotation: true,
            secret: 'governance-refresh-secret',
            store: 'memory',
          },
          secret: 'governance-access-secret',
        }),
        RefreshTokenModule.forRoot(),
      ],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const jwtRefreshTokens = await app.container.resolve(RefreshTokenService);
      const passportRefreshTokens = await app.container.resolve(REFRESH_TOKEN_SERVICE);
      const strategy = await app.container.resolve(RefreshTokenStrategy);
      const presentedToken = await jwtRefreshTokens.issueRefreshToken('user-1');

      // When
      const principal = await strategy.authenticate({
        handler: {} as never,
        requestContext: {
          request: {
            body: { refreshToken: presentedToken },
            headers: {},
          },
        } as never,
      });

      // Then
      expect(passportRefreshTokens).toBe(jwtRefreshTokens);
      expect(principal).toMatchObject({
        claims: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
        subject: 'user-1',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects the missing-refresh configuration mutation instead of recreating state', async () => {
    // Given
    @Module({
      imports: [
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'missing-refresh-secret',
        }),
        RefreshTokenModule.forRoot(),
      ],
    })
    class MissingRefreshModule {}

    // When / Then
    await expect(FluoFactory.createApplicationContext(MissingRefreshModule)).rejects.toThrow(
      'JWT refresh token options are not configured.',
    );
  });
});
