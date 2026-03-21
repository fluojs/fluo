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

    const handlerKey = `${handler.controllerToken.name}.${handler.methodName}`;
    const storeKey = buildStoreKey(handlerKey, clientKey);
    const now = Date.now();

    await this.store.evict(now);

    const entry = await this.store.get(storeKey);

    if (!entry || now >= entry.resetAt) {
      const resetAt = now + ttlSeconds * 1000;
      await this.store.set(storeKey, { count: 1, resetAt });
      return true;
    }

    if (entry.count >= limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      requestContext.response.setHeader('Retry-After', String(retryAfter));
      throw new TooManyRequestsException('Too Many Requests', { meta: { retryAfter } });
    }

    await this.store.increment(storeKey);
    return true;
  }
}
