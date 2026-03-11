import { AsyncLocalStorage } from 'node:async_hooks';

import { KonektiError } from '@konekti/core';

import type { RequestContext } from './types';

const requestContextStore = new AsyncLocalStorage<RequestContext>();

/**
 * Runs a callback inside a request-scoped ALS context.
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStore.run(context, callback);
}

/**
 * Returns the current request context when called inside an active request scope.
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
 * Creates a defensive request-context object suitable for ALS storage.
 */
export function createRequestContext(context: RequestContext): RequestContext {
  return {
    ...context,
    metadata: { ...context.metadata },
  };
}
