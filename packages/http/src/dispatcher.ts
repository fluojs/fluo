import type { Token } from '@konekti/core';
import type { Container } from '@konekti/di';

import { invokeControllerHandler } from './dispatch-handler-policy.js';
import { resolveContentNegotiation, writeErrorResponse, writeSuccessResponse, type ResolvedContentNegotiation } from './dispatch-response-policy.js';
import { matchHandlerOrThrow, updateRequestParams } from './dispatch-routing-policy.js';
import { RequestAbortedError } from './errors.js';
import { runGuardChain } from './guards.js';
import { runInterceptorChain } from './interceptors.js';
import { runMiddlewareChain } from './middleware.js';
import { createRequestContext, runWithRequestContext } from './request-context.js';
import { SseResponse } from './sse.js';
import type {
  ContentNegotiationOptions,
  Dispatcher,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  HandlerDescriptor,
  HandlerMapping,
  InterceptorContext,
  MiddlewareLike,
  RequestContext,
  RequestObservationContext,
  RequestObserver,
  RequestObserverLike,
} from './types.js';

export type ErrorHandler = (error: unknown, request: FrameworkRequest, response: FrameworkResponse, requestId?: string) => Promise<boolean | void> | boolean | void;

export interface CreateDispatcherOptions {
  appMiddleware?: MiddlewareLike[];
  contentNegotiation?: ContentNegotiationOptions;
  handlerMapping: HandlerMapping;
  observers?: RequestObserverLike[];
  onError?: ErrorHandler;
  rootContainer: Container;
}

function createDispatchRequest(request: FrameworkRequest): FrameworkRequest {
  return {
    ...request,
    params: { ...request.params },
  };
}

function readRequestId(request: FrameworkRequest): string | undefined {
  const raw = request.headers['x-request-id'] ?? request.headers['X-Request-Id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function createDispatchContext(
  request: FrameworkRequest,
  response: FrameworkResponse,
  rootContainer: Container,
): RequestContext {
  return createRequestContext({
    container: rootContainer.createRequestScope(),
    metadata: {},
    request,
    requestId: readRequestId(request),
    response,
  });
}

function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}

function isRequestObserver(value: RequestObserverLike): value is RequestObserver {
  return typeof value === 'object' && value !== null;
}

async function resolveRequestObserver(
  definition: RequestObserverLike,
  requestContext: RequestContext,
): Promise<RequestObserver> {
  if (isRequestObserver(definition)) {
    return definition;
  }

  return requestContext.container.resolve(definition as Token<RequestObserver>);
}

async function notifyObservers(
  observers: RequestObserverLike[],
  requestContext: RequestContext,
  callback: (observer: RequestObserver, context: RequestObservationContext) => Promise<void> | void,
  handler?: HandlerDescriptor,
): Promise<void> {
  const context: RequestObservationContext = {
    handler,
    requestContext,
  };

  for (const definition of observers) {
    const observer = await resolveRequestObserver(definition, requestContext);
    await callback(observer, context);
  }
}

async function dispatchMatchedHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  observers: RequestObserverLike[],
  contentNegotiation: ResolvedContentNegotiation | undefined,
): Promise<void> {
  const guardContext: GuardContext = {
    handler,
    requestContext,
  };
  const interceptorContext: InterceptorContext = {
    handler,
    requestContext,
  };

  await runGuardChain(handler.route.guards ?? [], guardContext);

  if (requestContext.response.committed) {
    return;
  }

  const result = await runInterceptorChain(handler.route.interceptors ?? [], interceptorContext, async () => {
    return invokeControllerHandler(handler, requestContext);
  });

  ensureRequestNotAborted(requestContext.request);

  if (!(result instanceof SseResponse) && !requestContext.response.committed) {
    await writeSuccessResponse(handler, requestContext.request, requestContext.response, result, contentNegotiation);
  }

  try {
    await notifyObservers(
      observers,
      requestContext,
      async (observer, context) => {
        await observer.onRequestSuccess?.(context, result);
      },
      handler,
    );
  } catch {
  }
}

export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const requestContext = createDispatchContext(createDispatchRequest(request), response, options.rootContainer);
      const observers = options.observers ?? [];
      let matchedHandler: HandlerDescriptor | undefined;

      await runWithRequestContext(requestContext, async () => {
        try {
          try {
            await notifyObservers(observers, requestContext, async (observer, context) => {
              await observer.onRequestStart?.(context);
            });
          } catch {
          }

          ensureRequestNotAborted(requestContext.request);
          await runMiddlewareChain(options.appMiddleware ?? [], {
            request: requestContext.request,
            requestContext,
            response,
          }, async () => {
            if (response.committed) {
              return;
            }

            const match = matchHandlerOrThrow(options.handlerMapping, requestContext.request);
            matchedHandler = match.descriptor;
            updateRequestParams(requestContext, match.params);
            try {
              await notifyObservers(
                observers,
                requestContext,
                async (observer, context) => {
                  await observer.onHandlerMatched?.(context);
                },
                match.descriptor,
              );
            } catch {
            }

            await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], {
              request: requestContext.request,
              requestContext,
              response,
            }, async () => {
              await dispatchMatchedHandler(match.descriptor, requestContext, observers, contentNegotiation);
            });
          });
        } catch (error: unknown) {
          if (error instanceof RequestAbortedError || requestContext.request.signal?.aborted) {
            return;
          }

          try {
            await notifyObservers(
              observers,
              requestContext,
              async (observer, context) => {
                await observer.onRequestError?.(context, error);
              },
              matchedHandler,
            );
          } catch {
          }

          const handled = await options.onError?.(error, requestContext.request, response, requestContext.requestId);

          if (handled) {
            return;
          }

          await writeErrorResponse(error, response, requestContext.requestId);
        } finally {
          try {
            await notifyObservers(observers, requestContext, async (observer, context) => {
              await observer.onRequestFinish?.(context);
            }, matchedHandler);
          } catch {
          }
        }
      });
    },
  };
}
