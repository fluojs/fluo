import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../guard.js';
import { COOKIE_AUTH_OPTIONS, CookieAuthStrategy } from './cookie-auth.js';
import { CookieAuthModule } from './cookie-auth-module.js';
import { CookieManager } from './cookie-manager.js';

describe('CookieAuthModule application wiring', () => {
  it('registers the cookie strategy, manager, and passport guard with shared cookie names', async () => {
    // Given
    const cookieConfig = {
      accessTokenCookieName: 'session_access',
      refreshTokenCookieName: 'session_refresh',
    };

    @Module({
      imports: [
        CookieAuthModule.forRoot(cookieConfig),
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'cookie-auth-integration-secret',
        }),
      ],
    })
    class AuthModule {}

    // When
    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const options = await app.container.resolve(COOKIE_AUTH_OPTIONS);
      const strategy = await app.container.resolve(CookieAuthStrategy);
      const manager = await app.container.resolve(CookieManager);
      const guard = await app.container.resolve(AuthGuard);
      const response = {
        committed: false,
        headers: {} as Record<string, string | string[]>,
        redirect(status: number, location: string) {
          this.setStatus(status);
          this.setHeader('Location', location);
          this.committed = true;
        },
        send(_body: unknown) {
          this.committed = true;
        },
        setHeader(name: string, value: string | string[]) {
          this.headers[name] = value;
        },
        setStatus(code: number) {
          this.statusCode = code;
          this.statusSet = true;
        },
        statusCode: undefined as number | undefined,
        statusSet: false,
      };
      manager.setAccessTokenCookie(response, 'access-token');

      // Then
      expect(options).toEqual(cookieConfig);
      expect(strategy).toBeInstanceOf(CookieAuthStrategy);
      expect(guard).toBeInstanceOf(AuthGuard);
      expect(response.headers['Set-Cookie']).toContain('session_access=access-token');
    } finally {
      await app.close();
    }
  });
});
