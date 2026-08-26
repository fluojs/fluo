import type { FrameworkResponse } from './types.js';

const NativeDate = Date;
const NativeEncodeURIComponent = encodeURIComponent;
const NativeNumberIsFinite = Number.isFinite;
const NativeNumberIsSafeInteger = Number.isSafeInteger;
const NativeString = String;
const NativeTypeError = TypeError;
const nativeDateGetTime = Function.prototype.call.bind(NativeDate.prototype.getTime);
const nativeDateGetUTCFullYear = Function.prototype.call.bind(NativeDate.prototype.getUTCFullYear);
const nativeDateToUTCString = Function.prototype.call.bind(NativeDate.prototype.toUTCString);
const nativeStringCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt);
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

  if (!hasOnlyCookieValueCharacters(encoded)) {
    throw new NativeTypeError('Cookie value could not be encoded as a valid Set-Cookie value.');
  }

  return encoded;
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x5A)
    || (code >= 0x61 && code <= 0x7A)
  );
}

function validateCookieName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new NativeTypeError('Cookie name must contain only valid cookie-name characters.');
  }

  for (let index = 0; index < name.length; index += 1) {
    const code = nativeStringCharCodeAt(name, index);
    const isTokenPunctuation = (
      code === 0x21 || code === 0x23 || code === 0x24 || code === 0x25
      || code === 0x26 || code === 0x27 || code === 0x2A || code === 0x2B
      || code === 0x2D || code === 0x2E || code === 0x5E || code === 0x5F
      || code === 0x60 || code === 0x7C || code === 0x7E
    );

    if (!isAsciiLetterOrDigit(code) && !isTokenPunctuation) {
      throw new NativeTypeError('Cookie name must contain only valid cookie-name characters.');
    }
  }
}

function hasOnlyCookieValueCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = nativeStringCharCodeAt(value, index);
    if (!((code >= 0x21 && code <= 0x3A) || (code >= 0x3C && code <= 0x7E))) {
      return false;
    }
  }

  return true;
}

function validateDomain(value: string): void {
  if (typeof value !== 'string') {
    throw new NativeTypeError('Cookie domain must be a valid ASCII domain name.');
  }

  const firstCode = value.length === 0 ? -1 : nativeStringCharCodeAt(value, 0);
  const start = firstCode === 0x2E ? 1 : 0;
  const hostnameLength = value.length - start;

  if (hostnameLength === 0 || hostnameLength > 253) {
    throw new NativeTypeError('Cookie domain must be a valid ASCII domain name.');
  }

  let labelLength = 0;
  let lastCode = -1;

  for (let index = start; index < value.length; index += 1) {
    const code = nativeStringCharCodeAt(value, index);

    if (code === 0x2E) {
      if (labelLength === 0 || !isAsciiLetterOrDigit(lastCode)) {
        throw new NativeTypeError('Cookie domain must be a valid ASCII domain name.');
      }

      labelLength = 0;
      continue;
    }

    if (
      (!isAsciiLetterOrDigit(code) && code !== 0x2D)
      || (labelLength === 0 && !isAsciiLetterOrDigit(code))
      || labelLength === 63
    ) {
      throw new NativeTypeError('Cookie domain must be a valid ASCII domain name.');
    }

    labelLength += 1;
    lastCode = code;
  }

  if (labelLength === 0 || !isAsciiLetterOrDigit(lastCode)) {
    throw new NativeTypeError('Cookie domain must be a valid ASCII domain name.');
  }
}

function validatePath(value: string): void {
  if (typeof value !== 'string') {
    throw new NativeTypeError('Cookie path must contain only valid cookie attribute characters.');
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = nativeStringCharCodeAt(value, index);
    if (!((code >= 0x20 && code <= 0x3A) || (code >= 0x3C && code <= 0x7E))) {
      throw new NativeTypeError('Cookie path must contain only valid cookie attribute characters.');
    }
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
  let serialized = `${name}=${encodedValue}`;

  if (maxAgeSeconds !== undefined) {
    if (!NativeNumberIsSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
      throw new NativeTypeError('Cookie maxAgeSeconds must be a non-negative safe integer.');
    }

    serialized += `; Max-Age=${NativeString(maxAgeSeconds)}`;
  }

  if (expiresTimestamp !== undefined) {
    serialized += `; Expires=${serializeExpires(expiresTimestamp)}`;
  }

  if (domain !== undefined) {
    validateDomain(domain);
    serialized += `; Domain=${domain}`;
  }

  if (path !== undefined) {
    validatePath(path);
    serialized += `; Path=${path}`;
  }

  if (httpOnly !== undefined && typeof httpOnly !== 'boolean') {
    throw new NativeTypeError('Cookie httpOnly must be a boolean.');
  }

  if (httpOnly === true) {
    serialized += '; HttpOnly';
  }

  if (secure !== undefined && typeof secure !== 'boolean') {
    throw new NativeTypeError('Cookie secure must be a boolean.');
  }

  if (secure === true) {
    serialized += '; Secure';
  }

  if (sameSite !== undefined) {
    if (sameSite === 'none' && secure !== true) {
      throw new NativeTypeError('Cookie sameSite "none" requires secure to be true.');
    }

    serialized += `; SameSite=${serializeSameSite(sameSite)}`;
  }

  return serialized;
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
