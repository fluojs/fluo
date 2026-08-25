import { getRequestHeader } from '../header-helpers.js';
import type { Middleware } from '../types.js';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

function readInboundHeaderValue(
  request: { headers: Readonly<Record<string, string | string[] | undefined>> },
  headerName: string,
): string | undefined {
  const rawHeaderValue = getRequestHeader(request as never, headerName);
  const value = Array.isArray(rawHeaderValue) ? rawHeaderValue[0] : rawHeaderValue;
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function resolveInboundRequestId(request: { headers: Readonly<Record<string, string | string[] | undefined>> }): string {
  const requestId = readInboundHeaderValue(request, REQUEST_ID_HEADER);
  const correlationId = readInboundHeaderValue(request, CORRELATION_ID_HEADER);

  return requestId ?? correlationId ?? createRequestId();
}

function createRequestId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;

  if (randomUUID) {
    return randomUUID.call(globalThis.crypto);
  }

  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Create correlation middleware.
 *
 * @returns The create correlation middleware result.
 */
export function createCorrelationMiddleware(): Middleware {
  return {
    async handle(context, next) {
      if (!context.requestContext.requestId) {
        context.requestContext.requestId = resolveInboundRequestId(context.request);
      }

      context.response.setHeader(REQUEST_ID_HEADER, context.requestContext.requestId);

      await next();
    },
  };
}
