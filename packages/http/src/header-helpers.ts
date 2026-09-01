import type { FrameworkRequest, FrameworkResponse } from './types.js';

type HeaderEntry<THeaderValue> = readonly [name: string, value: THeaderValue];

function normalizeHeaderName(name: string): string | undefined {
  const normalized = name.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function findCaseInsensitiveHeaderEntry<THeaderValue>(
  headers: Readonly<Record<string, THeaderValue>>,
  headerName: string,
): HeaderEntry<THeaderValue> | undefined {
  const normalizedHeaderName = normalizeHeaderName(headerName);

  if (!normalizedHeaderName) {
    return undefined;
  }

  let firstMatch: HeaderEntry<THeaderValue> | undefined;

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== normalizedHeaderName) {
      continue;
    }

    if (value !== undefined) {
      return [name, value];
    }

    firstMatch ??= [name, value];
  }

  return firstMatch;
}

function parseHeaderTokens(values: readonly string[]): string[] {
  const tokens: string[] = [];

  for (const value of values) {
    for (const token of value.split(',')) {
      const normalized = token.trim();

      if (normalized.length > 0) {
        tokens.push(normalized);
      }
    }
  }

  return tokens;
}

function readJoinedNonEmptyHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    const normalizedValues = value
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return normalizedValues.length > 0 ? normalizedValues.join(',') : undefined;
  }

  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Reads one request header without flattening multi-value arrays.
 *
 * @param request Adapter-normalized request carrying the inbound headers map.
 * @param name Header name to resolve case-insensitively.
 * @returns The original scalar, array, or `undefined` stored on the request.
 */
export function getRequestHeader(
  request: FrameworkRequest,
  name: string,
): string | string[] | undefined {
  return findCaseInsensitiveHeaderEntry(request.headers, name)?.[1];
}

/**
 * Reads one response header without flattening multi-value arrays.
 *
 * @param response Adapter-normalized response carrying the outbound headers map.
 * @param name Header name to resolve case-insensitively.
 * @returns The original scalar, array, or `undefined` stored on the response.
 */
export function getResponseHeader(
  response: FrameworkResponse,
  name: string,
): string | string[] | undefined {
  return findCaseInsensitiveHeaderEntry(response.headers, name)?.[1];
}

/**
 * Checks whether one response header is present without mutating the response.
 *
 * @param response Adapter-normalized response carrying the outbound headers map.
 * @param name Header name to resolve case-insensitively.
 * @returns `true` when a matching response header has a value.
 */
export function hasResponseHeader(
  response: FrameworkResponse,
  name: string,
): boolean {
  return getResponseHeader(response, name) !== undefined;
}

/**
 * Creates a portable Content-Disposition value with ASCII and UTF-8 filename parameters.
 *
 * @param disposition Whether the response is an `attachment` or rendered `inline`.
 * @param filename Original filename to encode for a response header.
 * @returns A Content-Disposition field value with escaped ASCII and RFC 8187 UTF-8 parameters.
 * @throws {TypeError} When the disposition is unsupported or the filename contains CR or LF.
 */
export function buildContentDisposition(
  disposition: 'attachment' | 'inline',
  filename: string,
): string {
  if (disposition !== 'attachment' && disposition !== 'inline') {
    throw new TypeError('Content-Disposition disposition must be attachment or inline.');
  }

  if (filename.includes('\r') || filename.includes('\n')) {
    throw new TypeError('Content-Disposition filenames cannot contain CR or LF characters.');
  }

  const asciiFilename = filename
    .replace(/[^\x20-\x7E]/gu, '?')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
  const utf8Filename = Array.from(new TextEncoder().encode(filename), (byte) => {
    const isAlphaNumeric =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a);
    const isRfc8187Punctuation =
      byte === 0x21 ||
      byte === 0x23 ||
      byte === 0x24 ||
      byte === 0x26 ||
      byte === 0x2b ||
      byte === 0x2d ||
      byte === 0x2e ||
      byte === 0x5e ||
      byte === 0x5f ||
      byte === 0x60 ||
      byte === 0x7c ||
      byte === 0x7e;

    return isAlphaNumeric || isRfc8187Punctuation
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');

  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`;
}

/**
 * Reads the first non-empty request header value across duplicate case variants.
 *
 * @param request Adapter-normalized request carrying the inbound headers map.
 * @param name Header name to resolve case-insensitively.
 * @returns The first trimmed scalar or joined array value that is not blank.
 */
export function readFirstNonEmptyRequestHeaderValue(
  request: FrameworkRequest,
  name: string,
): string | undefined {
  const normalizedHeaderName = normalizeHeaderName(name);

  if (!normalizedHeaderName) {
    return undefined;
  }

  for (const [headerName, value] of Object.entries(request.headers)) {
    if (headerName.toLowerCase() !== normalizedHeaderName) {
      continue;
    }

    const normalizedValue = readJoinedNonEmptyHeaderValue(value);
    if (normalizedValue !== undefined) {
      return normalizedValue;
    }
  }

  return undefined;
}

/**
 * Appends one or more fields to the response `Vary` header with case-insensitive deduplication.
 *
 * @param response Mutable framework response facade that owns the header map.
 * @param fields Header field names or comma-delimited field lists to append.
 * @returns Nothing. The helper updates the response header map in place when needed.
 */
export function appendVaryHeader(
  response: FrameworkResponse,
  ...fields: string[]
): void {
  const existingEntries = Object.entries(response.headers).filter(
    ([name]) => name.toLowerCase() === 'vary',
  );
  const existingTokens = parseHeaderTokens(
    existingEntries.flatMap(([, value]) => (Array.isArray(value) ? value : [value])),
  );
  const appendedTokens = parseHeaderTokens(fields);
  const mergedTokens = [...existingTokens, ...appendedTokens];

  if (mergedTokens.length === 0) {
    return;
  }

  const canonicalHeaderName = existingEntries[0]?.[0] ?? 'Vary';

  for (const [name] of existingEntries.slice(1)) {
    delete response.headers[name];
  }

  if (mergedTokens.some((token) => token === '*')) {
    response.setHeader(canonicalHeaderName, '*');
    return;
  }

  const dedupedTokens: string[] = [];
  const seen = new Set<string>();

  for (const token of mergedTokens) {
    const normalized = token.toLowerCase();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    dedupedTokens.push(token);
  }

  if (dedupedTokens.length > 0) {
    response.setHeader(canonicalHeaderName, dedupedTokens.join(', '));
  }
}
