import type { Token } from '@fluojs/core';
import type { Container, RequestScopeContainer } from '@fluojs/di';
import { getCompiledDtoBindingPlan } from '../adapters/dto-binding-plan.js';
import { createRequestContext, runWithRequestContext } from '../context/request-context.js';
import { isSseMessage, SseResponse, type SseSendOptions, waitForSseResponseCompletion } from '../context/sse.js';
import { RequestAbortedError } from '../errors.js';
import { runGuardChain } from '../guards.js';
import { getRequestHeader } from '../header-helpers.js';
import { runInterceptorChain } from '../interceptors.js';
import { isMiddlewareRouteConfig, matchRoutePattern, runMiddlewareChain } from '../middleware/middleware.js';
import type {
  Binder,
  ConditionalRequestOptions,
  ContentNegotiationOptions,
  ConverterLike,
  Dispatcher,
  DispatcherLogger,
  FrameworkRequest,
  FrameworkResponse,
  FrameworkResponseStream,
  GuardContext,
  GuardLike,
  HandlerDescriptor,
  HandlerMapping,
  HandlerMatch,
  HttpErrorRepresentationOptions,
  InterceptorLike,
  MiddlewareContext,
  MiddlewareLike,
  MiddlewareSnapshotLike,
  RequestContext,
  RequestObservationContext,
  RequestObserver,
  RequestObserverLike,
  ResponseValidators,
} from '../types.js';
import {
  type ConditionalRequestOutcome,
  resolveConditionalRequest,
} from './conditional-request-policy.js';
import { isContentNegotiationNotAcceptableException } from './dispatch-content-negotiation.js';
import { invokeControllerHandler } from './dispatch-handler-policy.js';
import {
  type ResolvedContentNegotiation,
  resolveResponsePolicy,
  resolveContentNegotiation,
  writeErrorResponse,
  writeSuccessResponse,
} from './dispatch-response-policy.js';
import { matchHandlerOrThrow, updateRequestParams } from './dispatch-routing-policy.js';
import { createDispatcherFastPathState, type DispatcherFastPathState } from './fast-path/dispatcher-state.js';
import {
  addPathDebugHeader,
  createPathDebugInfo,
  executeFastPath,
  FAST_PATH_STATS_SYMBOL,
  type FastPathStats,
  shouldUseFastPathForRequest,
} from './fast-path/index.js';
import { attachFrameworkRequestNativeRouteHandoff, readFrameworkRequestNativeRouteHandoff } from './native-route-handoff.js';
import { isRequestAborted } from './request-abort.js';
import { FRAMEWORK_RESPONSE_VALUE_FINALIZER } from './response-integration.js';

export type { FastPathEligibility, FastPathStats } from './fast-path/index.js';
export { FAST_PATH_ELIGIBILITY_SYMBOL, FAST_PATH_STATS_SYMBOL } from './fast-path/index.js';

/** Type definition for a global HTTP error handler function. */
export type ErrorHandler = (error: unknown, request: FrameworkRequest, response: FrameworkResponse, requestId?: string) => Promise<boolean | void> | boolean | void;

/** Options for creating an HTTP {@link Dispatcher}. */
export interface CreateDispatcherOptions {
  /** Global middleware applied to all requests. */
  appMiddleware?: MiddlewareLike[];
  /** Optional parameter binder for mapping request data to controller arguments. */
  binder?: Binder;
  /** Optional content negotiation configuration. */
  contentNegotiation?: ContentNegotiationOptions;
  /** Optional dispatcher-owned HTTP conditional request policy. */
  conditionalRequest?: ConditionalRequestOptions;
  /** Mapping of routes to their respective handlers. */
  handlerMapping: HandlerMapping;
  /** Global interceptors applied to all matched handlers. */
  interceptors?: InterceptorLike[];
  /** Global request observers for telemetry and logging. */
  observers?: RequestObserverLike[];
  /** Emits per-response fast-path debug headers when enabled. */
  fastPathDebugHeaders?: boolean;
  /** Optional global error handler. */
  onError?: ErrorHandler;
  /** Optional application-owned HTML representation for HTTP-classified errors. */
  errorRepresentation?: HttpErrorRepresentationOptions;
  /** Request-scope optimization hints supplied by runtime bootstrap. */
  requestScope?: {
    /** Global DTO converters used by the default binder. */
    converterDefinitions?: readonly ConverterLike[];
  };
  /** Logger used for non-fatal dispatcher failures. */
  logger?: DispatcherLogger;
  /** Root DI container for creating request scopes. */
  rootContainer: Container;
  /** Human-readable adapter label included in fast-path observability output. */
  adapter?: string;
}

