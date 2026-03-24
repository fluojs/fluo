import { describe, expect, it, vi } from 'vitest';

import type { GuardContext, RequestContext } from '@konekti/http';
import { DefaultJwtVerifier } from '@konekti/jwt';

import { CookieAuthStrategy, normalizeCookieAuthOptions } from './cookie-auth.js';
import { AuthenticationRequiredError } from './errors.js';

function createMockVerifier(overrides: Partial<DefaultJwtVerifier> = {}): DefaultJwtVerifier {
  return {
    verifyAccessToken: vi.fn().mockResolvedValue({
      claims: { sub: 'user-1', roles: ['admin'], scopes: ['read:profile'] },
      roles: ['admin'],
      scopes: ['read:profile'],
      subject: 'user-1',
    }),
    ...overrides,
  } as unknown as DefaultJwtVerifier;
}

function createGuardContext(cookies: Record<string, string | undefined> = {}): GuardContext {
  return {
    handler: {
      controllerToken: class {},
      methodName: 'test',
      metadata: {} as never,
      route: {} as never,
    },
    requestContext: {
      request: {
        cookies,
        headers: {},
      } as RequestContext['request'],
      principal: undefined,
      container: {
        resolve: vi.fn(),
        dispose: vi.fn(),
      } as unknown as RequestContext['container'],
    } as RequestContext,
  };
}

describe('CookieAuthStrategy', () => {
  describe('authenticate', () => {
    it('authenticates with valid access token cookie', async () => {
      const verifier = createMockVerifier();
      const strategy = new CookieAuthStrategy(verifier);
      const context = createGuardContext({ access_token: 'valid-jwt-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
        roles: ['admin'],
        scopes: ['read:profile'],
      });
      expect(verifier.verifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
    });

    it('uses custom cookie name when configured', async () => {
      const verifier = createMockVerifier();
      const strategy = new CookieAuthStrategy(verifier, {
        accessTokenCookieName: 'custom_token',
      });
      const context = createGuardContext({ custom_token: 'custom-jwt-token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-1',
      });
      expect(verifier.verifyAccessToken).toHaveBeenCalledWith('custom-jwt-token');
    });

    it('throws AuthenticationRequiredError when no access token cookie is present', async () => {
      const verifier = createMockVerifier();
      const strategy = new CookieAuthStrategy(verifier);
      const context = createGuardContext({});

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationRequiredError);
    });

    it('allows anonymous access when requireAccessToken is false', async () => {
      const verifier = createMockVerifier();
      const strategy = new CookieAuthStrategy(verifier, { requireAccessToken: false });
      const context = createGuardContext({});

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'anonymous',
        claims: {},
      });
    });

    it('throws AuthenticationRequiredError when token verification fails', async () => {
      const verifier = createMockVerifier({
        verifyAccessToken: vi.fn().mockRejectedValue(new Error('Token expired')),
      });
      const strategy = new CookieAuthStrategy(verifier);
      const context = createGuardContext({ access_token: 'expired-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationRequiredError);
    });

    it('handles non-Error verification failures gracefully', async () => {
      const verifier = createMockVerifier({
        verifyAccessToken: vi.fn().mockRejectedValue('string error'),
      });
      const strategy = new CookieAuthStrategy(verifier);
      const context = createGuardContext({ access_token: 'bad-token' });

      await expect(strategy.authenticate(context)).rejects.toThrow(AuthenticationRequiredError);
    });

    it('preserves principal claims, roles, and scopes', async () => {
      const verifier = createMockVerifier({
        verifyAccessToken: vi.fn().mockResolvedValue({
          claims: { sub: 'user-2', custom: 'data', roles: ['user'], scopes: ['write:data'] },
          roles: ['user'],
          scopes: ['write:data'],
          subject: 'user-2',
        }),
      });
      const strategy = new CookieAuthStrategy(verifier);
      const context = createGuardContext({ access_token: 'token' });

      const result = await strategy.authenticate(context);

      expect(result).toMatchObject({
        subject: 'user-2',
        roles: ['user'],
        scopes: ['write:data'],
        claims: { sub: 'user-2', custom: 'data', roles: ['user'], scopes: ['write:data'] },
      });
    });
  });

  describe('normalizeCookieAuthOptions', () => {
    it('returns defaults when no options provided', () => {
      const options = normalizeCookieAuthOptions();

      expect(options).toEqual({
        accessTokenCookieName: 'access_token',
        refreshTokenCookieName: 'refresh_token',
        requireAccessToken: true,
      });
    });

    it('merges custom options with defaults', () => {
      const options = normalizeCookieAuthOptions({
        accessTokenCookieName: 'custom_access',
      });

      expect(options).toEqual({
        accessTokenCookieName: 'custom_access',
        refreshTokenCookieName: 'refresh_token',
        requireAccessToken: true,
      });
    });

    it('allows overriding all options', () => {
      const options = normalizeCookieAuthOptions({
        accessTokenCookieName: 'my_access',
        refreshTokenCookieName: 'my_refresh',
        requireAccessToken: false,
      });

      expect(options).toEqual({
        accessTokenCookieName: 'my_access',
        refreshTokenCookieName: 'my_refresh',
        requireAccessToken: false,
      });
    });
  });
});

