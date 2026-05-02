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

function defineRequestParams(request: FrameworkRequest, params: Readonly<Record<string, string>>): void {
  Object.defineProperty(request, 'params', {
    configurable: true,
    enumerable: true,
    value: params,
    writable: true,
  });
}

function findInheritedParamsDescriptor(request: FrameworkRequest): PropertyDescriptor | undefined {
  let prototype: object | null = Object.getPrototypeOf(request);

  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'params');

    if (descriptor) {
      return descriptor;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return undefined;
}

/**
 * Update request params.
 *
 * @param requestContext The request context.
 * @param params The params.
 */
export function updateRequestParams(requestContext: RequestContext, params: Readonly<Record<string, string>>): void {
  const request = requestContext.request;
  const ownDescriptor = Object.getOwnPropertyDescriptor(request, 'params');

  if (ownDescriptor) {
    if ('value' in ownDescriptor && ownDescriptor.writable) {
      request.params = params;
      return;
    }

    defineRequestParams(request, params);
    return;
  }

  const inheritedDescriptor = findInheritedParamsDescriptor(request);

  if (!inheritedDescriptor || ('value' in inheritedDescriptor && inheritedDescriptor.writable)) {
    request.params = params;
    return;
  }

  defineRequestParams(request, params);
}
