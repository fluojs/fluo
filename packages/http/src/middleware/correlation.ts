import { resolveRequestId } from '../context/request-id.js';
import type { FrameworkRequest, Middleware, MiddlewareLike, RequestContext } from '../types.js';

const REQUEST_ID_HEADER = 'x-request-id';
const CORRELATION_REQUEST_CONTEXT_INITIALIZER = Symbol('fluo.http.correlationRequestContextInitializer');

interface CorrelationMiddleware extends Middleware {
  readonly [CORRELATION_REQUEST_CONTEXT_INITIALIZER]: (context: RequestContext) => void;
}

function initializeCorrelationRequestContext(
  context: RequestContext,
  request: FrameworkRequest = context.request,
): string {
  const requestId = context.requestId ?? resolveRequestId(request);

  if (requestId === undefined) {
    throw new Error('Correlation request ID generation unexpectedly returned undefined.');
  }

  context.requestId = requestId;
  return requestId;
}

/**
 * Initializes correlation-aware request contexts before lifecycle observers run.
 *
 * @internal
 * @param middleware Global middleware definitions registered with the dispatcher.
 * @param context Request context to initialize.
 */
export function initializeCorrelationMiddlewareRequestContext(
  middleware: readonly MiddlewareLike[],
  context: RequestContext,
): void {
  for (const definition of middleware) {
    if (
      typeof definition === 'object'
      && definition !== null
      && CORRELATION_REQUEST_CONTEXT_INITIALIZER in definition
    ) {
      (definition as CorrelationMiddleware)[CORRELATION_REQUEST_CONTEXT_INITIALIZER](context);
    }
  }
}

/**
 * Create correlation middleware.
 *
 * @returns The create correlation middleware result.
 */
export function createCorrelationMiddleware(): Middleware {
  return {
    [CORRELATION_REQUEST_CONTEXT_INITIALIZER]: initializeCorrelationRequestContext,
    async handle(context, next) {
      const requestId = initializeCorrelationRequestContext(context.requestContext, context.request);

      context.response.setHeader(REQUEST_ID_HEADER, requestId);

      await next();
    },
  } as CorrelationMiddleware;
}
