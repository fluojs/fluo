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

async function notifyObserversSafely(
  observers: RequestObserverLike[],
  requestContext: RequestContext,
  callback: (observer: RequestObserver, context: RequestObservationContext) => Promise<void> | void,
  handler?: HandlerDescriptor,
): Promise<void> {
  try {
    await notifyObservers(observers, requestContext, callback, handler);
  } catch {
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

  await notifyObserversSafely(
    observers,
    requestContext,
    async (observer, context) => {
      await observer.onRequestSuccess?.(context, result);
    },
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
  await notifyObserversSafely(context.observers, context.requestContext, async (observer, observationContext) => {
    await observer.onRequestStart?.(observationContext);
  });
}

async function notifyHandlerMatched(context: DispatchPhaseContext, descriptor: HandlerDescriptor): Promise<void> {
  await notifyObserversSafely(
    context.observers,
    context.requestContext,
    async (observer, observationContext) => {
      await observer.onHandlerMatched?.(observationContext);
    },
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
    context.matchedHandler,
  );
}

async function runDispatchPipeline(context: DispatchPhaseContext): Promise<void> {
  ensureRequestNotAborted(context.requestContext.request);

  await runMiddlewareChain(context.options.appMiddleware ?? [], {
    request: context.requestContext.request,
    requestContext: context.requestContext,
    response: context.response,
  }, async () => {
    if (context.response.committed) {
      return;
    }

    const match = matchHandlerOrThrow(context.options.handlerMapping, context.requestContext.request);
    context.matchedHandler = match.descriptor;
    updateRequestParams(context.requestContext, match.params);
    await notifyHandlerMatched(context, match.descriptor);

    await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], {
      request: context.requestContext.request,
      requestContext: context.requestContext,
      response: context.response,
    }, async () => {
      await dispatchMatchedHandler(match.descriptor, context.requestContext, context.observers, context.contentNegotiation);
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
        }
      });
    },
  };
}
