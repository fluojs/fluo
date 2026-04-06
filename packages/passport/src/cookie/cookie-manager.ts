import type { FrameworkResponse } from '@konekti/http';

import { DEFAULT_COOKIE_AUTH_OPTIONS, type CookieAuthOptions, normalizeCookieAuthOptions } from './cookie-auth.js';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
  domain?: string;
  maxAge?: number;
}

export interface SetCookieOptions extends CookieOptions {
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
}

export interface CookieManagerConfig extends CookieAuthOptions {
  cookieOptions?: CookieOptions;
}

type NormalizedCookieOptions = Omit<Required<CookieOptions>, 'domain' | 'maxAge'> &
  Pick<CookieOptions, 'domain' | 'maxAge'>;

export const DEFAULT_COOKIE_OPTIONS: NormalizedCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  domain: undefined,
  maxAge: undefined,
};

function buildCookieHeader(name: string, value: string, options: NormalizedCookieOptions): string {
  const parts: string[] = [`${name}=${value}`];

  if (options.maxAge !== undefined && options.maxAge >= 0) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`);
  }

  return parts.join('; ');
}

function buildClearCookieHeader(name: string, options: NormalizedCookieOptions): string {
  return buildCookieHeader(name, '', {
    ...options,
    maxAge: 0,
  });
}

export class CookieManager {
  private readonly options: Required<CookieAuthOptions>;
  private readonly cookieOptions: NormalizedCookieOptions;

  constructor(config?: CookieManagerConfig) {
    this.options = normalizeCookieAuthOptions(config);
    this.cookieOptions = {
      httpOnly: config?.cookieOptions?.httpOnly ?? DEFAULT_COOKIE_OPTIONS.httpOnly,
      secure: config?.cookieOptions?.secure ?? DEFAULT_COOKIE_OPTIONS.secure,
      sameSite: config?.cookieOptions?.sameSite ?? DEFAULT_COOKIE_OPTIONS.sameSite,
      path: config?.cookieOptions?.path ?? DEFAULT_COOKIE_OPTIONS.path,
      domain: config?.cookieOptions?.domain ?? DEFAULT_COOKIE_OPTIONS.domain,
      maxAge: config?.cookieOptions?.maxAge ?? DEFAULT_COOKIE_OPTIONS.maxAge,
    };
  }

  setAccessTokenCookie(response: FrameworkResponse, token: string, ttlSeconds?: number): void {
    const cookie = buildCookieHeader(
      this.options.accessTokenCookieName,
      token,
      {
        ...this.cookieOptions,
        maxAge: ttlSeconds ?? this.cookieOptions.maxAge,
      },
    );

    this.appendSetCookie(response, cookie);
  }

  setRefreshTokenCookie(response: FrameworkResponse, token: string, ttlSeconds?: number): void {
    const cookie = buildCookieHeader(
      this.options.refreshTokenCookieName,
      token,
      {
        ...this.cookieOptions,
        maxAge: ttlSeconds ?? this.cookieOptions.maxAge,
      },
    );

    this.appendSetCookie(response, cookie);
  }

  clearAccessTokenCookie(response: FrameworkResponse): void {
    const cookie = buildClearCookieHeader(
      this.options.accessTokenCookieName,
      this.cookieOptions,
    );

    this.appendSetCookie(response, cookie);
  }

  clearRefreshTokenCookie(response: FrameworkResponse): void {
    const cookie = buildClearCookieHeader(
      this.options.refreshTokenCookieName,
      this.cookieOptions,
    );

    this.appendSetCookie(response, cookie);
  }

  clearAllCookies(response: FrameworkResponse): void {
    this.clearAccessTokenCookie(response);
    this.clearRefreshTokenCookie(response);
  }

  setAuthCookies(
    response: FrameworkResponse,
    accessToken: string,
    accessTokenTtlSeconds?: number,
    refreshToken?: string,
    refreshTokenTtlSeconds?: number,
  ): void {
    this.setAccessTokenCookie(response, accessToken, accessTokenTtlSeconds);

    if (refreshToken) {
      this.setRefreshTokenCookie(response, refreshToken, refreshTokenTtlSeconds);
    }
  }

  private appendSetCookie(response: FrameworkResponse, cookie: string): void {
    const existingCookies = response.headers['Set-Cookie'];
    const cookies = Array.isArray(existingCookies)
      ? existingCookies
      : existingCookies
        ? [existingCookies]
        : [];

    cookies.push(cookie);
    response.setHeader('Set-Cookie', cookies.length === 1 ? cookies[0] : cookies);
  }
}

export function createCookieManager(config?: CookieManagerConfig): CookieManager {
  return new CookieManager(config);
}
