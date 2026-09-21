import {
  createContext,
  createElement,
  type Context,
  useContext,
  useEffect,
  useState,
} from 'react';

import { ReactClientRouterContextError } from './errors.js';
import {
  type ClientNavigationEnvironment,
  type ClientNavigationStore,
  createClientNavigationStore,
} from './store.js';
import type { ReactClientRouterProviderProps } from './types.js';

const clientRouterContextKey = Symbol.for('fluo.react.client-router-context.v1');

type SharedClientRouterContext = {
  readonly context: Context<ClientNavigationStore | null>;
  readonly version: 1;
};

function isClientRouterContext(value: unknown): value is Context<ClientNavigationStore | null> {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'Provider') === 'object'
    && typeof Reflect.get(value, 'Consumer') === 'object';
}

function isSharedClientRouterContext(value: unknown): value is SharedClientRouterContext {
  return typeof value === 'object'
    && value !== null
    && Reflect.get(value, 'version') === 1
    && isClientRouterContext(Reflect.get(value, 'context'));
}

function getClientRouterContext(): Context<ClientNavigationStore | null> {
  const globalScope = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = globalScope[clientRouterContextKey];

  if (isSharedClientRouterContext(existing)) {
    return existing.context;
  }

  const context = createContext<ClientNavigationStore | null>(null);
  const sharedContext: SharedClientRouterContext = { context, version: 1 };
  const descriptor = Object.getOwnPropertyDescriptor(globalScope, clientRouterContextKey);

  if (descriptor && !descriptor.configurable) {
    return context;
  }

  Object.defineProperty(globalScope, clientRouterContextKey, {
    configurable: false,
    enumerable: false,
    value: sharedContext,
    writable: false,
  });

  return context;
}

const ClientRouterContext = getClientRouterContext();

function createBrowserEnvironment(browser: Window): ClientNavigationEnvironment {
  return {
    assign: (href) => browser.location.assign(href),
    back: () => browser.history.back(),
    currentHref: () => browser.location.href,
    reload: () => browser.location.reload(),
    replace: (href) => browser.location.replace(href),
    subscribe(listener) {
      const handleHashChange = () => listener('hashchange');
      const handlePopState = () => listener('popstate');
      browser.addEventListener('hashchange', handleHashChange);
      browser.addEventListener('popstate', handlePopState);
      return () => {
        browser.removeEventListener('hashchange', handleHashChange);
        browser.removeEventListener('popstate', handlePopState);
      };
    },
  };
}

/**
 * Provide one HTTP request route snapshot to client navigation hooks during SSR and hydration.
 *
 * @param props Initial route snapshot and descendants that consume client route state.
 * @returns A context provider that binds browser navigation only after hydration.
 */
export function ReactClientRouterProvider({ children, initialSnapshot }: ReactClientRouterProviderProps) {
  const [store] = useState(() => createClientNavigationStore(initialSnapshot));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return store.connect(createBrowserEnvironment(window));
  }, [store]);

  return createElement(ClientRouterContext.Provider, { value: store }, children);
}

/** Read the provider-owned navigation store for public hooks and `Link`. */
export function useClientNavigationStore(): ClientNavigationStore {
  const store = useContext(ClientRouterContext);
  if (store === null) {
    throw new ReactClientRouterContextError();
  }
  return store;
}
