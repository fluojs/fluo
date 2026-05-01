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

  const eligibility: FastPathEligibility = {
    adapter,
    executionPath: 'full',
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
  };

  const blockingReasons: string[] = [];

  if (eligibility.hasGuard) {
    blockingReasons.push('guards');
  }
  if (eligibility.hasInterceptor) {
    blockingReasons.push('interceptors');
  }
  if (eligibility.hasRequestScopedDI) {
    blockingReasons.push('request-scoped DI');
  }
  if (eligibility.hasMiddleware) {
    blockingReasons.push('middleware');
  }
  if (eligibility.hasGlobalHook) {
    blockingReasons.push('request observers');
  }
  if (eligibility.hasCustomErrorFilter) {
    blockingReasons.push('custom error filter');
  }
  if (eligibility.hasCustomBodyParser) {
    blockingReasons.push('custom binder');
  }
  if (hasContentNegotiation) {
    blockingReasons.push('content negotiation');
  }

  const isEligible = blockingReasons.length === 0;

  if (!isEligible) {
    eligibility.fallbackReason = `Full path required due to: ${blockingReasons.join(', ')}`;
  } else {
    eligibility.executionPath = 'fast';
  }

  return { eligibility, isEligible };
}

export function getHandlerFastPathEligibility(
  handler: HandlerDescriptor,
): FastPathEligibility | undefined {
  return (handler as unknown as Record<symbol, FastPathEligibility | undefined>)[
    FAST_PATH_ELIGIBILITY_SYMBOL
  ];
}

export function setHandlerFastPathEligibility(
  handler: HandlerDescriptor,
  eligibility: FastPathEligibility,
): void {
  (handler as unknown as Record<symbol, FastPathEligibility>)[FAST_PATH_ELIGIBILITY_SYMBOL] =
    eligibility;
}

export interface FastPathExecutorOptions {
  binder?: Binder;
  rootContainer: Container;
}

export interface FastPathExecutionResult {
  executed: boolean;
  result?: unknown;
  error?: unknown;
}
