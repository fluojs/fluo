import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import { PassportModule } from '../module.js';
import { COOKIE_AUTH_STRATEGY_NAME, CookieAuthStrategy } from './cookie-auth.js';
import { CookieAuthModule } from './cookie-auth-module.js';

describe('CookieAuthModule application wiring', () => {
  it('resolves CookieAuthStrategy when a sibling JwtModule makes its verifier global', async () => {
    // Given
    @Module({
      imports: [
        CookieAuthModule.forRoot(),
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'cookie-auth-integration-secret',
        }),
        PassportModule.forRoot(
          { defaultStrategy: COOKIE_AUTH_STRATEGY_NAME },
          [{ name: COOKIE_AUTH_STRATEGY_NAME, token: CookieAuthStrategy }],
        ),
      ],
    })
    class AuthModule {}

    // When
    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const strategy = await app.container.resolve(CookieAuthStrategy);

      // Then
      expect(strategy).toBeInstanceOf(CookieAuthStrategy);
    } finally {
      await app.close();
    }
  });
});
