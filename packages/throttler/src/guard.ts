import { Inject, metadataSymbol } from '@konekti/core';
import { TooManyRequestsException, type Guard, type GuardContext, type MiddlewareContext } from '@konekti/http';

import {
  getClassSkipThrottleMetadata,
  getClassThrottleMetadata,
  getSkipThrottleMetadata,
  getThrottleMetadata,
} from './decorators.js';
import { createMemoryThrottlerStore } from './store.js';
import { THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions, ThrottlerStore } from './types.js';

type MetadataBag = Record<PropertyKey, unknown>;

const functionIdentityMap = new WeakMap<Function, number>();
let nextFunctionIdentity = 1;

function getClassMetadataBag(target: object): MetadataBag | undefined {
  return (target as Record<symbol, MetadataBag | undefined>)[metadataSymbol];
}

function getMethodMetadataBag(controllerToken: Function, methodName: string): MetadataBag | undefined {
  const classBag = getClassMetadataBag(controllerToken);

  if (!classBag) {
    return undefined;
  }

  const routeMap = classBag[Symbol.for('konekti.standard.route')] as Map<string | symbol, MetadataBag> | undefined;

  return routeMap?.get(methodName);
}

function defaultKeyGenerator(ctx: MiddlewareContext): string {
  const raw = ctx.request.raw as { socket?: { remoteAddress?: string } } | undefined;
  return raw?.socket?.remoteAddress ?? 'unknown';
}

function buildStoreKey(handlerKey: string, clientKey: string): string {
  return `throttler:${handlerKey}:${clientKey}`;
}

function getFunctionIdentity(value: Function): number {
  const existing = functionIdentityMap.get(value);

  if (existing !== undefined) {
    return existing;
  }

  const assigned = nextFunctionIdentity;
  nextFunctionIdentity += 1;
  functionIdentityMap.set(value, assigned);

  return assigned;
}

function buildHandlerKey(handler: GuardContext['handler']): string {
  const version = handler.route.version ?? handler.metadata.effectiveVersion ?? 'unversioned';
  const moduleIdentity = handler.metadata.moduleType
    ? `module:${getFunctionIdentity(handler.metadata.moduleType)}`
    : 'module:none';
  const controllerIdentity = `controller:${getFunctionIdentity(handler.controllerToken)}`;

  return [
    `method:${handler.route.method}`,
    `path:${encodeURIComponent(handler.route.path)}`,
    `version:${encodeURIComponent(version)}`,
    `handler:${encodeURIComponent(handler.methodName)}`,
    moduleIdentity,
    controllerIdentity,
  ].join('|');
}

@Inject([THROTTLER_OPTIONS])
export class ThrottlerGuard implements Guard {
  private readonly store: ThrottlerStore;

  constructor(private readonly options: ThrottlerModuleOptions) {
    this.store = options.store ?? createMemoryThrottlerStore();
  }

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

    const ttlSeconds = methodThrottle?.ttl ?? classThrottle?.ttl ?? this.options.ttl;
    const limit = methodThrottle?.limit ?? classThrottle?.limit ?? this.options.limit;

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
    const entry = await this.store.consume(storeKey, {
      now,
      ttlSeconds,
    });

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      requestContext.response.setHeader('Retry-After', String(retryAfter));
      throw new TooManyRequestsException('Too Many Requests', { meta: { retryAfter } });
    }

    return true;
  }
}
