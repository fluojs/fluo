import { createElement, type ReactElement } from 'react';
import { ReactClientNavigationError } from './errors.js';
import { connectClientNavigationHistory } from './history.js';
import type { ReactNavigationLoadResult } from './navigation-payload.js';
import {
  createNavigationSnapshot,
  createSnapshotFromHref,
  createSnapshotWithNavigation,
  toSnapshotUrl,
} from './snapshot.js';
import type {
  ReactNavigationSnapshot,
  ReactNavigationType,
  ReactRouter,
  ReactRouteSnapshot,
} from './types.js';

/** Browser operations required by the HTTP-first navigation store. */
export type ClientNavigationEnvironment = {
  readonly assign: (href: string) => void;
  readonly back: () => void;
  readonly currentHref: () => string;
  readonly load?: (href: string, signal: AbortSignal) => Promise<ReactNavigationLoadResult>;
  readonly pushState?: (href: string) => void;
  readonly reload: () => void;
  readonly replace: (href: string) => void;
  readonly replaceState?: (href: string) => void;
  readonly subscribe: (listener: (eventType: 'hashchange' | 'popstate') => void) => () => void;
};

/** Internal observable store shared by the provider, hooks, and progressive `Link`. */
export type ClientNavigationStore = {
  readonly canHandleLink: (href: string | URL) => boolean;
  readonly connect: (environment: ClientNavigationEnvironment) => () => void;
  readonly getDestination: () => ReactElement | null;
  readonly getSnapshot: () => ReactRouteSnapshot;
  readonly router: ReactRouter;
  readonly subscribe: (listener: () => void) => () => void;
};

type DocumentNavigationType = Extract<ReactNavigationType, 'push' | 'replace'>;

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * Create the client navigation store used by `ReactClientRouterProvider`.
 *
 * @param initialSnapshot Request-owned route state used for SSR and hydration.
 * @returns A store whose router delegates rendering and validation to browser HTTP navigation.
 */
