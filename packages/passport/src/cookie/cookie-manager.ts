import { type FrameworkResponse, setCookie } from '@fluojs/http';

import { type CookieAuthOptions, normalizeCookieAuthOptions } from './cookie-auth.js';

/**
 * Describes the cookie options contract.
 */
export interface CookieOptions {
  /**
   * Default cookie lifetime in seconds.
   *
   * @remarks
   * This value is forwarded to the portable HTTP serializer as `maxAgeSeconds`;
   * it is not the millisecond `maxAge` convention used by some host frameworks.
   */
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
  domain?: string;
  maxAge?: number;
}

/**
 * Describes the set cookie options contract accepted by {@link CookieManagerConfig}.
 *
 * @remarks
 * `accessTokenTtlSeconds` and `refreshTokenTtlSeconds` become the default `Max-Age`
 * for the matching token cookie when the positional TTL argument of
 * `CookieManager.setAccessTokenCookie(...)` / `setRefreshTokenCookie(...)` is omitted.
 * An explicit positional TTL always wins, followed by the matching configured TTL
 * and then `maxAge`, which is expressed in seconds and forwarded as HTTP `maxAgeSeconds`.
 */
export interface SetCookieOptions extends CookieOptions {
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
}

/**
 * Describes the cookie manager config contract.
 */
export interface CookieManagerConfig extends CookieAuthOptions {
  /**
   * Response-cookie defaults, including optional per-token TTL defaults.
   */
  cookieOptions?: SetCookieOptions;
}

type NormalizedCookieOptions = Omit<Required<CookieOptions>, 'domain' | 'maxAge'> &
  Pick<CookieOptions, 'domain' | 'maxAge'>;

type CookieWrite = {
  readonly maxAgeSeconds: number | undefined;
  readonly name: string;
  readonly value: string;
};

/**
 * Provides the default cookie options value.
 */
export const DEFAULT_COOKIE_OPTIONS: NormalizedCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  domain: undefined,
  maxAge: undefined,
};

function getHeaderCaseInsensitive(
  headers: FrameworkResponse['headers'],
  name: string,
): { key: string; value: string | string[] } | undefined {
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === name.toLowerCase() && (typeof value === 'string' || Array.isArray(value))) {
      return { key: headerName, value };
    }
  }

  return undefined;
}

function toHeaderValues(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return [...value];
  }

  return value ? [value] : [];
}

/**
 * Represents the cookie manager.
 */
export class CookieManager {
  private readonly options: Required<CookieAuthOptions>;
  private readonly cookieOptions: NormalizedCookieOptions;
  private readonly accessTokenTtlSeconds: number | undefined;
  private readonly refreshTokenTtlSeconds: number | undefined;

  /**
   * Creates a cookie manager with shared cookie-auth and response-cookie configuration.
   *
   * @param config Optional cookie names and response-cookie defaults.
   * @returns A cookie manager that preserves its class token and instance identity.
   */
  static create(config?: CookieManagerConfig): CookieManager {
    return new CookieManager(config);
  }

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
    this.accessTokenTtlSeconds = config?.cookieOptions?.accessTokenTtlSeconds;
    this.refreshTokenTtlSeconds = config?.cookieOptions?.refreshTokenTtlSeconds;
  }

  setAccessTokenCookie(response: FrameworkResponse, token: string, ttlSeconds?: number): void {
    this.writeCookie(response, {
      maxAgeSeconds: ttlSeconds ?? this.accessTokenTtlSeconds ?? this.cookieOptions.maxAge,
      name: this.options.accessTokenCookieName,
      value: token,
    });
  }

  setRefreshTokenCookie(response: FrameworkResponse, token: string, ttlSeconds?: number): void {
    this.writeCookie(response, {
      maxAgeSeconds: ttlSeconds ?? this.refreshTokenTtlSeconds ?? this.cookieOptions.maxAge,
      name: this.options.refreshTokenCookieName,
      value: token,
    });
  }

  clearAccessTokenCookie(response: FrameworkResponse): void {
    this.writeCookie(response, {
      maxAgeSeconds: 0,
      name: this.options.accessTokenCookieName,
      value: '',
    });
  }

  clearRefreshTokenCookie(response: FrameworkResponse): void {
    this.writeCookie(response, {
      maxAgeSeconds: 0,
      name: this.options.refreshTokenCookieName,
      value: '',
    });
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

  private writeCookie(response: FrameworkResponse, cookie: CookieWrite): void {
    const existingHeader = getHeaderCaseInsensitive(response.headers, 'Set-Cookie');
    const existingValues = toHeaderValues(existingHeader?.value);

    setCookie(response, cookie.name, cookie.value, {
      domain: this.cookieOptions.domain,
      httpOnly: this.cookieOptions.httpOnly,
      maxAgeSeconds: cookie.maxAgeSeconds,
      path: this.cookieOptions.path,
      sameSite: this.cookieOptions.sameSite,
      secure: this.cookieOptions.secure,
    });

    const updatedHeader = getHeaderCaseInsensitive(response.headers, 'Set-Cookie');
    const writtenValues = toHeaderValues(response.headers['Set-Cookie'] ?? updatedHeader?.value);
    const appendedExistingValues = writtenValues.length > existingValues.length
      && existingValues.every((value, index) => writtenValues[index] === value);
    const cookies = appendedExistingValues
      ? writtenValues
      : [...existingValues, ...writtenValues];

    if (updatedHeader?.key && updatedHeader.key !== 'Set-Cookie') {
      delete response.headers[updatedHeader.key];
    }

    response.headers['Set-Cookie'] = cookies.length === 1 ? cookies[0] : cookies;
  }
}
