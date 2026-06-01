import { FluoError } from '@fluojs/core';

import type { ContextKey, RequestContext } from '../types.js';
import {
  canResolveAsyncLocalStorageDynamically,
  resolveAsyncLocalStorageConstructor,
  resolveImmediateAsyncLocalStorageConstructor,
} from './request-context-node-store.js';
import { createStackRequestContextStore } from './request-context-stack-store.js';
import type { RequestContextStore } from './request-context-store.js';

let requestContextStore: RequestContextStore | undefined;
let requestContextStoreResolution: Promise<RequestContextStore> | undefined;
let fallbackRequestContextStore: RequestContextStore | undefined;

/**
 * Runs a callback inside the request-scoped async context.
 *
 * Hosts with `AsyncLocalStorage` preserve the context across awaited work. Hosts without an async
 * context primitive use a stack fallback that keeps the context only for the synchronous callback
 * frame and clears it before awaited continuations resume.
 *
 * @param context Request context snapshot to bind to the current async execution chain.
 * @param callback Callback executed with `context` available through request-context helpers.
 * @returns The return value from `callback`.
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  const store = getResolvedRequestContextStore();

  if (store) {
    return store.run(context, callback);
  }

  if (!canResolveAsyncLocalStorageDynamically()) {
    return getFallbackRequestContextStore().run(context, callback);
  }

  if (!isAsyncCallback(callback)) {
    void resolveRequestContextStore();

    return getFallbackRequestContextStore().run(context, callback);
  }

  return runWithResolvedRequestContextStore(context, callback) as T;
}

/**
 * Returns the request context active in the current async scope, if available.
 *
 * @returns The active request context, or `undefined` when no request scope is bound.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return getRequestContextStore().getStore();
}

/**
 * Returns the current request context or throws when no request scope is active.
 *
 * @returns The active request context bound to the current async execution scope.
 * @throws {FluoError} When called outside a request scope managed by `runWithRequestContext(...)`.
 */
export function assertRequestContext(): RequestContext {
  const context = getCurrentRequestContext();

  if (!context) {
    throw new FluoError('RequestContext is not available in the current async scope.', {
      code: 'REQUEST_CONTEXT_MISSING',
    });
  }

  return context;
}

/**
 * Creates a defensive clone of a request context for async-context storage.
 *
 * @param context Request context to clone before storing in the active async-context store.
 * @returns A shallow clone with copied metadata map to avoid cross-request mutation.
 */
export function createRequestContext(context: RequestContext): RequestContext {
  return {
    ...context,
    metadata: { ...context.metadata },
  };
}

/**
 * Creates a typed key for `RequestContext.metadata`.
 *
 * @param description Human-readable key label used for debugging and symbol description.
 * @returns A unique metadata key carrying the requested value type.
 */
export function createContextKey<T>(description: string): ContextKey<T> {
  return {
    description,
    id: Symbol(description),
  };
}

/**
 * Reads a typed value from request-context metadata.
 *
 * @param context Request context containing metadata values.
 * @param key Typed metadata key created by `createContextKey(...)`.
 * @returns The stored typed metadata value, or `undefined` when unset.
 */
export function getContextValue<T>(context: RequestContext, key: ContextKey<T>): T | undefined {
  return context.metadata[key.id] as T | undefined;
}

/**
 * Writes a typed value into request-context metadata.
 *
 * @param context Request context whose metadata map should be updated.
 * @param key Typed metadata key created by `createContextKey(...)`.
 * @param value Value to store for subsequent reads in the same request scope.
 */
export function setContextValue<T>(context: RequestContext, key: ContextKey<T>, value: T): void {
  context.metadata[key.id] = value;
}

function getRequestContextStore(): RequestContextStore {
  return getResolvedRequestContextStore() ?? getFallbackRequestContextStore();
}

function getResolvedRequestContextStore(): RequestContextStore | undefined {
  if (requestContextStore) {
    return requestContextStore;
  }

  const AsyncLocalStorage = resolveImmediateAsyncLocalStorageConstructor();

  if (typeof AsyncLocalStorage === 'function') {
    requestContextStore = new AsyncLocalStorage();

    return requestContextStore;
  }

  void resolveRequestContextStore();

  return undefined;
}

async function runWithResolvedRequestContextStore<T>(
  context: RequestContext,
  callback: () => T,
): Promise<Awaited<T>> {
  const store = await resolveRequestContextStore();

  return store.run(context, callback) as Awaited<T>;
}

async function resolveRequestContextStore(): Promise<RequestContextStore> {
  requestContextStoreResolution ??= createRequestContextStore();

  return requestContextStoreResolution;
}

async function createRequestContextStore(): Promise<RequestContextStore> {
  const AsyncLocalStorage = await resolveAsyncLocalStorageConstructor();

  if (typeof AsyncLocalStorage === 'function') {
    requestContextStore = new AsyncLocalStorage();

    return requestContextStore;
  }

  requestContextStore = getFallbackRequestContextStore();

  return requestContextStore;
}

function getFallbackRequestContextStore(): RequestContextStore {
  fallbackRequestContextStore ??= createStackRequestContextStore();

  return fallbackRequestContextStore;
}

function isAsyncCallback<T>(callback: () => T): callback is () => T & Promise<Awaited<T>> {
  return callback.constructor.name === 'AsyncFunction';
}
