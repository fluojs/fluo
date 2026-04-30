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
import { readFrameworkRequestNativeRouteHandoff } from './native-route-handoff.js';

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
  /** Request-scope optimization hints supplied by runtime bootstrap. */
  requestScope?: {
    /** Global DTO converters used by the default binder. */
    converterDefinitions?: readonly ConverterLike[];
  };
  logger?: DispatcherLogger;
  /** Root DI container for creating request scopes. */
  rootContainer: Container;
}

interface DispatchScope {
  container: RequestScopeContainer;
  requestScoped: boolean;
}

interface RequestScopeInspector {
  hasRequestScopedDependency(token: Token): boolean;
}

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

function cloneHandlerDescriptor(descriptor: HandlerDescriptor): HandlerDescriptor {
  return {
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

  let activeContainer = container;
  Object.defineProperty(context, 'container', {
    configurable: true,
    enumerable: true,
    get() {
      activeContainer = promoteOnContainerAccess();
      return activeContainer;
    },
    set(value: RequestScopeContainer) {
      activeContainer = value;
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

interface DispatchPhaseContext {
  contentNegotiation: ResolvedContentNegotiation | undefined;
  dispatchScope: DispatchScope;
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

    const match =
      readFrameworkRequestNativeRouteHandoff(appMiddlewareContext.request)
      ?? matchHandlerOrThrow(context.options.handlerMapping, appMiddlewareContext.request);
    context.matchedHandler = match.descriptor;
    const executionPlan = resolveHandlerExecutionPlan(match.descriptor, context.handlerExecutionPlans, context.options);

    if (handlerMayRequireRequestScope(executionPlan, appMiddlewareContext.request)) {
      ensureRequestScope(context);
    }

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
        executionPlan,
        context.requestContext,
        context.dispatchScope.container,
        context.observers,
        context.contentNegotiation,
        context.options.binder,
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
  const observers = options.observers ?? [];
  const appMiddleware = options.appMiddleware ?? [];
  const dispatchStartPlan = compileDispatchStartPlan(observers, appMiddleware);
  const handlerExecutionPlans = new WeakMap<HandlerDescriptor, CompiledHandlerExecutionPlan>();

  for (const descriptor of options.handlerMapping.descriptors) {
    handlerExecutionPlans.set(descriptor, compileHandlerExecutionPlan(descriptor, options));
  }

  const dispatcher = {
    describeRoutes() {
      return options.handlerMapping.descriptors.map((descriptor) => cloneHandlerDescriptor(descriptor));
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
        handlerExecutionPlans,
        observers,
        options,
        requestContext,
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

  return dispatcher as Dispatcher;
}
