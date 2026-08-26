import type { FrameworkResponse } from './types.js';

const NativeDate = Date;
const NativeEncodeURIComponent = encodeURIComponent;
const NativeNumberIsFinite = Number.isFinite;
const NativeNumberIsSafeInteger = Number.isSafeInteger;
const NativeString = String;
const NativeTypeError = TypeError;
const nativeArrayJoin = Function.prototype.call.bind(Array.prototype.join);
const nativeArrayPush = Function.prototype.call.bind(Array.prototype.push);
const nativeArraySome = Function.prototype.call.bind(Array.prototype.some);
const nativeDateGetTime = Function.prototype.call.bind(NativeDate.prototype.getTime);
const nativeDateGetUTCFullYear = Function.prototype.call.bind(NativeDate.prototype.getUTCFullYear);
const nativeDateToUTCString = Function.prototype.call.bind(NativeDate.prototype.toUTCString);
const nativeRegExpTest = Function.prototype.call.bind(RegExp.prototype.test);
const nativeStringSlice = Function.prototype.call.bind(String.prototype.slice);
const nativeStringSplit = Function.prototype.call.bind(String.prototype.split);
const nativeStringStartsWith = Function.prototype.call.bind(String.prototype.startsWith);
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
    throw new NativeTypeError('Cookie value must be a string.');
  }

  let encoded: string;

  try {
    encoded = NativeEncodeURIComponent(value);
  } catch (error) {
    throw new NativeTypeError('Cookie value must contain valid Unicode.', { cause: error });
  }

  if (!nativeRegExpTest(COOKIE_VALUE_PATTERN, encoded)) {
    throw new NativeTypeError('Cookie value could not be encoded as a valid Set-Cookie value.');
  }

  return encoded;
}

function validateCookieName(name: string): void {
  if (typeof name !== 'string' || !nativeRegExpTest(COOKIE_NAME_PATTERN, name)) {
    throw new NativeTypeError('Cookie name must contain only valid cookie-name characters.');
  }
}

function validateDomain(value: string): void {
  const hostname = typeof value === 'string' && nativeStringStartsWith(value, '.')
    ? nativeStringSlice(value, 1)
    : value;

  if (
    typeof hostname !== 'string' ||
    hostname.length === 0 ||
    hostname.length > 253 ||
    nativeArraySome(
      nativeStringSplit(hostname, '.'),
      (label: string) => !nativeRegExpTest(COOKIE_DOMAIN_LABEL_PATTERN, label),
    )
  ) {
    throw new NativeTypeError('Cookie domain must be a valid ASCII domain name.');
  }
}

function validatePath(value: string): void {
  if (typeof value !== 'string' || !nativeRegExpTest(COOKIE_PATH_VALUE_PATTERN, value)) {
    throw new NativeTypeError('Cookie path must contain only valid cookie attribute characters.');
  }
}

function snapshotExpiresTimestamp(expires: Date | undefined): number | undefined {
  if (expires === undefined) {
    return undefined;
  }

  let timestamp: number;

  try {
    timestamp = nativeDateGetTime(expires);
  } catch {
    throw new NativeTypeError('Cookie expires must be a valid Date.');
  }

  if (!NativeNumberIsFinite(timestamp)) {
    throw new NativeTypeError('Cookie expires must be a valid Date.');
  }

  return timestamp;
}

function serializeExpires(timestamp: number): string {
  const normalizedExpires = new NativeDate(timestamp);
  const year = nativeDateGetUTCFullYear(normalizedExpires);
  if (year < 1601 || year >= 10_000) {
    throw new NativeTypeError('Cookie expires must use an IMF-fixdate year from 1601 through 9999.');
  }

  return nativeDateToUTCString(normalizedExpires);
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
      throw new NativeTypeError('Cookie sameSite must be "lax", "none", or "strict".');
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  // Snapshot the mutable Date before any later caller-owned accessor can change it.
  const expiresTimestamp = snapshotExpiresTimestamp(options.expires);
  // Read remaining caller-owned properties once so validation and serialization use the same values.
  const {
    domain,
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
    if (!NativeNumberIsSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
      throw new NativeTypeError('Cookie maxAgeSeconds must be a non-negative safe integer.');
    }

    nativeArrayPush(parts, `Max-Age=${NativeString(maxAgeSeconds)}`);
  }

  if (expiresTimestamp !== undefined) {
    nativeArrayPush(parts, `Expires=${serializeExpires(expiresTimestamp)}`);
  }

  if (domain !== undefined) {
    validateDomain(domain);
    nativeArrayPush(parts, `Domain=${domain}`);
  }

  if (path !== undefined) {
    validatePath(path);
    nativeArrayPush(parts, `Path=${path}`);
  }

  if (httpOnly !== undefined && typeof httpOnly !== 'boolean') {
    throw new NativeTypeError('Cookie httpOnly must be a boolean.');
  }

  if (httpOnly === true) {
    nativeArrayPush(parts, 'HttpOnly');
  }

  if (secure !== undefined && typeof secure !== 'boolean') {
    throw new NativeTypeError('Cookie secure must be a boolean.');
  }

  if (secure === true) {
    nativeArrayPush(parts, 'Secure');
  }

  if (sameSite !== undefined) {
    if (sameSite === 'none' && secure !== true) {
      throw new NativeTypeError('Cookie sameSite "none" requires secure to be true.');
    }

    nativeArrayPush(parts, `SameSite=${serializeSameSite(sameSite)}`);
  }

  return nativeArrayJoin(parts, '; ');
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
