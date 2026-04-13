import { Inject } from '@fluojs/core';
import { metadataSymbol } from '@fluojs/core/internal';
import { TooManyRequestsException, type Guard, type GuardContext, type MiddlewareContext } from '@fluojs/http';
import { resolveClientIdentity } from '@fluojs/http/internal';

import {
  getClassSkipThrottleMetadata,
  getClassThrottleMetadata,
  getSkipThrottleMetadata,
  getThrottleMetadata,
  throttleRouteMetadataKey,
} from './decorators.js';
import { createMemoryThrottlerStore } from './store.js';
import { THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions, ThrottlerStore } from './types.js';
import { validateThrottleOptions, validateThrottlerModuleOptions, validateThrottlerStoreEntry } from './validation.js';

type MetadataBag = Record<PropertyKey, unknown>;

function getClassMetadataBag(target: object): MetadataBag | undefined {
  return (target as Record<symbol, MetadataBag | undefined>)[metadataSymbol];
}

function getMethodMetadataBag(controllerToken: Function, methodName: string): MetadataBag | undefined {
  const classBag = getClassMetadataBag(controllerToken);

  if (!classBag) {
    return undefined;
  }

  const routeMap = classBag[throttleRouteMetadataKey] as Map<string | symbol, MetadataBag> | undefined;

  return routeMap?.get(methodName);
}

function defaultKeyGenerator(ctx: MiddlewareContext): string {
  return resolveClientIdentity(ctx.request);
}

function buildStoreKey(handlerKey: string, clientKey: string): string {
  const encodedHandlerKey = encodeURIComponent(handlerKey);
  const encodedClientKey = encodeURIComponent(clientKey);

  return `throttler:${encodedHandlerKey}:${encodedClientKey}`;
}

function buildHandlerKey(handler: GuardContext['handler']): string {
  const version = handler.route.version ?? handler.metadata.effectiveVersion ?? 'unversioned';

  return [
    `method:${handler.route.method}`,
    `path:${encodeURIComponent(handler.route.path)}`,
    `version:${encodeURIComponent(version)}`,
    `handler:${encodeURIComponent(handler.methodName)}`,
  ].join('|');
}

/**
 * Guard that enforces module-, class-, and method-level throttling policies.
 */
@Inject(THROTTLER_OPTIONS)
export class ThrottlerGuard implements Guard {
  private readonly store: ThrottlerStore;

  constructor(private readonly options: ThrottlerModuleOptions) {
    validateThrottlerModuleOptions(options);
    this.store = options.store ?? createMemoryThrottlerStore();
  }

  /**
   * Evaluate whether the current request is still within its allowed rate-limit window.
   *
   * @param context Guard execution context for the current handler invocation.
   * @returns `true` when the request is allowed to proceed.
   * @throws TooManyRequestsException When the request exceeds the configured limit.
   */
  async canActivate(context: GuardContext): Promise<boolean> {
    const { handler, requestContext } = context;

    const classBag = getClassMetadataBag(handler.controllerToken);
    const methodBag = getMethodMetadataBag(handler.controllerToken, handler.methodName);

    const classSkip = classBag ? getClassSkipThrottleMetadata(classBag) : false;
    const methodSkip = methodBag ? getSkipThrottleMetadata(methodBag) : false;

    if (classSkip || methodSkip) {
      return true;
    }

    const methodThrottle = methodBag ? getThrottleMetadata(methodBag) : undefined;
    const classThrottle = classBag ? getClassThrottleMetadata(classBag) : undefined;

    const resolvedThrottle = validateThrottleOptions({
      limit: methodThrottle?.limit ?? classThrottle?.limit ?? this.options.limit,
      ttl: methodThrottle?.ttl ?? classThrottle?.ttl ?? this.options.ttl,
    });
    const ttlSeconds = resolvedThrottle.ttl;
    const limit = resolvedThrottle.limit;

    const middlewareCtx: MiddlewareContext = {
      request: requestContext.request,
      requestContext,
      response: requestContext.response,
    };

    const clientKey = this.options.keyGenerator
      ? this.options.keyGenerator(middlewareCtx)
      : defaultKeyGenerator(middlewareCtx);

    const handlerKey = buildHandlerKey(handler);
    const storeKey = buildStoreKey(handlerKey, clientKey);
    const now = Date.now();
    const entry = validateThrottlerStoreEntry(await this.store.consume(storeKey, {
      now,
      ttlSeconds,
    }));

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      requestContext.response.setHeader('Retry-After', String(retryAfter));
      throw new TooManyRequestsException('Too Many Requests', { meta: { retryAfter } });
    }

    return true;
  }
}
