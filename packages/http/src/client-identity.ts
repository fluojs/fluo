import type { FrameworkRequest } from './types.js';

const FORWARDED_HEADER = 'forwarded';
const X_FORWARDED_FOR_HEADER = 'x-forwarded-for';
const X_REAL_IP_HEADER = 'x-real-ip';

function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const direct = headers[name];

  if (typeof direct === 'string') {
    return direct;
  }

  if (Array.isArray(direct)) {
    return direct.find((value) => value.trim().length > 0);
  }

  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = match?.[1];

  if (typeof value === 'string') {
    return value;
  }

  return value?.find((entry) => entry.trim().length > 0);
}

function normalizeClientIdentity(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  let normalized = value.trim();

  if (!normalized || normalized.toLowerCase() === 'unknown') {
    return undefined;
  }

  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1).trim();
  }

  const bracketedHostPort = normalized.match(/^\[(.+)]:(\d+)$/);

  if (bracketedHostPort) {
    return bracketedHostPort[1]?.trim() || undefined;
  }

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1).trim();
  }

  const ipv4HostPort = normalized.match(/^((?:\d{1,3}\.){3}\d{1,3}):(\d+)$/);

  if (ipv4HostPort) {
    return ipv4HostPort[1]?.trim() || undefined;
  }

  return normalized || undefined;
}

function resolveForwardedClientIdentity(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  const forwarded = readHeader(headers, FORWARDED_HEADER);

  if (!forwarded) {
    return undefined;
  }

  for (const field of forwarded.split(',')) {
    for (const part of field.split(';')) {
      const separator = part.indexOf('=');

      if (separator === -1) {
        continue;
      }

      const key = part.slice(0, separator).trim().toLowerCase();

      if (key !== 'for') {
        continue;
      }

      const normalized = normalizeClientIdentity(part.slice(separator + 1));

      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function resolveCommaSeparatedClientIdentity(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  headerName: string,
): string | undefined {
  const headerValue = readHeader(headers, headerName);

  if (!headerValue) {
    return undefined;
  }

  for (const value of headerValue.split(',')) {
    const normalized = normalizeClientIdentity(value);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function resolveSocketClientIdentity(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const socket = (raw as { socket?: { remoteAddress?: unknown } }).socket;
  return typeof socket?.remoteAddress === 'string'
    ? normalizeClientIdentity(socket.remoteAddress)
    : undefined;
}

/**
 * Resolve one stable client identity from the normalized request contract.
 *
 * Resolution order is `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, then the
 * raw socket's `remoteAddress`. If none are available, callers must provide an
 * explicit resolver because falling back to a shared `unknown` bucket is not
 * safe in proxied or serverless environments.
 *
 * @param request Adapter-normalized request whose headers/raw transport state should be inspected.
 * @returns A proxy-aware client identity string suitable for rate limiting.
 * @throws Error When the request exposes no trustworthy proxy header or socket identity.
 */
export function resolveClientIdentity(request: FrameworkRequest): string {
  const clientIdentity =
    resolveForwardedClientIdentity(request.headers) ??
    resolveCommaSeparatedClientIdentity(request.headers, X_FORWARDED_FOR_HEADER) ??
    normalizeClientIdentity(readHeader(request.headers, X_REAL_IP_HEADER)) ??
    resolveSocketClientIdentity(request.raw);

  if (clientIdentity) {
    return clientIdentity;
  }

  throw new Error(
    'Unable to resolve client identity from Forwarded, X-Forwarded-For, X-Real-IP, or raw socket remoteAddress. Provide an explicit keyResolver/keyGenerator for this environment.',
  );
}