interface DispatchScope {
  container: RequestScopeContainer;
  requestScoped: boolean;
}

interface RequestScopeInspector {
  hasRequestScopedDependency(token: Token): boolean;
}

type FrameworkRequestWithFiles = FrameworkRequest & {
  files?: unknown;
};

type FrameworkRequestWithPrincipal = FrameworkRequest & {
  principal?: unknown;
};

interface CompiledMiddlewareScopePlan {
  alwaysRequiresRequestScope: boolean;
  conditionalDefinitions: MiddlewareSnapshotLike[];
}

interface CompiledDispatchStartPlan {
  requestScope: CompiledMiddlewareScopePlan;
  requiresRequestScope: boolean;
}

interface CompiledHandlerExecutionPlan {
  mergedInterceptors: InterceptorLike[];
  requestScope: CompiledMiddlewareScopePlan;
  requiresRequestScope: boolean;
  routeGuards: readonly GuardLike[];
}

interface FastPathHandlerRuntimeCache {
  method?: (this: object, input: unknown, requestContext: RequestContext) => unknown;
}

const EMPTY_NATIVE_FAST_PATH_HANDLER_EXECUTION_PLANS = new WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>();
const EMPTY_NATIVE_FAST_PATH_OBSERVERS: RequestObserverLike[] = [];

class ManagedSseCleanupError extends Error {
  readonly cleanupError: unknown;

  constructor(cleanupError: unknown) {
    super('Managed SSE iterator cleanup failed.', { cause: cleanupError });
    this.name = 'ManagedSseCleanupError';
    this.cleanupError = cleanupError;
  }
}

class ManagedSseOperationError extends Error {
  readonly operationError: unknown;

  constructor(operationError: unknown) {
    super('Managed SSE operation failed.', { cause: operationError });
    this.name = 'ManagedSseOperationError';
    this.operationError = operationError;
  }
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
  const dispatchRequest: FrameworkRequest = {
    get cookies() {
      return request.cookies;
    },
    get headers() {
      return request.headers;
    },
    get query() {
      return request.query;
    },
    body: request.body,
    connection: request.connection,
    method: request.method,
    params: { ...request.params },
    path: request.path,
    raw: request.raw,
    rawBody: request.rawBody,
    requestId: request.requestId,
    isAborted: request.isAborted,
    signal: request.signal,
    url: request.url,
  };

  const nativeRouteHandoff = readFrameworkRequestNativeRouteHandoff(request);

  const files = (request as FrameworkRequestWithFiles).files;
  const principal = (request as FrameworkRequestWithPrincipal).principal;

  if (files !== undefined) {
    (dispatchRequest as FrameworkRequestWithFiles).files = files;
  }

  if (principal !== undefined) {
    (dispatchRequest as FrameworkRequestWithPrincipal).principal = principal;
  }

  return nativeRouteHandoff
    ? attachFrameworkRequestNativeRouteHandoff(dispatchRequest, nativeRouteHandoff)
    : dispatchRequest;
}

