import { randomUUID } from 'node:crypto';

import type { Middleware } from './types.js';

const REQUEST_ID_HEADER = 'x-request-id';

export function createCorrelationMiddleware(): Middleware {
  return {
    async handle(context, next) {
      if (!context.requestContext.requestId) {
        context.requestContext.requestId = randomUUID();
      }

      await next();

      context.response.setHeader(REQUEST_ID_HEADER, context.requestContext.requestId);
    },
  };
}
