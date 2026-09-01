import { getRequestHeader } from '../header-helpers.js';
import type { FrameworkRequest } from '../types.js';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

function readInboundHeaderValue(request: FrameworkRequest, headerName: string): string | undefined {
  const rawHeaderValue = getRequestHeader(request, headerName);
  const value = Array.isArray(rawHeaderValue) ? rawHeaderValue[0] : rawHeaderValue;
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function createRequestId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (randomUUID) {
    return randomUUID.call(globalThis.crypto);
  }

  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Resolves the request identity before dispatcher observers begin.
 *
 * @param request Adapter-normalized request carrying inbound correlation headers.
 * @param generate Whether to generate an ID when neither supported inbound header is present.
 * @returns The adopted request or legacy correlation ID, or a newly generated ID.
 */
export function resolveRequestId(request: FrameworkRequest, generate = true): string | undefined {
  return readInboundHeaderValue(request, REQUEST_ID_HEADER)
    ?? readInboundHeaderValue(request, CORRELATION_ID_HEADER)
    ?? (generate ? createRequestId() : undefined);
}
