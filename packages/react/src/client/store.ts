import { ReactClientNavigationError } from './errors.js';
import {
  createSnapshotFromHref,
  createSnapshotWithNavigation,
  toSnapshotUrl,
} from './snapshot.js';
import type {
  ReactNavigationSnapshot,
  ReactNavigationType,
  ReactRouteSnapshot,
  ReactRouter,
} from './types.js';

/** Browser operations required by the HTTP-first navigation store. */
export type ClientNavigationEnvironment = {
  readonly assign: (href: string) => void;
  readonly back: () => void;
  readonly currentHref: () => string;
  readonly reload: () => void;
  readonly replace: (href: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

/** Internal observable store shared by the provider, hooks, and progressive `Link`. */
export type ClientNavigationStore = {
  readonly canHandleLink: (href: string | URL) => boolean;
  readonly connect: (environment: ClientNavigationEnvironment) => () => void;
  readonly getSnapshot: () => ReactRouteSnapshot;
  readonly router: ReactRouter;
  readonly subscribe: (listener: () => void) => () => void;
};

type DocumentNavigationType = Extract<ReactNavigationType, 'push' | 'replace'>;

function createNavigationSnapshot(
  status: ReactNavigationSnapshot['status'],
  type: ReactNavigationType,
  destination?: string,
): ReactNavigationSnapshot {
  return destination === undefined ? { status, type } : { destination, status, type };
}

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
  const listeners = new Set<() => void>();

  const publish = (nextSnapshot: ReactRouteSnapshot): void => {
    snapshot = nextSnapshot;
    for (const listener of listeners) {
      listener();
    }
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
    if (destinationUrl === snapshot.url) {
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('skipped', type, destinationUrl)));
      return;
    }

    publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', type, destinationUrl)));
    const browser = requireEnvironment();
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
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', 'back')));
      browser.back();
    },
    push(href: string | URL): void {
      navigateDocument(href, 'push');
    },
    refresh(): void {
      const browser = requireEnvironment();
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
      const unsubscribe = nextEnvironment.subscribe(() => {
        const currentHref = nextEnvironment.currentHref();
        const currentPathname = new URL(currentHref).pathname;
        const params = currentPathname === snapshot.pathname ? snapshot.params : {};
        const navigationType = snapshot.navigation.type ?? 'back';
        publish(
          createSnapshotFromHref(
            currentHref,
            params,
            createNavigationSnapshot('complete', navigationType),
          ),
        );
      });

      return () => {
        unsubscribe();
        if (environment === nextEnvironment) {
          environment = null;
        }
      };
    },
    getSnapshot: () => snapshot,
    router,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
