import { HandlerNotFoundError } from '../errors.js';
import type { FrameworkRequest, HandlerMapping, HandlerMatch, RequestContext } from '../types.js';

/**
 * Match handler or throw.
 *
 * @param handlerMapping The handler mapping.
 * @param request The request.
 * @returns The match handler or throw result.
 */
export function matchHandlerOrThrow(handlerMapping: HandlerMapping, request: FrameworkRequest): HandlerMatch {
  const match = handlerMapping.match(request);

  if (!match) {
    throw new HandlerNotFoundError(`No handler registered for ${request.method} ${request.path}.`);
  }

  return match;
}

/**
 * Update request params.
 *
 * @param requestContext The request context.
 * @param params The params.
 */
export function updateRequestParams(requestContext: RequestContext, params: Readonly<Record<string, string>>): void {
  Object.defineProperty(requestContext.request, 'params', {
    configurable: true,
    enumerable: true,
    value: params,
    writable: true,
  });
}
