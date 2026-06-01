import type { RequestContextStore } from './request-context-store.js';

type AsyncLocalStorageConstructor = new () => RequestContextStore;

type NodeAsyncHooksModule = {
  AsyncLocalStorage?: AsyncLocalStorageConstructor;
};

type AsyncLocalStorageResolutionHost = {
  AsyncLocalStorage?: AsyncLocalStorageConstructor;
  process?: {
    getBuiltinModule?(id: 'node:async_hooks'): NodeAsyncHooksModule;
    versions?: {
      node?: string;
    };
  };
};

type NodeAsyncHooksLoader = () => Promise<NodeAsyncHooksModule>;

/**
 * Resolves host-provided `AsyncLocalStorage` without async imports or throwing host probes.
 *
 * @param host Host global-like object to inspect for synchronous async-context support.
 * @returns The resolved `AsyncLocalStorage` constructor, or `undefined` when unavailable.
 */
export function resolveImmediateAsyncLocalStorageConstructor(
  host: AsyncLocalStorageResolutionHost = globalThis,
): AsyncLocalStorageConstructor | undefined {
  if (typeof host.AsyncLocalStorage === 'function') {
    return host.AsyncLocalStorage;
  }

  const getBuiltinModule = host.process?.getBuiltinModule;

  if (typeof getBuiltinModule !== 'function') {
    return undefined;
  }

  try {
    const builtinAsyncLocalStorage = getBuiltinModule('node:async_hooks')?.AsyncLocalStorage;

    if (typeof builtinAsyncLocalStorage === 'function') {
      return builtinAsyncLocalStorage;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Resolves the host `AsyncLocalStorage` constructor without eagerly importing Node built-ins.
 *
 * @param host Host global-like object to inspect for async-context support.
 * @param loadNodeAsyncHooks Lazy loader for Node's `node:async_hooks` module.
 * @returns The resolved `AsyncLocalStorage` constructor, or `undefined` when unavailable.
 */
export async function resolveAsyncLocalStorageConstructor(
  host: AsyncLocalStorageResolutionHost = globalThis,
  loadNodeAsyncHooks: NodeAsyncHooksLoader = importNodeAsyncHooks,
): Promise<AsyncLocalStorageConstructor | undefined> {
  const immediateAsyncLocalStorage = resolveImmediateAsyncLocalStorageConstructor(host);

  if (typeof immediateAsyncLocalStorage === 'function') {
    return immediateAsyncLocalStorage;
  }

  if (!isNodeHost(host)) {
    return undefined;
  }

  try {
    const nodeAsyncHooks = await loadNodeAsyncHooks();

    return nodeAsyncHooks.AsyncLocalStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reports whether the host can still resolve Node async-context storage asynchronously.
 *
 * @param host Host global-like object to inspect for Node runtime markers.
 * @returns `true` when the host is Node.js and can use a lazy `node:async_hooks` import.
 */
export function canResolveAsyncLocalStorageDynamically(
  host: AsyncLocalStorageResolutionHost = globalThis,
): boolean {
  return isNodeHost(host);
}

function isNodeHost(host: AsyncLocalStorageResolutionHost): boolean {
  return typeof host.process?.versions?.node === 'string';
}

function importNodeAsyncHooks(): Promise<NodeAsyncHooksModule> {
  const nodeAsyncHooksSpecifier = `node:${'async_hooks'}`;

  return import(nodeAsyncHooksSpecifier) as Promise<NodeAsyncHooksModule>;
}
