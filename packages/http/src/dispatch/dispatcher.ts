import type { Token } from '@fluojs/core';
import type { Container, RequestScopeContainer } from '@fluojs/di';
import { getCompiledDtoBindingPlan } from '../adapters/dto-binding-plan.js';
import { createRequestContext, runWithRequestContext } from '../context/request-context.js';
import { SseResponse } from '../context/sse.js';
import { RequestAbortedError } from '../errors.js';
import { runGuardChain } from '../guards.js';
import { runInterceptorChain } from '../interceptors.js';
import { isMiddlewareRouteConfig, matchRoutePattern, runMiddlewareChain } from '../middleware/middleware.js';
import type {
  Binder,
  ContentNegotiationOptions,
  ConverterLike,
  Dispatcher,
  DispatcherLogger,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  GuardLike,
  HandlerDescriptor,
  HandlerMapping,
  HandlerMatch,
  InterceptorLike,
  MiddlewareContext,
  MiddlewareLike,
  RequestContext,
  RequestObservationContext,
  RequestObserver,
  RequestObserverLike,
} from '../types.js';
import { invokeControllerHandler } from './dispatch-handler-policy.js';
import { type ResolvedContentNegotiation, resolveContentNegotiation, writeErrorResponse, writeSuccessResponse } from './dispatch-response-policy.js';
import { matchHandlerOrThrow, updateRequestParams } from './dispatch-routing-policy.js';
import { attachFrameworkRequestNativeRouteHandoff, readFrameworkRequestNativeRouteHandoff } from './native-route-handoff.js';
import {
  compileFastPathEligibility,
  getHandlerFastPathEligibility,
  setHandlerFastPathEligibility,
  type FastPathEligibility,
  type FastPathStats,
  FAST_PATH_STATS_SYMBOL,
  addPathDebugHeader,
  createFastPathStats,
  createPathDebugInfo,
  executeFastPath,
  shouldUseFastPathForRequest,
} from './fast-path/index.js';

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

interface CompiledMiddlewareScopePlan {
  alwaysRequiresRequestScope: boolean;
  conditionalDefinitions: MiddlewareLike[];
}

interface CompiledDispatchStartPlan {
  requestScope: CompiledMiddlewareScopePlan;
  requiresRequestScope: boolean;
}

interface CompiledHandlerExecutionPlan {
  mergedInterceptors: InterceptorLike[];
  requestScope: CompiledMiddlewareScopePlan;
  requiresRequestScope: boolean;
  routeGuards: GuardLike[];
}

interface FastPathHandlerRuntimeCache {
  controller?: object;
  controllerPromise?: Promise<object>;
  method?: (this: object, input: unknown, requestContext: RequestContext) => unknown;
}

const EMPTY_NATIVE_FAST_PATH_HANDLER_EXECUTION_PLANS = new WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>();
const EMPTY_NATIVE_FAST_PATH_OBSERVERS: RequestObserverLike[] = [];

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
    method: request.method,
    params: { ...request.params },
    path: request.path,
    raw: request.raw,
    rawBody: request.rawBody,
    requestId: request.requestId,
    signal: request.signal,
    url: request.url,
  };

  const nativeRouteHandoff = readFrameworkRequestNativeRouteHandoff(request);

  const files = (request as FrameworkRequestWithFiles).files;

  if (files !== undefined) {
    (dispatchRequest as FrameworkRequestWithFiles).files = files;
  }

  return nativeRouteHandoff
    ? attachFrameworkRequestNativeRouteHandoff(dispatchRequest, nativeRouteHandoff)
    : dispatchRequest;
}

function cloneHandlerDescriptor(descriptor: HandlerDescriptor): HandlerDescriptor {
  const cloned = {
    ...descriptor,
    metadata: {
      ...descriptor.metadata,
      moduleMiddleware: [...descriptor.metadata.moduleMiddleware],
      pathParams: [...descriptor.metadata.pathParams],
    },
    route: {
      ...descriptor.route,
      guards: descriptor.route.guards ? [...descriptor.route.guards] : undefined,
      headers: descriptor.route.headers?.map((header) => ({ ...header })),
      interceptors: descriptor.route.interceptors ? [...descriptor.route.interceptors] : undefined,
      produces: descriptor.route.produces ? [...descriptor.route.produces] : undefined,
      redirect: descriptor.route.redirect ? { ...descriptor.route.redirect } : undefined,
    },
  };

  const eligibility = getHandlerFastPathEligibility(descriptor);

  if (eligibility) {
    setHandlerFastPathEligibility(cloned, eligibility);
  }

  return cloned;
}

