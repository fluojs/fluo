import { Test } from '@fluojs/testing';
import type { Constructor } from '@fluojs/core';
import { UnauthorizedException, type GuardContext } from '@fluojs/http';
import { JwtService } from '@fluojs/jwt';
import {
  AuthGuard,
  AuthenticationFailedError,
  AuthenticationRequiredError,
  COOKIE_AUTH_STRATEGY_NAME,
  CookieAuthStrategy,
  UseAuth,
} from '@fluojs/passport';
import { describe, expect, it } from 'vitest';

import { GuestSessionModule, SessionAppModule } from './cookie-guide-app';

/**
 * Composition fixture for apps/docs/content/docs/packages/passport.mdx
 * (cookie-auth preset section).
 *
 * HTTP level: login writes strict-default auth cookies, the cookie strategy
 * authenticates requests through the real pipeline, and the combined registry
 * serves bearer routes too. Guard/strategy level: synthetic contexts exercise
 * missing-vs-malformed cookie classification and the guest variant.
 */

type TestResponseHeaders = Record<string, string | string[]>;

function headerValue(headers: TestResponseHeaders, name: string): string | undefined {
  const value = headerValues(headers, name)[0];
  return value;
}

function headerValues(headers: TestResponseHeaders, name: string): string[] {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = match?.[1];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstCookieValue(setCookie: string, name: string): string | undefined {
  for (const cookie of setCookie.split(',')) {
    const pair = cookie.trim().split(';')[0];
    const separator = pair?.indexOf('=');

    if (!pair || separator === undefined || separator === -1) {
      continue;
    }

    if (pair.slice(0, separator) === name) {
      return pair.slice(separator + 1);
    }
  }

  return undefined;
}

function createGuardContext(
  controllerToken: Constructor,
  methodName: string,
  container: GuardContext['requestContext']['container'],
  cookies: Record<string, string | undefined>,
): GuardContext {
  return {
    handler: {
      controllerToken,
      methodName,
      metadata: {} as never,
      route: {} as never,
    },
    requestContext: {
      container,
      principal: undefined,
      request: {
        body: undefined,
        cookies,
        headers: {},
        method: 'GET',
        params: {},
        path: '/sessions/current',
        query: {},
        raw: {},
        url: '/sessions/current',
      },
    } as GuardContext['requestContext'],
  };
}

@UseAuth(COOKIE_AUTH_STRATEGY_NAME)
class CookieRoute {}

describe('package-guides passport cookie composition', () => {
  it('writes strict-default auth cookies on login and clears them on logout', async () => {
    const app = await Test.createApp({ rootModule: SessionAppModule });

    try {
      const login = await app.request('POST', '/sessions').send();

      expect(login.status).toBe(201);
      const setCookie = headerValue(login.headers, 'Set-Cookie') ?? '';
      expect(setCookie).toContain('session_access=');
      expect(setCookie).toContain('Path=/sessions');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).toContain('Max-Age=900');

      const logout = await app.request('POST', '/sessions/logout').send();
      expect(logout.status).toBe(201);
      const cleared = headerValues(logout.headers, 'Set-Cookie');
      expect(cleared.some((cookie) => cookie.startsWith('session_access=;'))).toBe(true);
      expect(cleared.some((cookie) => cookie.startsWith('session_refresh=;'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('authenticates a cookie-carried token through the real pipeline', async () => {
    const app = await Test.createApp({ rootModule: SessionAppModule });

    try {
      const login = await app.request('POST', '/sessions').send();
      const setCookie = headerValue(login.headers, 'Set-Cookie') ?? '';
      const token = firstCookieValue(setCookie, 'session_access');
      expect(token).toBeDefined();

      const anonymous = await app.request({ method: 'GET', path: '/sessions/current' }).send();
      expect(anonymous.status).toBe(200);
      expect(anonymous.body).toEqual({ subject: null });

      const authenticated = await app
        .request({ method: 'GET', path: '/sessions/current', cookies: { session_access: token } })
        .send();
      expect(authenticated.status).toBe(200);
      expect(authenticated.body).toEqual({ subject: 'session-user' });
    } finally {
      await app.close();
    }
  });

  it('rejects an expired cookie token with 401', async () => {
    const module = await Test.createTestingModule({ rootModule: SessionAppModule }).compile();

    let expiredToken: string;
    try {
      const jwt = await module.resolve(JwtService);
      expiredToken = await jwt.sign(
        { scopes: ['profile:read'], exp: Math.floor(Date.now() / 1000) - 10 },
        { subject: 'session-user' },
      );
    } finally {
      await module.container.dispose();
    }

    const app = await Test.createApp({ rootModule: SessionAppModule });

    try {
      const response = await app
        .request({ method: 'GET', path: '/sessions/current', cookies: { session_access: expiredToken } })
        .send();

      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('serves bearer routes from the combined registry', async () => {
    const app = await Test.createApp({ rootModule: SessionAppModule });
    const module = await Test.createTestingModule({ rootModule: SessionAppModule }).compile();

    try {
      const jwt = await module.resolve(JwtService);
      const token = await jwt.sign({ scopes: [] }, { subject: 'bearer-user' });

      const response = await app.request('GET', '/bearer/current').header('Authorization', `Bearer ${token}`).send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ subject: 'bearer-user' });
    } finally {
      await module.container.dispose();
      await app.close();
    }
  });

  it('classifies missing and malformed cookies at the guard boundary', async () => {
    const module = await Test.createTestingModule({ rootModule: SessionAppModule }).compile();

    try {
      const authGuard = await module.resolve(AuthGuard);

      // requireAccessToken: false makes the strategy report missing cookies as
      // { authenticated: false }; a mandatory @UseAuth route then fails with
      // the guard's "no principal" authentication failure.
      const missing = createGuardContext(CookieRoute, 'probe', module.container, {});
      const missingError = await authGuard.canActivate(missing).catch((error: unknown) => error);
      expect(missingError).toBeInstanceOf(UnauthorizedException);
      expect((missingError as UnauthorizedException).cause).toBeInstanceOf(AuthenticationFailedError);
      expect(missing.requestContext.principal).toBeUndefined();

      // A present-but-malformed cookie always fails authentication before
      // verification.
      const malformed = createGuardContext(CookieRoute, 'probe', module.container, { session_access: '' });
      const malformedError = await authGuard.canActivate(malformed).catch((error: unknown) => error);
      expect(malformedError).toBeInstanceOf(UnauthorizedException);
      expect((malformedError as UnauthorizedException).cause).toBeInstanceOf(AuthenticationRequiredError);
    } finally {
      await module.container.dispose();
    }
  });

  it('resolves a missing cookie to an unauthenticated result when requireAccessToken is false', async () => {
    const module = await Test.createTestingModule({ rootModule: GuestSessionModule }).compile();

    try {
      const strategy = await module.resolve(CookieAuthStrategy);
      const context = createGuardContext(CookieRoute, 'probe', module.container, {});

      await expect(strategy.authenticate(context)).resolves.toEqual({ authenticated: false });

      const malformed = createGuardContext(CookieRoute, 'probe', module.container, { guest_access: '' });
      await expect(strategy.authenticate(malformed)).rejects.toThrow(AuthenticationRequiredError);
    } finally {
      await module.container.dispose();
    }
  });
});
