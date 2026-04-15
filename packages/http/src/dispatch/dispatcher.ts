import type { Token } from '@fluojs/core';
import type { Container } from '@fluojs/di';

import { invokeControllerHandler } from './dispatch-handler-policy.js';
import { resolveContentNegotiation, writeErrorResponse, writeSuccessResponse, type ResolvedContentNegotiation } from './dispatch-response-policy.js';
import { matchHandlerOrThrow, updateRequestParams } from './dispatch-routing-policy.js';
import { RequestAbortedError } from '../errors.js';
import { runGuardChain } from '../guards.js';
import { runInterceptorChain } from '../interceptors.js';
import { runMiddlewareChain } from '../middleware/middleware.js';
import { createRequestContext, runWithRequestContext } from '../context/request-context.js';
import { SseResponse } from '../context/sse.js';
import type {
  Binder,
  ContentNegotiationOptions,
  Dispatcher,
  DispatcherLogger,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  HandlerDescriptor,
  HandlerMapping,
  InterceptorLike,
  InterceptorContext,
  MiddlewareContext,
  MiddlewareLike,
  RequestContext,
  RequestObservationContext,
  RequestObserver,
  RequestObserverLike,
} from '../types.js';

/**
 * Type definition for a global HTTP error handler function.
 */
export type ErrorHandler = (error: unknown, request: FrameworkRequest, response: FrameworkResponse, requestId?: string) => Promise<boolean | void> | boolean | void;

/**
 * Options for creating an HTTP {@link Dispatcher}.
 */
export interface CreateDispatcherOptions {
  /** Global middleware applied to all requests. */
  appMiddleware?: MiddlewareLike[];
  /** Optional parameter binder for mapping request data to controller arguments. */
  binder?: Binder;
  /** Optional content negotiation configuration. */
  contentNegotiation?: ContentNegotiationOptions;
  /** Mapping of routes to their respective handlers. */
  handlerMapping: HandlerMapping;
  /** Global interceptors applied to all matched handlers. */
  interceptors?: InterceptorLike[];
  /** Global request observers for telemetry and logging. */
  observers?: RequestObserverLike[];
  /** Optional global error handler. */
  onError?: ErrorHandler;
  logger?: DispatcherLogger;
  /** Root DI container for creating request scopes. */
  rootContainer: Container;
}