function readRequestId(request: FrameworkRequest): string | undefined {
  if (request.requestId) {
    return request.requestId;
  }

  const raw = request.headers['x-request-id'] ?? request.headers['X-Request-Id'];
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
      wrappedContainer = {
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
  definitions: readonly MiddlewareLike[],
  request: FrameworkRequest,
): boolean {
  return definitions.some((definition) => {
    if (!isMiddlewareRouteConfig(definition)) {
      return true;
    }

    return definition.routes.length === 0 || definition.routes.some((route) => matchRoutePattern(route, request.path));
  });
}

function compileMiddlewareScopePlan(definitions: readonly MiddlewareLike[]): CompiledMiddlewareScopePlan {
  const conditionalDefinitions: MiddlewareLike[] = [];

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

function isRequestAborted(request: FrameworkRequest): boolean {
  return request.isAborted?.() ?? request.signal?.aborted === true;
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

function resolveFastPathController(
  handler: HandlerDescriptor,
  controllerContainer: RequestScopeContainer,
  runtimeCache: FastPathHandlerRuntimeCache,
): object | Promise<object> {
  if (runtimeCache.controller) {
    return runtimeCache.controller;
  }

  runtimeCache.controllerPromise ??= controllerContainer.resolve(handler.controllerToken as Token<object>).then((controller) => {
    runtimeCache.controller = controller;
    return controller;
  });
  return runtimeCache.controllerPromise;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
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
  observers: RequestObserverLike[],
  contentNegotiation: ResolvedContentNegotiation | undefined,
  binder: Binder | undefined,
  logger: DispatcherLogger | undefined,
): Promise<void> {
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
  fastPathRuntimeCache: WeakMap<HandlerDescriptor, FastPathHandlerRuntimeCache>,
): Promise<boolean> {
  const eligibility = getHandlerFastPathEligibility(match.descriptor);

  if (!shouldUseFastPathForRequest(eligibility, request)) {
    return false;
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
  const eligibility = getHandlerFastPathEligibility(handler);

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
  const controllerOrPromise = resolveFastPathController(handler, context.dispatchScope.container, runtimeCache);
  const controller = isPromiseLike(controllerOrPromise) ? await controllerOrPromise : controllerOrPromise;

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

    const eligibility = getHandlerFastPathEligibility(match.descriptor);

    if (context.options.fastPathDebugHeaders === true && eligibility && !context.response.committed) {
      const debugInfo = createPathDebugInfo(eligibility);
      addPathDebugHeader(context.response.setHeader.bind(context.response), debugInfo);
    }

    if (shouldUseFastPathForRequest(eligibility, appMiddlewareContext.request)) {
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
      await dispatchMatchedHandler(
        match.descriptor,
        executionPlan,
        context.requestContext,
        context.dispatchScope.container,
        context.observers,
        context.contentNegotiation,
        context.options.binder,
        context.options.logger,
      );
    });
  };

  const appMiddleware = context.options.appMiddleware ?? [];

  if (appMiddleware.length === 0) {
    await dispatchMatchedRoute();
    return;
  }

  await runMiddlewareChain(appMiddleware, appMiddlewareContext, dispatchMatchedRoute);
}

async function handleDispatchError(context: DispatchPhaseContext, error: unknown): Promise<void> {
      if (error instanceof RequestAbortedError || isRequestAborted(context.requestContext.request)) {
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
  const observers = options.observers ?? [];
  const appMiddleware = options.appMiddleware ?? [];
  const dispatchStartPlan = compileDispatchStartPlan(observers, appMiddleware);
  const fastPathRuntimeCache = new WeakMap<HandlerDescriptor, FastPathHandlerRuntimeCache>();
  const handlerExecutionPlans = new WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>();
  const adapter = options.adapter ?? 'default';
  const fastPathEligibilities: FastPathEligibility[] = [];

  for (const descriptor of options.handlerMapping.descriptors) {
    handlerExecutionPlans.set(descriptor, compileHandlerExecutionPlan(descriptor, options));

    const { eligibility } = compileFastPathEligibility(descriptor, options, adapter);
    setHandlerFastPathEligibility(descriptor, eligibility);
    fastPathEligibilities.push(eligibility);
  }

  const fastPathStats = createFastPathStats(fastPathEligibilities);

  const dispatcher = {
    describeRoutes() {
      return options.handlerMapping.descriptors.map((descriptor) => cloneHandlerDescriptor(descriptor));
    },
    async dispatchNativeRoute(match: HandlerMatch, request: FrameworkRequest, response: FrameworkResponse): Promise<boolean> {
      return dispatchNativeFastRoute(match, request, response, options, contentNegotiation, fastPathRuntimeCache);
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

  (dispatcher as unknown as Record<symbol, FastPathStats>)[FAST_PATH_STATS_SYMBOL] = fastPathStats;

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
