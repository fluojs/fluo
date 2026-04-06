import { HandlerNotFoundError } from '../errors.js';
import type { FrameworkRequest, HandlerMapping, HandlerMatch, RequestContext } from '../types.js';

export function matchHandlerOrThrow(handlerMapping: HandlerMapping, request: FrameworkRequest): HandlerMatch {
  const match = handlerMapping.match(request);

  if (!match) {
    throw new HandlerNotFoundError(`No handler registered for ${request.method} ${request.path}.`);
  }

  return match;
}

export function updateRequestParams(requestContext: RequestContext, params: Readonly<Record<string, string>>): void {
  requestContext.request = {
    ...requestContext.request,
    params,
  };
}
