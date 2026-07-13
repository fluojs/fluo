import { createContext, createElement, useContext, useEffect, useState } from 'react';

import { ReactClientRouterContextError } from './errors.js';
import {
  createClientNavigationStore,
  type ClientNavigationEnvironment,
  type ClientNavigationStore,
} from './store.js';
import type { ReactClientRouterProviderProps } from './types.js';

const ClientRouterContext = createContext<ClientNavigationStore | null>(null);

function createBrowserEnvironment(browser: Window): ClientNavigationEnvironment {
  return {
    assign: (href) => browser.location.assign(href),
    back: () => browser.history.back(),
    currentHref: () => browser.location.href,
    reload: () => browser.location.reload(),
    replace: (href) => browser.location.replace(href),
    subscribe(listener) {
      browser.addEventListener('hashchange', listener);
      browser.addEventListener('popstate', listener);
      return () => {
        browser.removeEventListener('hashchange', listener);
        browser.removeEventListener('popstate', listener);
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