export function createClientNavigationStore(initialSnapshot: ReactRouteSnapshot): ClientNavigationStore {
  let environment: ClientNavigationEnvironment | null = null;
  let snapshot = initialSnapshot;
  let destinationElement: ReactElement | null = null;
  let pending: { readonly controller: AbortController; readonly href: string } | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();

  const publish = (nextSnapshot: ReactRouteSnapshot): void => {
    snapshot = nextSnapshot;
    for (const listener of listeners) {
      listener();
    }
  };

  const createSnapshotForHref = (
    href: string,
    navigation: ReactNavigationSnapshot,
    params?: Readonly<Record<string, string>>,
  ): ReactRouteSnapshot => {
    const pathname = new URL(href).pathname;
    return createSnapshotFromHref(
      href,
      params ?? (pathname === snapshot.pathname ? snapshot.params : {}),
      navigation,
    );
  };

  const cancelPending = (): void => {
    generation += 1;
    pending?.controller.abort();
    pending = null;
  };

  const requireEnvironment = (): ClientNavigationEnvironment => {
    if (environment === null) {
      throw new ReactClientNavigationError(
        'browser-unavailable',
        'React client navigation is unavailable before hydration or outside a browser.',
      );
    }
    return environment;
  };

  const resolveDestination = (href: string | URL): URL => {
    const browser = requireEnvironment();
    const current = new URL(browser.currentHref());
    const destination = new URL(href, current);
    if (!isHttpProtocol(destination.protocol) || destination.origin !== current.origin) {
      throw new ReactClientNavigationError(
        'unsupported-destination',
        'useRouter() supports only same-origin HTTP or HTTPS destinations.',
      );
    }
    return destination;
  };

  const loadAndCommit = (
    browser: ClientNavigationEnvironment,
    destination: URL,
    type: DocumentNavigationType | 'back',
  ): void => {
    const load = browser.load;
    if (load === undefined) {
      return;
    }
    const controller = new AbortController();
    const expectedHref = browser.currentHref();
    pending = { controller, href: destination.href };
    const requestGeneration = generation;
    void (async () => {
      let result: ReactNavigationLoadResult;
      try {
        result = await load(destination.href, controller.signal);
      } catch {
        if (controller.signal.aborted || requestGeneration !== generation) {
          return;
        }
        result = { ok: false, reason: 'unavailable' };
      }
      const currentHref = browser.currentHref();
      if (controller.signal.aborted || requestGeneration !== generation
        || (type === 'back'
          ? currentHref.split('#', 1)[0] !== expectedHref.split('#', 1)[0]
          : currentHref !== expectedHref)) {
        return;
      }
      pending = null;
      if (!result.ok) {
        if (result.reason !== 'cancelled') {
          if (type === 'replace') {
            browser.replace(destination.href);
          } else {
            browser.assign(type === 'back' ? currentHref : destination.href);
          }
        }
        return;
      }
      const confirmed = new URL(result.payload.url, destination.origin);
      const confirmedHref = `${confirmed.href}${type === 'back' ? new URL(currentHref).hash : destination.hash}`;
      if (type === 'push') {
        browser.pushState?.(confirmedHref);
      } else if (type === 'replace') {
        browser.replaceState?.(confirmedHref);
      }
      destinationElement = createElement(result.component, {
        ...result.payload.destination.props,
        key: `${requestGeneration}:${result.payload.url}`,
      });
      publish(createSnapshotForHref(
        confirmedHref,
        createNavigationSnapshot('complete', type, toSnapshotUrl(confirmedHref)),
        result.payload.params,
      ));
    })();
  };

  const navigateDocument = (href: string | URL, type: DocumentNavigationType): void => {
    let destination: URL;
    try {
      destination = resolveDestination(href);
    } catch (error) {
      publish(
        createSnapshotWithNavigation(
          snapshot,
          createNavigationSnapshot('error', type, String(href)),
        ),
      );
      throw error;
    }

    const destinationUrl = toSnapshotUrl(destination.href);
    if ((destinationUrl === snapshot.url && pending === null) || pending?.href === destination.href) {
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('skipped', type, destinationUrl)));
      return;
    }

    cancelPending();
    publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', type, destinationUrl)));
    const browser = requireEnvironment();
    const active = new URL(browser.currentHref());
    if (destination.pathname === active.pathname && destination.search === active.search) {
      if (type === 'push') {
        browser.assign(destination.href);
      } else {
        browser.replace(destination.href);
      }
      return;
    }
    if (browser.load && browser.pushState && browser.replaceState) {
      loadAndCommit(browser, destination, type);
      return;
    }
    try {
      if (type === 'push') {
        browser.assign(destination.href);
      } else {
        browser.replace(destination.href);
      }
    } catch (error) {
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('error', type, destinationUrl)));
      throw error;
    }
  };

  const router: ReactRouter = Object.freeze({
    back(): void {
      const browser = requireEnvironment();
      cancelPending();
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', 'back')));
      browser.back();
    },
    push(href: string | URL): void {
      navigateDocument(href, 'push');
    },
    refresh(): void {
      const browser = requireEnvironment();
      cancelPending();
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('refreshing', 'refresh')));
      browser.reload();
    },
    replace(href: string | URL): void {
      navigateDocument(href, 'replace');
    },
  });

  return {
    canHandleLink(href: string | URL): boolean {
      if (environment === null) {
        return false;
      }
      const current = new URL(environment.currentHref());
      const destination = new URL(href, current);
      return isHttpProtocol(destination.protocol) && destination.origin === current.origin;
    },
    connect(nextEnvironment: ClientNavigationEnvironment): () => void {
      environment = nextEnvironment;
      const unsubscribe = connectClientNavigationHistory(nextEnvironment, {
        cancelPending,
        createSnapshotForHref,
        getSnapshot: () => snapshot,
        loadAndCommit,
        publish,
      });

      return () => {
        unsubscribe();
        if (environment === nextEnvironment) {
          cancelPending();
          environment = null;
        }
      };
    },
    getDestination: () => destinationElement,
    getSnapshot: () => snapshot,
    router,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
