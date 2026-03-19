import { InvariantError, type Token } from '@konekti/core';
import type { Container } from '@konekti/di';

import { HandlerNotFoundError, RequestAbortedError } from './errors.js';
import { HttpException, InternalServerException, NotFoundException, createErrorResponse } from './exceptions.js';
import { DefaultBinder } from './binding.js';
import { HttpDtoValidationAdapter } from './dto-validation-adapter.js';
import { runGuardChain } from './guards.js';
import { runInterceptorChain } from './interceptors.js';
import { runMiddlewareChain } from './middleware.js';
import { createRequestContext, runWithRequestContext } from './request-context.js';
import { SseResponse } from './sse.js';
import type {
  ArgumentResolverContext,
  Dispatcher,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  HandlerDescriptor,
  HandlerMapping,
  InterceptorContext,
  MiddlewareLike,
  RequestObserver,
  RequestObserverLike,
  RequestObservationContext,
  RequestContext,
} from './types.js';

const defaultBinder = new DefaultBinder();
const defaultValidator = new HttpDtoValidationAdapter();

export type ErrorHandler = (error: unknown, request: FrameworkRequest, response: FrameworkResponse, requestId?: string) => Promise<boolean | void> | boolean | void;

export interface CreateDispatcherOptions {
  appMiddleware?: MiddlewareLike[];
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

function updateRequestParams(context: RequestContext, params: Readonly<Record<string, string>>): void {
  context.request = {
    ...context.request,
    params,
  };
}

async function invokeControllerHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
): Promise<unknown> {
  const controller = await requestContext.container.resolve(handler.controllerToken as Token<object>);
  const method = (controller as Record<string, unknown>)[handler.methodName];

  if (typeof method !== 'function') {
    throw new InvariantError(
      `Controller ${handler.controllerToken.name} does not expose handler method ${handler.methodName}.`,
    );
  }

  const argumentResolverContext: ArgumentResolverContext = {
    handler,
    requestContext,
  };
  const input = handler.route.request
    ? await defaultBinder.bind(handler.route.request, argumentResolverContext)
    : undefined;

  if (handler.route.request) {
    await defaultValidator.validate(input, handler.route.request);
  }

  return method.call(controller, input, requestContext);
}

function resolveDefaultSuccessStatus(handler: HandlerDescriptor, value: unknown): number {
  switch (handler.route.method) {
    case 'POST':
      return 201;
    case 'DELETE':
    case 'OPTIONS':
      return value === undefined ? 204 : 200;
    default:
      return 200;
  }
}

async function writeSuccessResponse(handler: HandlerDescriptor, response: FrameworkResponse, value: unknown): Promise<void> {
  if (response.committed) {
    return;
  }

  if (handler.route.successStatus !== undefined) {
    response.setStatus(handler.route.successStatus);
  } else if (response.statusSet !== true) {
    response.setStatus(resolveDefaultSuccessStatus(handler, value));
  }

  await response.send(value);
}

function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (request.signal?.aborted) {
    throw new RequestAbortedError();
  }
}

function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof HandlerNotFoundError) {
    return new NotFoundException(error.message, { cause: error });
  }

  return new InternalServerException('Internal server error.', {
    cause: error,
  });
}

async function writeErrorResponse(error: unknown, response: FrameworkResponse, requestId?: string): Promise<void> {
  if (response.committed) {
    return;
  }

  const httpError = toHttpException(error);
  response.setStatus(httpError.status);
  await response.send(createErrorResponse(httpError, requestId));
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
    await writeSuccessResponse(handler, requestContext.response, result);
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
    // Observer errors must not mask a successful request.
  }
}

export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const requestContext = createDispatchContext(createDispatchRequest(request), response, options.rootContainer);
      const observers = options.observers ?? [];

      await runWithRequestContext(requestContext, async () => {
        await notifyObservers(observers, requestContext, async (observer, context) => {
          await observer.onRequestStart?.(context);
        });

        try {
          ensureRequestNotAborted(requestContext.request);
          await runMiddlewareChain(options.appMiddleware ?? [], {
            request: requestContext.request,
            requestContext,
            response,
          }, async () => {
            if (response.committed) {
              return;
            }

            const match = options.handlerMapping.match(requestContext.request);

            if (!match) {
              throw new HandlerNotFoundError(`No handler registered for ${request.method} ${request.path}.`);
            }

            updateRequestParams(requestContext, match.params);
            await notifyObservers(
              observers,
              requestContext,
              async (observer, context) => {
                await observer.onHandlerMatched?.(context);
              },
              match.descriptor,
            );

            await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], {
              request: requestContext.request,
              requestContext,
              response,
            }, async () => {
              await dispatchMatchedHandler(match.descriptor, requestContext, observers);
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
            );
          } catch {
            // Observer errors must not mask the original request error.
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
            });
          } catch {
            // Observer errors in the finally block must not mask earlier errors.
          }
        }
      });
    },
  };
}
