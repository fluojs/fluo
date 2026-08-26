import type { FrameworkResponse } from './types.js';

const NativeDate = Date;
const nativeDateGetTime = NativeDate.prototype.getTime;
const nativeDateGetUTCFullYear = NativeDate.prototype.getUTCFullYear;
const nativeDateToUTCString = NativeDate.prototype.toUTCString;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[\u0021-\u003A\u003C-\u007E]*$/;
const COOKIE_DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const COOKIE_PATH_VALUE_PATTERN = /^[\u0020-\u003A\u003C-\u007E]*$/;
const COOKIE_DELETION_EXPIRES = new NativeDate(0);

/** SameSite policies supported by the portable cookie serializer. */
export type CookieSameSite = 'lax' | 'none' | 'strict';

/** Runtime-neutral attributes accepted when writing one response cookie. */
export interface CookieOptions {
  /** ASCII DNS domain scope sent through the `Domain` attribute. */
  readonly domain?: string;
  /** Absolute expiry instant in the IMF-fixdate 1601-9999 year range. */
  readonly expires?: Date;
  /** Prevents client-side script access when enabled. */
  readonly httpOnly?: boolean;
  /** Non-negative safe integer lifetime in decimal seconds without unit conversion. */
  readonly maxAgeSeconds?: number;
  /** Request path scope sent through the `Path` attribute. */
  readonly path?: string;
  /** Same-site request policy; `none` requires `secure: true`. */
  readonly sameSite?: CookieSameSite;
  /** Restricts transmission to secure channels when enabled. */
  readonly secure?: boolean;
}

/** Cookie attributes that must match the original cookie during deletion. */
export type ClearCookieOptions = Omit<CookieOptions, 'expires' | 'maxAgeSeconds'>;

function encodeCookieValue(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('Cookie value must be a string.');
  }

  let encoded: string;

  try {
    encoded = encodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      throw new TypeError('Cookie value must contain valid Unicode.', { cause: error });
    }

    throw error;
  }

  if (!COOKIE_VALUE_PATTERN.test(encoded)) {
    throw new TypeError('Cookie value could not be encoded as a valid Set-Cookie value.');
  }

  return encoded;
}

function validateCookieName(name: string): void {
  if (typeof name !== 'string' || !COOKIE_NAME_PATTERN.test(name)) {
    throw new TypeError('Cookie name must contain only valid cookie-name characters.');
  }
}

function validateDomain(value: string): void {
  const hostname = typeof value === 'string' && value.startsWith('.') ? value.slice(1) : value;

  if (
    typeof hostname !== 'string' ||
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.split('.').some((label) => !COOKIE_DOMAIN_LABEL_PATTERN.test(label))
  ) {
    throw new TypeError('Cookie domain must be a valid ASCII domain name.');
  }
}

function validatePath(value: string): void {
  if (typeof value !== 'string' || !COOKIE_PATH_VALUE_PATTERN.test(value)) {
    throw new TypeError('Cookie path must contain only valid cookie attribute characters.');
  }
}

function serializeExpires(expires: Date): string {
  let timestamp: number;

  try {
    timestamp = nativeDateGetTime.call(expires);
  } catch {
    throw new TypeError('Cookie expires must be a valid Date.');
  }

  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cookie expires must be a valid Date.');
  }

  const normalizedExpires = new NativeDate(timestamp);
  const year = nativeDateGetUTCFullYear.call(normalizedExpires);
  if (year < 1601 || year >= 10_000) {
    throw new TypeError('Cookie expires must use an IMF-fixdate year from 1601 through 9999.');
  }

  return nativeDateToUTCString.call(normalizedExpires);
}

function serializeSameSite(sameSite: CookieSameSite): string {
  switch (sameSite) {
    case 'lax':
      return 'Lax';
    case 'none':
      return 'None';
    case 'strict':
      return 'Strict';
    default:
      throw new TypeError('Cookie sameSite must be "lax", "none", or "strict".');
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  // Read caller-owned properties once so validation and serialization use the same values.
  const {
    domain,
    expires,
    httpOnly,
    maxAgeSeconds,
    path,
    sameSite,
    secure,
  } = options;

  validateCookieName(name);
  const encodedValue = encodeCookieValue(value);
  const parts = [`${name}=${encodedValue}`];

  if (maxAgeSeconds !== undefined) {
    if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
      throw new TypeError('Cookie maxAgeSeconds must be a non-negative safe integer.');
    }

    parts.push(`Max-Age=${String(maxAgeSeconds)}`);
  }

  if (expires !== undefined) {
    parts.push(`Expires=${serializeExpires(expires)}`);
  }

  if (domain !== undefined) {
    validateDomain(domain);
    parts.push(`Domain=${domain}`);
  }

  if (path !== undefined) {
    validatePath(path);
    parts.push(`Path=${path}`);
  }

  if (httpOnly !== undefined && typeof httpOnly !== 'boolean') {
    throw new TypeError('Cookie httpOnly must be a boolean.');
  }

  if (httpOnly === true) {
    parts.push('HttpOnly');
  }

  if (secure !== undefined && typeof secure !== 'boolean') {
    throw new TypeError('Cookie secure must be a boolean.');
  }

  if (secure === true) {
    parts.push('Secure');
  }

  if (sameSite !== undefined) {
    if (sameSite === 'none' && secure !== true) {
      throw new TypeError('Cookie sameSite "none" requires secure to be true.');
    }

    parts.push(`SameSite=${serializeSameSite(sameSite)}`);
  }

  return parts.join('; ');
}

/**
 * Appends one encoded cookie to a runtime-neutral framework response.
 *
 * @param response Mutable response facade that retains repeated `Set-Cookie` fields.
 * @param name Cookie name to validate and serialize.
 * @param value String value encoded with `encodeURIComponent`.
 * @param options Optional portable cookie attributes.
 * @returns Nothing. The response receives one independent `Set-Cookie` field.
 */
export function setCookie(
  response: FrameworkResponse,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  const serialized = serializeCookie(name, value, options);
  response.setHeader('Set-Cookie', serialized);
}

/**
 * Appends a deletion cookie with `Max-Age=0` and a past `Expires` instant.
 *
 * @param response Mutable response facade that retains repeated `Set-Cookie` fields.
 * @param name Cookie name to clear.
 * @param options Original cookie attributes required for matching, especially `Domain` and `Path`.
 * @returns Nothing. The response receives one independent deletion field.
 */
export function clearCookie(
  response: FrameworkResponse,
  name: string,
  options: ClearCookieOptions = {},
): void {
  // Read only supported caller-owned properties once; spreading would skip inherited accessors.
  const {
    domain,
    httpOnly,
    path,
    sameSite,
    secure,
  } = options;
  const serialized = serializeCookie(name, '', {
    domain,
    expires: COOKIE_DELETION_EXPIRES,
    httpOnly,
    maxAgeSeconds: 0,
    path,
    sameSite,
    secure,
  });
  response.setHeader('Set-Cookie', serialized);
}
