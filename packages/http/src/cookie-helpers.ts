import type { FrameworkResponse } from './types.js';

const COOKIE_DELETION_EXPIRES = new Date(0);
const COOKIE_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_DOMAIN = /^(?:\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** SameSite policies supported by the portable cookie serializer. */
export type CookieSameSite = 'lax' | 'none' | 'strict';

/** Runtime-neutral attributes used when serializing one response cookie. */
export interface CookieOptions {
  /** Domain that scopes the cookie. */
  readonly domain?: string;
  /** Absolute expiry time for the cookie. */
  readonly expires?: Date;
  /** Whether the cookie is inaccessible to client-side scripts. */
  readonly httpOnly?: boolean;
  /** Lifetime in whole seconds. */
  readonly maxAgeSeconds?: number;
  /** URL path that scopes the cookie. */
  readonly path?: string;
  /** Cross-site request policy for the cookie. */
  readonly sameSite?: CookieSameSite;
  /** Whether the cookie is sent only over secure connections. */
  readonly secure?: boolean;
}

/**
 * Attributes accepted when clearing a cookie.
 *
 * Only `path` and `domain` identify the browser cookie to delete. `httpOnly`,
 * `secure`, and `sameSite` are deletion attributes, not cookie identity keys.
 */
export type ClearCookieOptions = Omit<CookieOptions, 'expires' | 'maxAgeSeconds'>;

type CookieOptionValues = {
  readonly domain: string | undefined;
  readonly expires: Date | undefined;
  readonly httpOnly: boolean | undefined;
  readonly maxAgeSeconds: number | undefined;
  readonly path: string | undefined;
  readonly sameSite: CookieSameSite | undefined;
  readonly secure: boolean | undefined;
};

function readCookieOptions(options: CookieOptions): CookieOptionValues {
  const {
    domain,
    expires,
    httpOnly,
    maxAgeSeconds,
    path,
    sameSite,
    secure,
  } = options;

  return {
    domain,
    expires,
    httpOnly,
    maxAgeSeconds,
    path,
    sameSite,
    secure,
  };
}

function validateCookieName(name: string): void {
  if (typeof name !== 'string' || !COOKIE_NAME_TOKEN.test(name)) {
    throw new TypeError('Cookie names must be non-empty HTTP tokens.');
  }
}

function validateOptionalBoolean(value: boolean | undefined, optionName: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`${optionName} must be a boolean when provided.`);
  }
}

function validateDomain(domain: string): void {
  const host = domain.startsWith('.') ? domain.slice(1) : domain;

  if (
    typeof domain !== 'string'
    || host.length === 0
    || host.length > 253
    || !COOKIE_DOMAIN.test(domain)
  ) {
    throw new TypeError('Cookie domains must be valid ASCII DNS names.');
  }
}

function validatePath(path: string): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('Cookie paths must be non-empty RFC 6265 path values.');
  }

  for (const character of path) {
    const codePoint = character.charCodeAt(0);

    if (codePoint < 0x20 || codePoint === 0x3b || codePoint > 0x7e) {
      throw new TypeError('Cookie paths must be RFC 6265 path values.');
    }
  }
}

function formatExpiry(expires: Date): string {
  const timestamp = Date.prototype.getTime.call(expires);

  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cookie expiry must be a valid Date.');
  }

  const normalized = new Date(timestamp);
  const year = normalized.getUTCFullYear();

  if (year < 1601 || year > 9999) {
    throw new TypeError('Cookie expiry must have a four-digit RFC 6265 year.');
  }

  return normalized.toUTCString();
}

function normalizeSameSite(sameSite: CookieSameSite | undefined, secure: boolean | undefined): string | undefined {
  if (sameSite === undefined) {
    return undefined;
  }

  switch (sameSite) {
    case 'lax':
      return 'Lax';
    case 'strict':
      return 'Strict';
    case 'none':
      if (secure !== true) {
        throw new TypeError('SameSite=None cookies require secure: true.');
      }

      return 'None';
    default:
      throw new TypeError('sameSite must be lax, none, or strict.');
  }
}

function serializeCookie(name: string, value: string, options: CookieOptionValues): string {
  validateCookieName(name);

  if (typeof value !== 'string') {
    throw new TypeError('Cookie values must be strings.');
  }

  validateOptionalBoolean(options.httpOnly, 'httpOnly');
  validateOptionalBoolean(options.secure, 'secure');

  if (options.maxAgeSeconds !== undefined) {
    if (
      typeof options.maxAgeSeconds !== 'number'
      || !Number.isSafeInteger(options.maxAgeSeconds)
      || options.maxAgeSeconds < 0
    ) {
      throw new TypeError('maxAgeSeconds must be a non-negative safe integer.');
    }
  }

  if (options.domain !== undefined) {
    validateDomain(options.domain);
  }

  if (options.path !== undefined) {
    validatePath(options.path);
  }

  const sameSite = normalizeSameSite(options.sameSite, options.secure);
  const encodedValue = encodeURIComponent(value);
  const parts = [`${name}=${encodedValue}`];

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }

  if (options.expires !== undefined) {
    parts.push(`Expires=${formatExpiry(options.expires)}`);
  }

  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`);
  }

  if (options.domain !== undefined) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.secure === true) {
    parts.push('Secure');
  }

  if (options.httpOnly === true) {
    parts.push('HttpOnly');
  }

  if (sameSite !== undefined) {
    parts.push(`SameSite=${sameSite}`);
  }

  return parts.join('; ');
}

/**
 * Serialize one runtime-neutral response cookie as an independent `Set-Cookie` field.
 *
 * @param response Mutable response that receives the cookie header.
 * @param name Cookie name, validated as an HTTP token.
 * @param value Cookie value, percent-encoded before serialization.
 * @param options Explicit cookie attributes shared by all supported adapters.
 * @returns Nothing. The response receives one independent cookie field.
 */
export function setCookie(
  response: FrameworkResponse,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  response.setHeader('Set-Cookie', serializeCookie(name, value, readCookieOptions(options)));
}

/**
 * Expire one runtime-neutral response cookie while retaining its matching scope attributes.
 *
 * @param response Mutable response that receives the deletion cookie header.
 * @param name Cookie name, validated as an HTTP token.
 * @param options Original Path and Domain attributes required to target the same cookie.
 * @returns Nothing. The response receives one independent deletion cookie field.
 */
export function clearCookie(
  response: FrameworkResponse,
  name: string,
  options: ClearCookieOptions = {},
): void {
  const values = readCookieOptions(options);
  response.setHeader(
    'Set-Cookie',
    serializeCookie(name, '', {
      ...values,
      expires: COOKIE_DELETION_EXPIRES,
      maxAgeSeconds: 0,
    }),
  );
}
