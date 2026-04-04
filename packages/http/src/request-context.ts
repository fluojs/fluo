import { AsyncLocalStorage } from 'node:async_hooks';

import { KonektiError } from '@konekti/core';

import type { ContextKey, RequestContext } from './types.js';

const requestContextStore = new AsyncLocalStorage<RequestContext>();

/**
 * Runs a callback inside the request-scoped AsyncLocalStorage context.
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStore.run(context, callback);
}

/**
 * Returns the request context active in the current async scope, if available.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

/**
 * Returns the current request context or throws when no request scope is active.
 */
export function assertRequestContext(): RequestContext {
  const context = getCurrentRequestContext();

  if (!context) {
    throw new KonektiError('RequestContext is not available in the current async scope.', {
      code: 'REQUEST_CONTEXT_MISSING',
    });
  }

  return context;
}

/**
 * Creates a defensive clone of a request context for AsyncLocalStorage storage.
 */
export function createRequestContext(context: RequestContext): RequestContext {
  return {
    ...context,
    metadata: { ...context.metadata },
  };
}

/**
 * Creates a typed key for `RequestContext.metadata`.
 */
export function createContextKey<T>(description: string): ContextKey<T> {
  return {
    description,
    id: Symbol(description),
  };
}

/**
 * Reads a typed value from request-context metadata.
 */
export function getContextValue<T>(context: RequestContext, key: ContextKey<T>): T | undefined {
  return context.metadata[key.id] as T | undefined;
}

/**
 * Writes a typed value into request-context metadata.
 */
export function setContextValue<T>(context: RequestContext, key: ContextKey<T>, value: T): void {
  context.metadata[key.id] = value;
}