function readRequestId(request: FrameworkRequest): string | undefined {
  if (request.requestId) {
    return request.requestId;
  }

  const raw = getRequestHeader(request, 'x-request-id');
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function createDispatchContext(
  request: FrameworkRequest,
  response: FrameworkResponse,
  container: RequestScopeContainer,
  promoteOnContainerAccess?: () => RequestScopeContainer,
): RequestContext {
  const context = createRequestContext({
    container,
    metadata: {},
    request,
    requestId: readRequestId(request),
    response,
  });

  if (!promoteOnContainerAccess) {
    return context;
  }

  // Wrap the container to only promote to request scope when resolve() is actually called.
  // This allows fast-path handlers to check ctx.container without triggering scope creation.
  let activeContainer: RequestScopeContainer = container;
  let wrappedContainer: RequestScopeContainer | undefined;
  let promoted = false;

  const ensurePromoted = (): RequestScopeContainer => {
    if (!promoted) {
      activeContainer = promoteOnContainerAccess();
      promoted = true;
    }
    return activeContainer;
  };

  const getWrappedContainer = (): RequestScopeContainer => {
    if (!wrappedContainer) {
      const wrapped = {
        async resolve<T>(token: Token<T>): Promise<T> {
          const targetContainer = ensurePromoted();
          return targetContainer.resolve(token);
        },
        async dispose(): Promise<void> {
          // If promotion never happened, this is a no-op.
          // This prevents accidentally disposing the root container when a
          // captured container reference is used after a singleton-only request.
          if (!promoted) {
            return;
          }
          return activeContainer.dispose();
        },
      };

      const presenceAwareContainer = activeContainer as RequestScopeContainer & {
        has?<T>(token: Token<T>): boolean;
      };

      if (typeof presenceAwareContainer.has === 'function') {
        Object.assign(wrapped, {
          has<T>(token: Token<T>): boolean {
            const targetContainer = activeContainer as typeof presenceAwareContainer;
            return targetContainer.has?.(token) ?? false;
          },
        });
      }

      wrappedContainer = wrapped;
    }
    return wrappedContainer;
  };

  Object.defineProperty(context, 'container', {
    configurable: true,
    enumerable: true,
    get() {
      // If promotion has already occurred, return the actual container.
      if (promoted) {
        return activeContainer;
      }
      // Return the wrapped container that will promote on resolve().
      return getWrappedContainer();
    },
    set(value: RequestScopeContainer) {
      activeContainer = value;
      promoted = true;
    },
  });

  return context;
}

function createRootDispatchScope(rootContainer: Container): DispatchScope {
  return {
    container: rootContainer,
    requestScoped: false,
  };
}

function createRequestDispatchScope(rootContainer: Container): DispatchScope {
  return {
    container: rootContainer.createRequestScope(),
    requestScoped: true,
  };
}

function activeMiddlewareMayRequireRequestScope(
  definitions: readonly MiddlewareSnapshotLike[],
  request: FrameworkRequest,
): boolean {
  return definitions.some((definition) => {
    if (!isMiddlewareRouteConfig(definition)) {
      return true;
    }

    return definition.routes.length === 0 || definition.routes.some((route) => matchRoutePattern(route, request.path));
  });
}

function compileMiddlewareScopePlan(definitions: readonly MiddlewareSnapshotLike[]): CompiledMiddlewareScopePlan {
  const conditionalDefinitions: MiddlewareSnapshotLike[] = [];

  for (const definition of definitions) {
    if (!isMiddlewareRouteConfig(definition) || definition.routes.length === 0) {
      return {
        alwaysRequiresRequestScope: true,
        conditionalDefinitions: [],
      };
    }

    conditionalDefinitions.push(definition);
  }

  return {
    alwaysRequiresRequestScope: false,
    conditionalDefinitions,
  };
}

function compiledMiddlewareMayRequireRequestScope(
  plan: CompiledMiddlewareScopePlan,
  request: FrameworkRequest,
): boolean {
  return plan.alwaysRequiresRequestScope || activeMiddlewareMayRequireRequestScope(plan.conditionalDefinitions, request);
}

function requestDtoMayRequireRequestScope(handler: HandlerDescriptor, options: CreateDispatcherOptions): boolean {
  if (!handler.route.request) {
    return false;
  }

  if ((options.requestScope?.converterDefinitions ?? []).length > 0) {
    return true;
  }

  if (options.binder) {
    return true;
  }

  const plan = getCompiledDtoBindingPlan(handler.route.request);

  return plan.entries.some((entry) => entry.converter !== undefined);
}

function handlerMethodMayUseRequestContext(handler: HandlerDescriptor): boolean {
  const method = handler.controllerToken.prototype[handler.methodName] as unknown;

  return typeof method === 'function' && method.length >= 2;
}

function hasRequestScopeInspector(container: unknown): container is RequestScopeInspector {
  return typeof container === 'object'
    && container !== null
    && 'hasRequestScopedDependency' in container
    && typeof container.hasRequestScopedDependency === 'function';
}

function compileHandlerExecutionPlan(
  handler: HandlerDescriptor,
  options: CreateDispatcherOptions,
): CompiledHandlerExecutionPlan {
  const routeGuards = handler.route.guards ?? [];
  const requestScope = compileMiddlewareScopePlan(handler.metadata.moduleMiddleware);
  const mergedInterceptors = mergeInterceptors(options.interceptors ?? [], handler.route.interceptors ?? []);

  return {
    mergedInterceptors,
    requestScope,
    requiresRequestScope:
      routeGuards.length > 0
      || mergedInterceptors.length > 0
      || requestScope.alwaysRequiresRequestScope
      || requestDtoMayRequireRequestScope(handler, options)
      || handlerMethodMayUseRequestContext(handler)
      || (hasRequestScopeInspector(options.rootContainer)
        ? options.rootContainer.hasRequestScopedDependency(handler.controllerToken)
        : true),
    routeGuards,
  };
}

function handlerMayRequireRequestScope(
  plan: CompiledHandlerExecutionPlan,
  request: FrameworkRequest,
): boolean {
  return plan.requiresRequestScope || compiledMiddlewareMayRequireRequestScope(plan.requestScope, request);
}

function compileDispatchStartPlan(
  observers: readonly RequestObserverLike[],
  appMiddleware: readonly MiddlewareLike[],
): CompiledDispatchStartPlan {
  const requestScope = compileMiddlewareScopePlan(appMiddleware);

  return {
    requestScope,
    requiresRequestScope: observers.length > 0 || requestScope.alwaysRequiresRequestScope,
  };
}

function dispatchStartMayRequireRequestScope(
  plan: CompiledDispatchStartPlan,
  request: FrameworkRequest,
): boolean {
  return plan.requiresRequestScope || compiledMiddlewareMayRequireRequestScope(plan.requestScope, request);
}

function ensureRequestScope(context: DispatchPhaseContext): void {
  if (context.dispatchScope.requestScoped) {
    return;
  }

  context.dispatchScope = createRequestDispatchScope(context.options.rootContainer);
  context.requestContext.container = context.dispatchScope.container;
}

function ensureRequestNotAborted(request: FrameworkRequest): void {
  if (isRequestAborted(request)) {
    throw new RequestAbortedError();
  }
}

function isSseRoute(handler: HandlerDescriptor): boolean {
  return handler.route.produces?.some((mediaType) => mediaType.toLowerCase().startsWith('text/event-stream')) === true;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object'
    && value !== null
    && Symbol.asyncIterator in value
    && typeof value[Symbol.asyncIterator] === 'function';
}

function createAbortPromise(request: FrameworkRequest): { promise: Promise<'aborted'>; cleanup: () => void } | undefined {
  if (!request.signal) {
    return undefined;
  }

  if (request.signal.aborted) {
    return { cleanup: () => undefined, promise: Promise.resolve('aborted') };
  }

  let listener: (() => void) | undefined;
  const promise = new Promise<'aborted'>((resolve) => {
    listener = () => resolve('aborted');
    request.signal?.addEventListener('abort', listener, { once: true });
  });

  return {
    cleanup: () => {
      if (listener) {
        request.signal?.removeEventListener('abort', listener);
      }
    },
    promise,
  };
}

function createStreamClosePromise(stream: FrameworkResponseStream): { promise: Promise<'aborted'>; cleanup: () => void } | undefined {
  if (stream.closed) {
    return { cleanup: () => undefined, promise: Promise.resolve('aborted') };
  }

  if (!stream.onClose) {
    return undefined;
  }

  let cleanup: (() => void) | undefined;
  const promise = new Promise<'aborted'>((resolve) => {
    cleanup = stream.onClose?.(() => resolve('aborted')) ?? undefined;
  });

  return {
    cleanup: () => {
      cleanup?.();
    },
    promise,
  };
}

function createManagedSseStopPromise(
  request: FrameworkRequest,
  stream: FrameworkResponseStream,
): { promise: Promise<'aborted'>; cleanup: () => void } | undefined {
  const stops = [createAbortPromise(request), createStreamClosePromise(stream)]
    .filter((entry): entry is { promise: Promise<'aborted'>; cleanup: () => void } => entry !== undefined);

  if (stops.length === 0) {
    return undefined;
  }

  return {
    cleanup: () => {
      for (const stop of stops) {
        stop.cleanup();
      }
    },
    promise: Promise.race(stops.map((stop) => stop.promise)),
  };
}

function resolveManagedSseFrame(value: unknown): { data: unknown; options: SseSendOptions } {
  if (isSseMessage(value)) {
    const { data, event, id, retry } = value;
    return {
      data,
      options: { event, id, retry },
    };
  }

  return { data: value, options: {} };
}

async function closeAsyncIterator(iterator: AsyncIterator<unknown>): Promise<void> {
  await iterator.return?.();
}

async function waitForManagedSseOperation<T>(
  request: FrameworkRequest,
  stream: FrameworkResponseStream,
  operation: Promise<T>,
): Promise<T | 'aborted'> {
  const abort = createManagedSseStopPromise(request, stream);

  if (!abort) {
    return operation;
  }

  try {
    return await Promise.race([operation, abort.promise]);
  } finally {
    abort.cleanup();
  }
}

async function writeManagedSseIterable(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
  source: AsyncIterable<unknown>,
): Promise<boolean> {
  if (!isSseRoute(handler)) {
    return false;
  }

  const stream = requestContext.response.stream;

  if (!stream) {
    throw new Error('Managed SSE requires adapter-provided response.stream support.');
  }

  const sse = new SseResponse(requestContext);

  const iterator = source[Symbol.asyncIterator]();
  let iteratorCleanup: Promise<void> | undefined;
  let iteratorCleanupFailure: ManagedSseCleanupError | undefined;

  try {
    while (true) {
      if (isRequestAborted(requestContext.request)) {
        iteratorCleanup ??= closeAsyncIterator(iterator);
        break;
      }

      const next = await waitForManagedSseOperation(requestContext.request, stream, iterator.next());

      if (next === 'aborted') {
        iteratorCleanup ??= closeAsyncIterator(iterator);
        break;
      }

      if (next.done === true) {
        break;
      }

      const frame = resolveManagedSseFrame(next.value);
      const accepted = sse.send(frame.data, frame.options);

      if (!accepted && stream.waitForDrain) {
        const drain = await waitForManagedSseOperation(requestContext.request, stream, stream.waitForDrain());

        if (drain === 'aborted') {
          iteratorCleanup ??= closeAsyncIterator(iterator);
          break;
        }
      }
    }
  } catch (error) {
    throw new ManagedSseOperationError(error);
  } finally {
    sse.close();

    if (iteratorCleanup) {
      try {
        await iteratorCleanup;
      } catch (error) {
        iteratorCleanupFailure = new ManagedSseCleanupError(error);
      }
    }
  }

  if (iteratorCleanupFailure) {
    throw iteratorCleanupFailure;
  }

  return true;
}

function resolveFastPathHandlerRuntimeCache(
  handler: HandlerDescriptor,
  cache: WeakMap<HandlerDescriptor, FastPathHandlerRuntimeCache>,
): FastPathHandlerRuntimeCache {
  const cached = cache.get(handler);

  if (cached) {
    return cached;
  }

  const method = handler.controllerToken.prototype[handler.methodName] as unknown;

  const compiled = {
    method: typeof method === 'function'
      ? method as (this: object, input: unknown, requestContext: RequestContext) => unknown
      : undefined,
  };
  cache.set(handler, compiled);
  return compiled;
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
  if (observers.length === 0) {
    return;
  }

  try {
    await notifyObservers(observers, requestContext, callback, handler);
  } catch (error) {
    logDispatchFailure(logger, 'Request observer threw an unhandled error.', error);
  }
}

function mergeInterceptors(
  globalInterceptors: readonly InterceptorLike[],
  routeInterceptors: readonly InterceptorLike[],
): InterceptorLike[] {
  if (globalInterceptors.length === 0) {
    return routeInterceptors as InterceptorLike[];
  }

  if (routeInterceptors.length === 0) {
    return globalInterceptors as InterceptorLike[];
  }

  return [...globalInterceptors, ...routeInterceptors];
}

async function dispatchMatchedHandler(
  handler: HandlerDescriptor,
  executionPlan: CompiledHandlerExecutionPlan,
  requestContext: RequestContext,
  controllerContainer: RequestScopeContainer,
  contentNegotiation: ResolvedContentNegotiation | undefined,
  binder: Binder | undefined,
  conditionalRequest: ConditionalRequestOptions | undefined,
): Promise<{ readonly result: unknown } | undefined> {
  const routeGuards = executionPlan.routeGuards;
  if (routeGuards.length > 0) {
    const guardContext: GuardContext = {
      handler,
      requestContext,
    };

    await runGuardChain(routeGuards, guardContext);
  }

  if (requestContext.response.committed) {
    return;
  }

  if (
    contentNegotiation
    && handler.route.produces?.length
    && handler.route.redirect === undefined
    && typeof requestContext.metadata[FRAMEWORK_RESPONSE_VALUE_FINALIZER] !== 'function'
  ) {
    resolveResponsePolicy(handler, requestContext.request, contentNegotiation);
  }

  let conditionalOutcome: Exclude<ConditionalRequestOutcome, 'proceed'> | undefined;
  let conditionalValidators: ResponseValidators | undefined;

  if (conditionalRequest) {
    const resolved = await resolveConditionalRequest(conditionalRequest, {
      handler,
      request: requestContext.request,
    });
    conditionalValidators = resolved.validators;

    if (resolved.outcome !== 'proceed') {
      conditionalOutcome = resolved.outcome;
    }
  }

  if (
    conditionalOutcome !== undefined
    && !requiresResultFirstConditionalClassification(handler, requestContext)
  ) {
    await writeSuccessResponse(
      handler,
      requestContext.request,
      requestContext.response,
      undefined,
      contentNegotiation,
      requestContext,
      conditionalValidators,
      conditionalOutcome,
    );
    return { result: undefined };
  }

  const result = executionPlan.mergedInterceptors.length === 0
    ? await invokeControllerHandler(handler, requestContext, binder, controllerContainer)
    : await runInterceptorChain(
        executionPlan.mergedInterceptors,
        {
          handler,
          requestContext,
        },
        async () => invokeControllerHandler(handler, requestContext, binder, controllerContainer),
      );

  ensureRequestNotAborted(requestContext.request);

  if (conditionalOutcome === undefined && result instanceof SseResponse) {
    await waitForSseResponseCompletion(result);
    ensureRequestNotAborted(requestContext.request);
  } else if (
    conditionalOutcome === undefined
    && isAsyncIterable(result)
    && await writeManagedSseIterable(handler, requestContext, result)
  ) {
    // Managed SSE streams are already committed and closed by writeManagedSseIterable.
  } else if (!requestContext.response.committed) {
    await writeSuccessResponse(
      handler,
      requestContext.request,
      requestContext.response,
      result,
      contentNegotiation,
      requestContext,
      conditionalValidators,
      conditionalOutcome,
    );
  }

  return { result };
}

function requiresResultFirstConditionalClassification(
  handler: HandlerDescriptor,
  requestContext: RequestContext,
): boolean {
  const method = requestContext.request.method.toUpperCase();

  return (method === 'GET' || method === 'HEAD')
    && (
      handler.route.redirect !== undefined
      || typeof requestContext.metadata[FRAMEWORK_RESPONSE_VALUE_FINALIZER] === 'function'
    );
}

function resolveHandlerExecutionPlan(
  handler: HandlerDescriptor,
  executionPlans: WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>,
  options: CreateDispatcherOptions,
): CompiledHandlerExecutionPlan {
  const cached = executionPlans.get(handler);

  if (cached) {
    return cached;
  }

  const compiled = compileHandlerExecutionPlan(handler, options);
  executionPlans.set(handler, compiled);
  return compiled;
}

async function dispatchNativeFastRoute(
  match: HandlerMatch,
  request: FrameworkRequest,
  response: FrameworkResponse,
  options: CreateDispatcherOptions,
  contentNegotiation: ResolvedContentNegotiation | undefined,
  fastPathState: DispatcherFastPathState,
  fastPathRuntimeCache: WeakMap<HandlerDescriptor, FastPathHandlerRuntimeCache>,
): Promise<boolean> {
  if (options.conditionalRequest) {
    return false;
  }

  const eligibility = fastPathState.getEligibility(match.descriptor);

  if (!shouldUseFastPathForRequest(eligibility, request)) {
    return false;
  }

  if (options.fastPathDebugHeaders === true && eligibility && !response.committed) {
    const debugInfo = createPathDebugInfo(eligibility);
    addPathDebugHeader(response.setHeader.bind(response), debugInfo);
  }

  const dispatchRequest = request;
  const dispatchScope = createRootDispatchScope(options.rootContainer);
  let phaseContext: DispatchPhaseContext;
  let containerPromotionOpen = true;
  const requestContext = createDispatchContext(dispatchRequest, response, dispatchScope.container, () => {
    if (!containerPromotionOpen) {
      return phaseContext.dispatchScope.container;
    }

    ensureRequestScope(phaseContext);
    return phaseContext.dispatchScope.container;
  });

  phaseContext = {
    contentNegotiation,
    dispatchScope,
    fastPathState,
    fastPathRuntimeCache,
    handlerExecutionPlans: EMPTY_NATIVE_FAST_PATH_HANDLER_EXECUTION_PLANS,
    observers: EMPTY_NATIVE_FAST_PATH_OBSERVERS,
    options,
    requestContext,
    response,
  };
  phaseContext.matchedHandler = match.descriptor;
  updateRequestParams(phaseContext.requestContext, match.params);

  await runWithRequestContext(phaseContext.requestContext, async () => {
    try {
      ensureRequestNotAborted(phaseContext.requestContext.request);
      const fastPathSuccess = await tryFastPathExecution(match.descriptor, phaseContext);

      if (!fastPathSuccess) {
        throw new Error(`Native route ${match.descriptor.route.method}:${match.descriptor.route.path} was not fast-path executable.`);
      }
    } catch (error: unknown) {
      await handleDispatchError(phaseContext, error);
    } finally {
      if (!phaseContext.dispatchScope.requestScoped) {
        phaseContext.requestContext.container = phaseContext.dispatchScope.container;
      }

      containerPromotionOpen = false;
      if (phaseContext.dispatchScope.requestScoped) {
        try {
          await phaseContext.dispatchScope.container.dispose();
        } catch (error) {
          logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
        }
      }
    }
  });

  return true;
}

interface DispatchPhaseContext {
  contentNegotiation: ResolvedContentNegotiation | undefined;
  dispatchScope: DispatchScope;
  fastPathState: DispatcherFastPathState;
  fastPathRuntimeCache: WeakMap<HandlerDescriptor, FastPathHandlerRuntimeCache>;
  handlerExecutionPlans: WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>;
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

async function notifyRequestSuccess(context: DispatchPhaseContext, result: unknown): Promise<void> {
  await notifyObserversSafely(
    context.observers,
    context.requestContext,
    async (observer, observationContext) => {
      await observer.onRequestSuccess?.(observationContext, result);
    },
    context.options.logger,
    context.matchedHandler,
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

async function tryFastPathExecution(
  handler: HandlerDescriptor,
  context: DispatchPhaseContext,
): Promise<boolean> {
  const eligibility = context.fastPathState.getEligibility(handler);

  if (!eligibility || eligibility.executionPath !== 'fast') {
    return false;
  }

  if (typeof context.dispatchScope.container.resolve !== 'function') {
    ensureRequestScope(context);
  }

  const runtimeCache = resolveFastPathHandlerRuntimeCache(
    handler,
    context.fastPathRuntimeCache,
  );
  const controller = await context.dispatchScope.container.resolve(handler.controllerToken as Token<object>);

  const fastPathResult = await executeFastPath({
    binder: context.options.binder,
    contentNegotiation: context.contentNegotiation,
    controller,
    controllerContainer: context.dispatchScope.container,
    handler,
    method: runtimeCache.method,
    request: context.requestContext.request,
    requestContext: context.requestContext,
    response: context.response,
  });

  if (fastPathResult.executed) {
    return true;
  }

  if (fastPathResult.error) {
    throw fastPathResult.error;
  }

  return false;
}

async function runDispatchPipeline(context: DispatchPhaseContext): Promise<void> {
  ensureRequestNotAborted(context.requestContext.request);
  let handlerResult: { readonly result: unknown } | undefined;

  const appMiddlewareContext: MiddlewareContext = {
    request: context.requestContext.request,
    requestContext: context.requestContext,
    response: context.response,
  };

  const dispatchMatchedRoute = async (): Promise<void> => {
    if (context.response.committed) {
      return;
    }

    const match =
      readFrameworkRequestNativeRouteHandoff(appMiddlewareContext.request)
      ?? matchHandlerOrThrow(context.options.handlerMapping, appMiddlewareContext.request);
    context.matchedHandler = match.descriptor;
    updateRequestParams(context.requestContext, match.params);

    const eligibility = context.fastPathState.getEligibility(match.descriptor);

    if (context.options.fastPathDebugHeaders === true && eligibility && !context.response.committed) {
      const debugInfo = createPathDebugInfo(eligibility);
      addPathDebugHeader(context.response.setHeader.bind(context.response), debugInfo);
    }

    if (!context.options.conditionalRequest && shouldUseFastPathForRequest(eligibility, appMiddlewareContext.request)) {
      const fastPathSuccess = await tryFastPathExecution(match.descriptor, context);

      if (fastPathSuccess) {
        return;
      }
    }

    const executionPlan = resolveHandlerExecutionPlan(match.descriptor, context.handlerExecutionPlans, context.options);

    if (handlerMayRequireRequestScope(executionPlan, appMiddlewareContext.request)) {
      ensureRequestScope(context);
    }

    await notifyHandlerMatched(context, match.descriptor);

    const moduleMiddlewareContext: MiddlewareContext = {
      request: context.requestContext.request,
      requestContext: context.requestContext,
      response: context.response,
    };

    await runMiddlewareChain(match.descriptor.metadata.moduleMiddleware ?? [], moduleMiddlewareContext, async () => {
      handlerResult = await dispatchMatchedHandler(
        match.descriptor,
        executionPlan,
        context.requestContext,
        context.dispatchScope.container,
        context.contentNegotiation,
        context.options.binder,
        context.options.conditionalRequest,
      );
    });
  };

  const appMiddleware = context.options.appMiddleware ?? [];

  if (appMiddleware.length === 0) {
    await dispatchMatchedRoute();
  } else {
    await runMiddlewareChain(appMiddleware, appMiddlewareContext, dispatchMatchedRoute);
  }

  if (handlerResult) {
    await notifyRequestSuccess(context, handlerResult.result);
  }
}

async function handleDispatchError(context: DispatchPhaseContext, error: unknown): Promise<void> {
  const managedSseCleanupFailed = error instanceof ManagedSseCleanupError;
  const managedSseOperationFailed = error instanceof ManagedSseOperationError;
  const dispatchError = managedSseCleanupFailed
    ? error.cleanupError
    : managedSseOperationFailed
      ? error.operationError
      : error;

  if (
    !managedSseCleanupFailed
    && !managedSseOperationFailed
    && (error instanceof RequestAbortedError || isRequestAborted(context.requestContext.request))
  ) {
    return;
  }

  await notifyRequestError(context, dispatchError);

  const handled = await context.options.onError?.(
    dispatchError,
    context.requestContext.request,
    context.response,
    context.requestContext.requestId,
  );

  if (handled) {
    return;
  }

  if (managedSseCleanupFailed) {
    logDispatchFailure(context.options.logger, 'Managed SSE iterator cleanup threw an error.', dispatchError);
  }

  await writeErrorResponse(dispatchError, context.requestContext, {
    ...(context.matchedHandler === undefined ? {} : { handler: context.matchedHandler }),
    ...(context.options.logger === undefined ? {} : { logger: context.options.logger }),
    ...(context.options.errorRepresentation === undefined
      ? {}
      : { representation: context.options.errorRepresentation }),
    ...(isContentNegotiationNotAcceptableException(dispatchError) ? { varyAccept: true } : {}),
  });
}

/**
 * Creates an HTTP dispatcher instance for processing requests.
 *
 * @param options Configuration for routing, middleware, and dependency resolution.
 * @returns A {@link Dispatcher} capable of routing {@link FrameworkRequest}s.
 */
export function createDispatcher(options: CreateDispatcherOptions): Dispatcher {
  const contentNegotiation = resolveContentNegotiation(options.contentNegotiation);
  const observers = options.observers ?? [];
  const appMiddleware = options.appMiddleware ?? [];
  const dispatchStartPlan = compileDispatchStartPlan(observers, appMiddleware);
  const fastPathRuntimeCache = new WeakMap<HandlerDescriptor, FastPathHandlerRuntimeCache>();
  const handlerExecutionPlans = new WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>();
  const adapter = options.adapter ?? 'default';
  const fastPathState = createDispatcherFastPathState(options.handlerMapping.descriptors, options, adapter);

  for (const descriptor of options.handlerMapping.descriptors) {
    handlerExecutionPlans.set(descriptor, compileHandlerExecutionPlan(descriptor, options));
  }

  const dispatcher = {
    describeRoutes() {
      return fastPathState.describeRoutes();
    },
    async dispatchNativeRoute(match: HandlerMatch, request: FrameworkRequest, response: FrameworkResponse): Promise<boolean> {
      return dispatchNativeFastRoute(
        match,
        request,
        response,
        options,
        contentNegotiation,
        fastPathState,
        fastPathRuntimeCache,
      );
    },
    async dispatch(request: FrameworkRequest, response: FrameworkResponse): Promise<void> {
      const dispatchRequest = createDispatchRequest(request);
      const dispatchScope = dispatchStartMayRequireRequestScope(dispatchStartPlan, dispatchRequest)
        ? createRequestDispatchScope(options.rootContainer)
        : createRootDispatchScope(options.rootContainer);
      let phaseContext: DispatchPhaseContext;
      let containerPromotionOpen = true;
      const requestContext = createDispatchContext(dispatchRequest, response, dispatchScope.container, () => {
        if (!containerPromotionOpen) {
          return phaseContext.dispatchScope.container;
        }

        ensureRequestScope(phaseContext);
        return phaseContext.dispatchScope.container;
      });

      phaseContext = {
        contentNegotiation,
        dispatchScope,
        fastPathState,
        fastPathRuntimeCache,
        handlerExecutionPlans,
        observers,
        options,
        requestContext,
        response,
      };

      await runWithRequestContext(phaseContext.requestContext, async () => {
        try {
          if (observers.length > 0) {
            await notifyRequestStart(phaseContext);
          }
          await runDispatchPipeline(phaseContext);
        } catch (error: unknown) {
          await handleDispatchError(phaseContext, error);
        } finally {
          if (observers.length > 0) {
            await notifyRequestFinish(phaseContext);
          }

          if (!phaseContext.dispatchScope.requestScoped) {
            phaseContext.requestContext.container = phaseContext.dispatchScope.container;
          }

          containerPromotionOpen = false;
          if (phaseContext.dispatchScope.requestScoped) {
            try {
              await phaseContext.dispatchScope.container.dispose();
            } catch (error) {
              logDispatchFailure(options.logger, 'Request-scoped container dispose threw an error.', error);
            }
          }
        }
      });
    },
  };

  Object.defineProperty(dispatcher, FAST_PATH_STATS_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: fastPathState.stats,
    writable: false,
  });

  return dispatcher as Dispatcher;
}

/**
 * Reads automatic fast-path eligibility statistics attached to a dispatcher.
 *
 * @param dispatcher Dispatcher returned by {@link createDispatcher}.
 * @returns Fast-path statistics when available.
 */
export function getDispatcherFastPathStats(dispatcher: Dispatcher): FastPathStats | undefined {
  return (dispatcher as unknown as Record<symbol, FastPathStats | undefined>)[FAST_PATH_STATS_SYMBOL];
}

export { formatFastPathStats } from './fast-path/index.js';