describe('CookieManager', () => {
  function createMockResponse() {
    return {
      committed: false,
      headers: {} as Record<string, string | string[]>,
      statusCode: undefined as number | undefined,
      statusSet: false,
      setHeader(name: string, value: string | string[]) {
        this.headers[name] = value;
      },
      setStatus(code: number) {
        this.statusCode = code;
        this.statusSet = true;
      },
      redirect(status: number, location: string) {
        this.setStatus(status);
        this.setHeader('Location', location);
        this.committed = true;
      },
      send(body: unknown) {
        this.committed = true;
      },
    };
  }

  it('creates cookie header with correct format', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager();
    const response = createMockResponse();

    manager.setAccessTokenCookie(response, 'test-token', 3600);

    expect(response.headers['Set-Cookie']).toBe(
      'access_token=test-token; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Strict'
    );
  });

  it('sets refresh token cookie', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager();
    const response = createMockResponse();

    manager.setRefreshTokenCookie(response, 'refresh-token', 604800);

    expect(response.headers['Set-Cookie']).toBe(
      'refresh_token=refresh-token; Max-Age=604800; Path=/; Secure; HttpOnly; SameSite=Strict'
    );
  });

  it('clears access token cookie', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager();
    const response = createMockResponse();

    manager.clearAccessTokenCookie(response);

    expect(response.headers['Set-Cookie']).toBe(
      'access_token=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict'
    );
  });

  it('sets both access and refresh tokens together', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager();
    const response = createMockResponse();

    manager.setAuthCookies(response, 'access-jwt', 3600, 'refresh-jwt', 604800);

    const cookies = response.headers['Set-Cookie'] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('access_token=access-jwt');
    expect(cookies[1]).toContain('refresh_token=refresh-jwt');
  });

  it('uses custom cookie names', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager({
      accessTokenCookieName: 'my_access',
      refreshTokenCookieName: 'my_refresh',
    });
    const response = createMockResponse();

    manager.setAuthCookies(response, 'access', 3600, 'refresh', 604800);

    const cookies = response.headers['Set-Cookie'] as string[];
    expect(cookies[0]).toContain('my_access=access');
    expect(cookies[1]).toContain('my_refresh=refresh');
  });

  it('uses custom cookie options', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager({
      cookieOptions: {
        secure: false,
        sameSite: 'lax',
        path: '/api',
        domain: 'example.com',
      },
    });
    const response = createMockResponse();

    manager.setAccessTokenCookie(response, 'token');

    expect(response.headers['Set-Cookie']).toBe(
      'access_token=token; Path=/api; Domain=example.com; HttpOnly; SameSite=Lax'
    );
  });

  it('clears all cookies at once', async () => {
    const { CookieManager } = await import('./cookie-manager.js');
    const manager = new CookieManager();
    const response = createMockResponse();

    manager.clearAllCookies(response);

    const cookies = response.headers['Set-Cookie'] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('access_token=; Max-Age=0');
    expect(cookies[1]).toContain('refresh_token=; Max-Age=0');
  });
});
