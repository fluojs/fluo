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
  const existingEntry = findCaseInsensitiveHeaderEntry(response.headers, 'vary');
  const existingTokens = parseHeaderTokens(
    Array.isArray(existingEntry?.[1]) ? existingEntry[1] : existingEntry?.[1] === undefined ? [] : [existingEntry[1]],
  );
  const appendedTokens = parseHeaderTokens(fields);
  const mergedTokens = [...existingTokens, ...appendedTokens];

  if (mergedTokens.length === 0) {
    return;
  }

  if (mergedTokens.some((token) => token === '*')) {
    response.setHeader(existingEntry?.[0] ?? 'Vary', '*');
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
    response.setHeader(existingEntry?.[0] ?? 'Vary', dedupedTokens.join(', '));
  }
}