function logDispatchFailure(
  logger: DispatcherLogger | undefined,
  message: string,
  error: unknown,
): void {
  if (logger) {
    logger.error(message, error, 'HttpDispatcher');
    return;
  }

  console.error(`[fluo][HttpDispatcher] ${message}`, error);
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

async function notifyObserversSafely(
  observers: RequestObserverLike[],
  requestContext: RequestContext,
  callback: (observer: RequestObserver, context: RequestObservationContext) => Promise<void> | void,
  logger: DispatcherLogger | undefined,
  handler?: HandlerDescriptor,
): Promise<void> {
  try {
    await notifyObservers(observers, requestContext, callback, handler);
  } catch (error) {
    logDispatchFailure(logger, 'Request observer threw an unhandled error.', error);
  }
}

async function dispatchMatchedHandler(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  observers: RequestObserverLike[],
  contentNegotiation: ResolvedContentNegotiation | undefined,
  binder: Binder | undefined,
  globalInterceptors: InterceptorLike[] | undefined,
  logger: DispatcherLogger | undefined,
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

  const interceptors = [...(globalInterceptors ?? []), ...(handler.route.interceptors ?? [])];

  const result = await runInterceptorChain(interceptors, interceptorContext, async () => {
    return invokeControllerHandler(handler, requestContext, binder);
  });

  ensureRequestNotAborted(requestContext.request);

  if (!(result instanceof SseResponse) && !requestContext.response.committed) {
    await writeSuccessResponse(handler, requestContext.request, requestContext.response, result, contentNegotiation);
  }

  await notifyObserversSafely(
    observers,
    requestContext,
    async (observer, context) => {
      await observer.onRequestSuccess?.(context, result);
    },
    logger,
    handler,
  );
}

interface DispatchPhaseContext {
  contentNegotiation: ResolvedContentNegotiation | undefined;
  matchedHandler?: HandlerDescriptor;
  observers: RequestObserverLike[];
  options: CreateDispatcherOptions;
  requestContext: RequestContext;
  response: FrameworkResponse;
}

async function notifyRequestStart(context: DispatchPhaseContext): Promise<void> {
  await notifyObserversSafely(
    context.observers,
    context.requestContext,
    async (observer, observationContext) => {
      await observer.onRequestStart?.(observationContext);
    },
    context.options.logger,
  );
}

async function notifyHandlerMatched(context: DispatchPhaseContext, descriptor: HandlerDescriptor): Promise<void> {
  await notifyObserversSafely(
    context.observers,
    context.requestContext,
    async (observer, observationContext) => {
      await observer.onHandlerMatched?.(observationContext);
    },
    context.options.logger,
    descriptor,
  );
}

async function notifyRequestError(context: DispatchPhaseContext, error: unknown): Promise<void> {
  await notifyObserversSafely(
    context.observers,
    context.requestContext,
    async (observer, observationContext) => {
      await observer.onRequestError?.(observationContext, error);
    },
    context.options.logger,
    context.matchedHandler,
  );
}

async function notifyRequestFinish(context: DispatchPhaseContext): Promise<void> {
  await notifyObserversSafely(
    context.observers,
    context.requestContext,
    async (observer, observationContext) => {
      await observer.onRequestFinish?.(observationContext);
    },
    context.options.logger,
    context.matchedHandler,
  );
}

async function runDispatchPipeline(context: DispatchPhaseContext): Promise<void> {
  ensureRequestNotAborted(context.requestContext.request);

  const appMiddlewareContext: MiddlewareContext = {
    request: context.requestContext.request,
    requestContext: context.requestContext,
    response: context.response,
  };

  await runMiddlewareChain(context.options.appMiddleware ?? [], appMiddlewareContext, async () => {
    if (context.response.committed) {
      return;
    }

    const match = matchHandlerOrThrow(context.options.handlerMapping, appMiddlewareContext.request);
    context.matchedHandler = match.descriptor;
    updateRequestParams(context.requestContext, match.params);
    await notifyHandlerMatched(context, match.descriptor);

    const moduleMiddlewareContext: MiddlewareContext = {
      request: context.requestContext.request,
      requestContext: context.requestContext,
      response: context.response,
    };

    await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], moduleMiddlewareContext, async () => {
      await dispatchMatchedHandler(
        match.descriptor,
        context.requestContext,
        context.observers,
        context.contentNegotiation,
        context.options.binder,
        context.options.interceptors,
        context.options.logger,
      );
    });
  });
}

async function handleDispatchError(context: DispatchPhaseContext, error: unknown): Promise<void> {
  if (error instanceof RequestAbortedError || context.requestContext.request.signal?.aborted) {
    return;
  }

  await notifyRequestError(context, error);

  const handled = await context.options.onError?.(
    error,
    context.requestContext.request,
    context.response,
    context.requestContext.requestId,
  );

  if (handled) {
    return;
  }

  await writeErrorResponse(error, context.response, context.requestContext.requestId);
}

/**
 * Creates an HTTP dispatcher instance for processing requests.
 *
 * @param options Configuration for routing, middleware, and dependency resolution.
 * @returns A {@link Dispatcher} capable of routing {@link FrameworkRequest}s.
 */
export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);

  return {
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const phaseContext: DispatchPhaseContext = {
        contentNegotiation,
        observers: options.observers ?? [],
        options,
        requestContext: createDispatchContext(createDispatchRequest(request), response, options.rootContainer),
        response,
      };

      await runWithRequestContext(phaseContext.requestContext, async () => {
        try {
          await notifyRequestStart(phaseContext);
          await runDispatchPipeline(phaseContext);
        } catch (error: unknown) {
          await handleDispatchError(phaseContext, error);
        } finally {
          await notifyRequestFinish(phaseContext);
          try {
            await phaseContext.requestContext.container.dispose();
          } catch (error) {
            logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
          }
        }
      });
    },
  };
}
