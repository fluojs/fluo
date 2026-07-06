import { Inject } from '@fluojs/core';
import { getStandardMetadataBag } from '@fluojs/core/internal';
import { type Guard, type GuardContext, type MiddlewareContext, TooManyRequestsException } from '@fluojs/http';
import { resolveClientIdentity } from '@fluojs/http/internal';

import {
  getClassSkipThrottleMetadata,
  getClassThrottleMetadata,
  getSkipThrottleMetadata,
  getThrottleMetadata,
  throttleRouteMetadataKey,
} from './decorators.js';
import { createMemoryThrottlerStore } from './store.js';
import { throttlerRetryAfterMsSymbol } from './store-internals.js';
import { THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions, ThrottlerStore, ThrottlerStoreEntry } from './types.js';
import { validateThrottleOptions, validateThrottlerModuleOptions, validateThrottlerStoreEntry } from './validation.js';

type MetadataBag = Record<PropertyKey, unknown>;

interface ResolvedHandlerPolicy {
  readonly encodedHandlerKey: string;
  readonly limit: number;
  readonly skip: boolean;
  readonly ttlSeconds: number;
}

function getClassMetadataBag(target: object): MetadataBag | undefined {
  return getStandardMetadataBag(target);
}

function getMethodMetadataBag(controllerToken: Function, methodName: string): MetadataBag | undefined {
  const classBag = getClassMetadataBag(controllerToken);

  if (!classBag) {
    return undefined;
  }

  const routeMap = classBag[throttleRouteMetadataKey] as Map<string | symbol, MetadataBag> | undefined;

  return routeMap?.get(methodName);
}

function defaultKeyGenerator(ctx: MiddlewareContext, trustProxyHeaders: boolean): string {
  return resolveClientIdentity(ctx.request, { trustProxyHeaders });
}

function buildStoreKey(encodedHandlerKey: string, clientKey: string): string {
  const encodedClientKey = encodeURIComponent(clientKey);

  return `throttler:${encodedHandlerKey}:${encodedClientKey}`;
}

function buildHandlerKey(handler: GuardContext['handler']): string {
  const version = handler.route.version ?? handler.metadata.effectiveVersion ?? 'unversioned';
  const moduleName = handler.metadata.moduleType?.name || '<moduleless>';
  const controllerName = handler.controllerToken.name || '<anonymous-controller>';

  return [
    `module:${encodeURIComponent(moduleName)}`,
    `controller:${encodeURIComponent(controllerName)}`,
    `method:${handler.route.method}`,
    `path:${encodeURIComponent(handler.route.path)}`,
    `version:${encodeURIComponent(version)}`,
    `handler:${encodeURIComponent(handler.methodName)}`,
  ].join('|');
}

function resolveRetryAfterSeconds(entry: ThrottlerStoreEntry, now: number): number {
  const retryAfterMs = entry.retryAfterMs ??
    (entry as ThrottlerStoreEntry & { [throttlerRetryAfterMsSymbol]?: number })[throttlerRetryAfterMsSymbol];

  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs)) {
    return Math.max(1, Math.ceil(retryAfterMs / 1000));
  }

  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

/**
 * Guard that enforces module-, class-, and method-level throttling policies.
 */
@Inject(THROTTLER_OPTIONS)
export class ThrottlerGuard implements Guard {
  private readonly options: ThrottlerModuleOptions;

  private readonly resolvedPolicies = new WeakMap<Function, Map<string, ResolvedHandlerPolicy>>();

  private readonly store: ThrottlerStore;

  constructor(options: ThrottlerModuleOptions) {
    const validatedOptions = validateThrottlerModuleOptions(options);

    this.options = validatedOptions;
    this.store = validatedOptions.store ?? createMemoryThrottlerStore();
  }

  private getResolvedPolicy(handler: GuardContext['handler']): ResolvedHandlerPolicy {
    let controllerPolicies = this.resolvedPolicies.get(handler.controllerToken);

    if (!controllerPolicies) {
      controllerPolicies = new Map<string, ResolvedHandlerPolicy>();
      this.resolvedPolicies.set(handler.controllerToken, controllerPolicies);
    }

    const version = handler.route.version ?? handler.metadata.effectiveVersion ?? 'unversioned';
    const cacheKey = [
      handler.metadata.moduleType?.name || '<moduleless>',
      handler.controllerToken.name || '<anonymous-controller>',
      handler.methodName,
      handler.route.method,
      handler.route.path,
      version,
    ].join('\u0000');
    const cachedPolicy = controllerPolicies.get(cacheKey);

    if (cachedPolicy) {
      return cachedPolicy;
    }

    const classBag = getClassMetadataBag(handler.controllerToken);
    const methodBag = getMethodMetadataBag(handler.controllerToken, handler.methodName);

    const skip = (classBag ? getClassSkipThrottleMetadata(classBag) : false) ||
      (methodBag ? getSkipThrottleMetadata(methodBag) : false);
    const methodThrottle = methodBag ? getThrottleMetadata(methodBag) : undefined;
    const classThrottle = classBag ? getClassThrottleMetadata(classBag) : undefined;
    const resolvedThrottle = validateThrottleOptions({
      limit: methodThrottle?.limit ?? classThrottle?.limit ?? this.options.limit,
      ttl: methodThrottle?.ttl ?? classThrottle?.ttl ?? this.options.ttl,
    });
    const policy: ResolvedHandlerPolicy = {
      encodedHandlerKey: encodeURIComponent(buildHandlerKey(handler)),
      limit: resolvedThrottle.limit,
      skip,
      ttlSeconds: resolvedThrottle.ttl,
    };

    controllerPolicies.set(cacheKey, policy);

    return policy;
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
    const policy = this.getResolvedPolicy(handler);

    if (policy.skip) {
      return true;
    }

    const middlewareCtx: MiddlewareContext = {
      request: requestContext.request,
      requestContext,
      response: requestContext.response,
    };

    const clientKey = this.options.keyGenerator
      ? this.options.keyGenerator(middlewareCtx)
      : defaultKeyGenerator(middlewareCtx, this.options.trustProxyHeaders ?? false);

    const storeKey = buildStoreKey(policy.encodedHandlerKey, clientKey);
    const now = Date.now();
    const rawEntry = await this.store.consume(storeKey, {
      now,
      ttlSeconds: policy.ttlSeconds,
    });
    const entry = validateThrottlerStoreEntry(rawEntry);

    if (entry.count > policy.limit) {
      const retryAfter = resolveRetryAfterSeconds(entry, now);
      requestContext.response.setHeader('Retry-After', String(retryAfter));
      throw new TooManyRequestsException('Too Many Requests', { meta: { retryAfter } });
    }

    return true;
  }
}
