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
  if (typeof host.AsyncLocalStorage === 'function') {
    return host.AsyncLocalStorage;
  }

  const builtinAsyncLocalStorage = host.process?.getBuiltinModule?.('node:async_hooks').AsyncLocalStorage;

  if (typeof builtinAsyncLocalStorage === 'function') {
    return builtinAsyncLocalStorage;
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

function isNodeHost(host: AsyncLocalStorageResolutionHost): boolean {
  return typeof host.process?.versions?.node === 'string';
}

function importNodeAsyncHooks(): Promise<NodeAsyncHooksModule> {
  const nodeAsyncHooksSpecifier = `node:${'async_hooks'}`;

  return import(nodeAsyncHooksSpecifier) as Promise<NodeAsyncHooksModule>;
}
