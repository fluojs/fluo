import { Module, type Constructor } from '@fluojs/core';
import type { GuardContext, RequestContext } from '@fluojs/http';
import { DefaultJwtSigner, JwtModule } from '@fluojs/jwt';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
} from '../bearer/bearer-jwt.js';
import { UseAuth } from '../decorators.js';
import { AuthGuard } from '../guard.js';
import { COOKIE_AUTH_OPTIONS, CookieAuthStrategy } from './cookie-auth.js';
import { CookieAuthModule } from './cookie-auth-module.js';
import { CookieManager } from './cookie-manager.js';

function createGuardContext(
  controllerToken: Constructor,
  request: RequestContext['request'],
  container: RequestContext['container'],
): GuardContext {
  return {
    handler: {
      controllerToken,
      methodName: 'test',
      metadata: {} as never,
      route: {} as never,
    },
    requestContext: {
      container,
      principal: undefined,
      request,
    } as RequestContext,
  };
}

function createRequest(
  overrides: Pick<RequestContext['request'], 'cookies' | 'headers'>,
): RequestContext['request'] {
  return {
    body: undefined,
    cookies: overrides.cookies,
    headers: overrides.headers,
    method: 'GET',
    params: {},
    path: '/',
    query: {},
    raw: {},
    url: '/',
  };
}

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

  it('composes cookie and bearer registrations into one strict registry and authenticates writer output', async () => {
    // Given
    const cookieConfig = {
      accessTokenCookieName: 'session_access',
      refreshTokenCookieName: 'session_refresh',
    };

    @UseAuth('cookie')
    class CookieRoute {}

    @UseAuth(BEARER_JWT_STRATEGY_NAME)
    class BearerRoute {}

    @Module({
      imports: [
        CookieAuthModule.forRoot(
          cookieConfig,
          { defaultStrategy: 'cookie' },
          [createBearerJwtStrategyRegistration()],
        ),
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'cookie-auth-integration-secret',
        }),
      ],
      providers: [BearerJwtStrategy],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule, {
      duplicateProviderPolicy: 'throw',
    });

    try {
      const manager = await app.container.resolve(CookieManager);
      const signer = await app.container.resolve(DefaultJwtSigner);
      const guard = await app.container.resolve(AuthGuard);
      const token = await signer.signAccessToken({ sub: 'cookie-user' });
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
      manager.setAccessTokenCookie(response, token);
      const setCookie = response.headers['Set-Cookie'];

      if (typeof setCookie !== 'string') {
        throw new Error('Expected CookieManager to write one serialized cookie.');
      }

      const [cookiePair] = setCookie.split(';', 1);

      if (!cookiePair) {
        throw new Error('Expected the serialized cookie to contain a name/value pair.');
      }

      const [, serializedToken] = cookiePair.split('=', 2);

      if (!serializedToken) {
        throw new Error('Expected the serialized cookie to contain an access token.');
      }

      const cookieContext = createGuardContext(
        CookieRoute,
        createRequest({
          cookies: { session_access: serializedToken },
          headers: {},
        }),
        app.container,
      );
      const bearerContext = createGuardContext(
        BearerRoute,
        createRequest({
          cookies: {},
          headers: { authorization: `Bearer ${token}` },
        }),
        app.container,
      );

      // When
      await guard.canActivate(cookieContext);
      await guard.canActivate(bearerContext);

      // Then
      expect(cookieContext.requestContext.principal?.subject).toBe('cookie-user');
      expect(bearerContext.requestContext.principal?.subject).toBe('cookie-user');
    } finally {
      await app.close();
    }
  });

  it('keeps the cookie strategy as the registry and guard fallback when defaultStrategy is explicitly undefined', async () => {
    // Given
    const cookieConfig = {
      accessTokenCookieName: 'session_access',
      refreshTokenCookieName: 'session_refresh',
    };

    class DefaultCookieRoute {}

    @Module({
      imports: [
        CookieAuthModule.forRoot(cookieConfig, { defaultStrategy: undefined }),
        JwtModule.forRoot({
          algorithms: ['HS256'],
          global: true,
          secret: 'cookie-auth-explicit-undefined-secret',
        }),
      ],
    })
    class AuthModule {}

    const app = await FluoFactory.createApplicationContext(AuthModule);

    try {
      const signer = await app.container.resolve(DefaultJwtSigner);
      const guard = await app.container.resolve(AuthGuard);
      const token = await signer.signAccessToken({ sub: 'cookie-default-user' });
      const context = createGuardContext(
        DefaultCookieRoute,
        createRequest({
          cookies: { session_access: token },
          headers: {},
        }),
        app.container,
      );

      // When
      await guard.canActivate(context);

      // Then
      expect(context.requestContext.principal?.subject).toBe('cookie-default-user');
    } finally {
      await app.close();
    }
  });
});
