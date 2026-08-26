import type { Container } from '@fluojs/di';

import { getCompiledDtoBindingPlan } from '../../adapters/dto-binding-plan.js';
import type {
  Binder,
  HandlerDescriptor,
  MiddlewareLike,
} from '../../types.js';
import type { CreateDispatcherOptions } from '../dispatcher.js';
import { type FastPathEligibility, FAST_PATH_ELIGIBILITY_SYMBOL } from './eligibility.js';

interface RequestScopeInspector {
  hasRequestScopedDependency(token: unknown): boolean;
}

interface CompiledEligibilityPlan {
  eligibility: FastPathEligibility;
  isEligible: boolean;
}

function hasRequestScopeInspector(container: unknown): container is RequestScopeInspector {
  return (
    typeof container === 'object'
    && container !== null
    && 'hasRequestScopedDependency' in container
    && typeof container.hasRequestScopedDependency === 'function'
  );
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

function determineRequestScopeRequirement(
  handler: HandlerDescriptor,
  options: CreateDispatcherOptions,
): boolean {
  if (handler.route.guards && handler.route.guards.length > 0) {
    return true;
  }
  if (handler.route.interceptors && handler.route.interceptors.length > 0) {
    return true;
  }
  if (handler.metadata.moduleMiddleware && handler.metadata.moduleMiddleware.length > 0) {
    return true;
  }
  if (requestDtoMayRequireRequestScope(handler, options)) {
    return true;
  }
  if (hasRequestScopeInspector(options.rootContainer)) {
    return options.rootContainer.hasRequestScopedDependency(handler.controllerToken);
  }
  return true;
}

function determineMiddlewareRequirement(
  handler: HandlerDescriptor,
  appMiddleware: readonly MiddlewareLike[],
): boolean {
  if (appMiddleware.length > 0) {
    return true;
  }
  const moduleMiddleware = handler.metadata.moduleMiddleware;
  return moduleMiddleware !== undefined && moduleMiddleware.length > 0;
}

/**
 * Compiles the conservative fast-path eligibility decision for one handler.
 *
 * @param handler Handler descriptor being analyzed.
 * @param options Dispatcher options that can introduce full-path requirements.
 * @param adapter Human-readable adapter label used in observability metadata.
 * @returns The compiled eligibility metadata and boolean eligibility flag.
 */
export function compileFastPathEligibility(
  handler: HandlerDescriptor,
  options: CreateDispatcherOptions,
  adapter: string,
): CompiledEligibilityPlan {
  const routeId = `${handler.route.method}:${handler.route.path}`;
  const hasGuard = (handler.route.guards?.length ?? 0) > 0;
  const hasInterceptor = (handler.route.interceptors?.length ?? 0) > 0
    || (options.interceptors?.length ?? 0) > 0;
  const hasPipe = handler.route.request !== undefined;
  const hasRequestScopedDI = determineRequestScopeRequirement(handler, options);
  const hasMiddleware = determineMiddlewareRequirement(handler, options.appMiddleware ?? []);
  const hasContentNegotiation = options.contentNegotiation?.formatters !== undefined && options.contentNegotiation.formatters.length > 0;
  const isSseRoute = handler.route.produces?.some((mediaType) => mediaType.toLowerCase().startsWith('text/event-stream')) === true;

  const eligibilityBase = {
    adapter,
    hasAdapterPluginInfluence: false,
    hasCustomBodyParser: options.binder !== undefined,
    hasCustomErrorFilter: options.onError !== undefined,
    hasGlobalHook: (options.observers?.length ?? 0) > 0,
    hasGuard,
    hasInterceptor,
    hasMiddleware,
    hasPipe,
    hasRequestScopedDI,
    routeId,
  } satisfies Omit<FastPathEligibility, 'executionPath' | 'fallbackReason'>;

  const blockingReasons: string[] = [];

  if (eligibilityBase.hasGuard) {
    blockingReasons.push('guards');
  }
  if (eligibilityBase.hasInterceptor) {
    blockingReasons.push('interceptors');
  }
  if (eligibilityBase.hasRequestScopedDI) {
    blockingReasons.push('request-scoped DI');
  }
  if (eligibilityBase.hasMiddleware) {
    blockingReasons.push('middleware');
  }
  if (eligibilityBase.hasGlobalHook) {
    blockingReasons.push('request observers');
  }
  if (eligibilityBase.hasCustomErrorFilter) {
    blockingReasons.push('custom error filter');
  }
  if (eligibilityBase.hasCustomBodyParser) {
    blockingReasons.push('custom binder');
  }
  if (hasContentNegotiation) {
    blockingReasons.push('content negotiation');
  }
  if (options.conditionalRequests !== undefined) {
    blockingReasons.push('conditional requests');
  }
  if (isSseRoute) {
    blockingReasons.push('SSE streaming');
  }

  const isEligible = blockingReasons.length === 0;

  const eligibility: FastPathEligibility = Object.freeze({
    ...eligibilityBase,
    executionPath: isEligible ? 'fast' : 'full',
    ...(isEligible
      ? {}
      : { fallbackReason: `Full path required due to: ${blockingReasons.join(', ')}` }),
  });

  return { eligibility, isEligible };
}

/**
 * Reads fast-path eligibility metadata attached to a handler descriptor.
 *
 * @param handler Handler descriptor previously analyzed by the dispatcher.
 * @returns The attached eligibility metadata, when present.
 */
export function getHandlerFastPathEligibility(
  handler: HandlerDescriptor,
): FastPathEligibility | undefined {
  return (handler as unknown as Record<symbol, FastPathEligibility | undefined>)[
    FAST_PATH_ELIGIBILITY_SYMBOL
  ];
}

/**
 * Attaches fast-path eligibility metadata to a handler descriptor.
 *
 * @param handler Handler descriptor to annotate.
 * @param eligibility Eligibility metadata to expose through dispatcher observability.
 */
export function setHandlerFastPathEligibility(
  handler: HandlerDescriptor,
  eligibility: FastPathEligibility,
): void {
  Object.defineProperty(handler, FAST_PATH_ELIGIBILITY_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...eligibility }),
    writable: false,
  });
}

/** Options shared by fast-path executor helpers. */
export interface FastPathExecutorOptions {
  binder?: Binder;
  rootContainer: Container;
}

/** Result returned after attempting fast-path handler execution. */
export interface FastPathExecutionResult {
  executed: boolean;
  result?: unknown;
  error?: unknown;
}
