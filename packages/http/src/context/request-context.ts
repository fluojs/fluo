import { FluoError } from '@fluojs/core';

import type { ContextKey, RequestContext } from '../types.js';

type RequestContextStore = {
  getStore(): RequestContext | undefined;
  run<T>(context: RequestContext, callback: () => T): T;
};

const requestContextStore: RequestContextStore = createRequestContextStore();

/**
 * Runs a callback inside the request-scoped AsyncLocalStorage context.
 *
 * @param context Request context snapshot to bind to the current async execution chain.
 * @param callback Callback executed with `context` available through request-context helpers.
 * @returns The return value from `callback`.
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return requestContextStore.run(context, callback);
}

/**
 * Returns the request context active in the current async scope, if available.
 *
 * @returns The active request context, or `undefined` when no request scope is bound.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
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
 * Creates a defensive clone of a request context for AsyncLocalStorage storage.
 *
 * @param context Request context to clone before storing in AsyncLocalStorage.
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

function createRequestContextStore(): RequestContextStore {
  const AsyncLocalStorage = resolveAsyncLocalStorageConstructor();

  if (typeof AsyncLocalStorage === 'function') {
    return new AsyncLocalStorage();
  }

  return createStackRequestContextStore();
}

function resolveAsyncLocalStorageConstructor(): (new () => RequestContextStore) | undefined {
  const globalAsyncLocalStorage = (globalThis as typeof globalThis & {
    AsyncLocalStorage?: new () => RequestContextStore;
  }).AsyncLocalStorage;

  if (typeof globalAsyncLocalStorage === 'function') {
    return globalAsyncLocalStorage;
  }

  const getBuiltinModule = (globalThis as typeof globalThis & {
    process?: {
      getBuiltinModule?(id: 'node:async_hooks'): {
        AsyncLocalStorage?: new () => RequestContextStore;
      };
    };
  }).process?.getBuiltinModule;

  return getBuiltinModule?.('node:async_hooks').AsyncLocalStorage;
}

export function createStackRequestContextStore(): RequestContextStore {
  const stack: RequestContext[] = [];

  return {
    getStore() {
      return stack.at(-1);
    },
    run<T>(context: RequestContext, callback: () => T): T {
      stack.push(context);

      try {
        return callback();
      } catch (error) {
        throw error;
      } finally {
        removeStackContext(stack, context);
      }
    },
  };
}

function removeStackContext(stack: RequestContext[], context: RequestContext): void {
  const index = stack.lastIndexOf(context);

  if (index >= 0) {
    stack.splice(index, 1);
  }
}
