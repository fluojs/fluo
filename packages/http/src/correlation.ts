import { randomUUID } from 'node:crypto';

import type { Middleware } from './types.js';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_ID_HEADER = 'x-correlation-id';

function resolveInboundRequestId(headers: Readonly<Record<string, string | string[] | undefined>>): string {
  const requestId = headers[REQUEST_ID_HEADER] ?? headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(requestId) ? requestId[0] : requestId;

  return value ?? randomUUID();
}

export function createCorrelationMiddleware(): Middleware {
  return {
    async handle(context, next) {
      if (!context.requestContext.requestId) {
        context.requestContext.requestId = resolveInboundRequestId(context.request.headers);
      }

      context.response.setHeader(REQUEST_ID_HEADER, context.requestContext.requestId);

      await next();
    },
  };
}
