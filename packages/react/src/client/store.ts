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
  ReactNavigationFailure,
  ReactNavigationFailurePolicy,
  ReactNavigationSnapshot,
  ReactNavigationType,
  ReactRevalidationResult,
  ReactRouter,
  ReactRouteSnapshot,
} from './types.js';

/** Browser operations required by the HTTP-first navigation store. */
export type ClientNavigationEnvironment = {
  readonly assign: (href: string) => void;
  readonly back: () => void;
  readonly currentHref: () => string;
  readonly failurePolicy?: ReactNavigationFailurePolicy;
  readonly go?: (delta: number) => void;
  readonly historyIndex?: () => number | null;
  readonly load?: (href: string, signal: AbortSignal) => Promise<ReactNavigationLoadResult>;
  readonly prefetch?: (href: string, signal: AbortSignal) => Promise<ReactNavigationLoadResult>;
  readonly prefetchScope?: string;
  readonly pushState?: (href: string, index?: number) => void;
  readonly reload: () => void;
  readonly replace: (href: string) => void;
  readonly replaceState?: (href: string, index?: number) => void;
  readonly subscribe: (listener: (eventType: 'hashchange' | 'popstate') => void) => () => void;
};

/** Internal observable store shared by the provider, hooks, and progressive `Link`. */
export type ClientNavigationStore = {
  readonly canHandleLink: (href: string | URL) => boolean;
  readonly prefetch: (href: string | URL, owner: object) => Promise<void>;
  readonly cancelPrefetch: (href: string | URL, owner: object) => void;
  readonly navigatePrefetchedLink: (href: string | URL) => void;
  readonly connect: (environment: ClientNavigationEnvironment) => () => void;
  readonly getDestination: () => ReactElement | null;
  readonly getSnapshot: () => ReactRouteSnapshot;
  readonly isConnected: () => boolean;
  readonly router: ReactRouter;
  readonly subscribe: (listener: () => void) => () => void;
};

type DocumentNavigationType = Extract<ReactNavigationType, 'push' | 'replace'>;

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

/** Idle lifecycle published when invalidation cancels in-flight navigation without a replacement. */
const IDLE_NAVIGATION: ReactNavigationSnapshot = Object.freeze({ status: 'idle', type: null });

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
  let pending: {
    readonly controller: AbortController;
    readonly href: string;
    readonly type: DocumentNavigationType | 'back' | 'refresh';
  } | null = null;
  let failed: { readonly href: string; readonly type: DocumentNavigationType | 'back' | 'refresh'; readonly index: number | null } | null = null;
  let settleRefresh: ((result: ReactRevalidationResult) => void) | null = null;
  let approvedIndex = 0;
  let restoringIndex: number | null = null;
  let invalidatedTraversal = false;
  let deferredNavigation: {
    readonly destination: URL;
    readonly type: DocumentNavigationType;
    readonly fromPrefetch: boolean;
  } | null = null;
  const cached = new Map<string, { readonly result: Extract<ReactNavigationLoadResult, { ok: true }>; readonly expiresAt: number }>();
  const prefetched = new Map<string, {
    readonly controller: AbortController;
    readonly owners: Set<object>;
    readonly promise: Promise<ReactNavigationLoadResult>;
    adopted: boolean;
  }>();
  let generation = 0;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const publish = (nextSnapshot: ReactRouteSnapshot): void => {
    snapshot = nextSnapshot;
    notify();
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
    settleRefresh?.({ status: 'cancelled' });
    settleRefresh = null;
  };

  const prefetchKey = (destination: URL): string | undefined => {
    if (environment?.prefetchScope === undefined || environment.prefetch === undefined) {
      return undefined;
    }
    const current = new URL(environment.currentHref());
    if (!isHttpProtocol(destination.protocol) || destination.origin !== current.origin
      || destination.pathname === current.pathname && destination.search === current.search) {
      return undefined;
    }
    return `${environment.prefetchScope}\0${destination.origin}${destination.pathname}${destination.search}\0v1`;
  };

  const discardPrefetches = (except?: string): void => {
    for (const [key, entry] of prefetched) {
      if (key !== except) {
        prefetched.delete(key);
        entry.controller.abort();
      }
    }
  };

  const invalidate = (): void => {
    cached.clear();
    discardPrefetches();
    const hadUnsettledNavigation = pending !== null || failed !== null;
    const browser = environment;
    const activatedIndex = browser?.historyIndex?.();
    const unapprovedTraversal = (pending?.type === 'back' || failed?.type === 'back' || restoringIndex !== null)
      && browser !== null && toSnapshotUrl(browser.currentHref()) !== snapshot.url;
    const mustRestore = unapprovedTraversal && browser.go !== undefined
      && activatedIndex !== null && activatedIndex !== undefined;
    cancelPending();
    failed = null;
    deferredNavigation = null;
    if (mustRestore) {
      invalidatedTraversal = true;
      if (restoringIndex === null) {
        restoringIndex = approvedIndex;
        browser.go?.(approvedIndex - activatedIndex);
      }
      return;
    }
    if (unapprovedTraversal) {
      // An untagged history entry has no reliable delta back to the approved page.
      // Let its ordinary document response own the activated URL instead of publishing idle
      // with an old page and params under that unapproved URL.
      browser.replace(browser.currentHref());
      return;
    }
    if (hadUnsettledNavigation) {
      publish(createSnapshotWithNavigation(snapshot, IDLE_NAVIGATION));
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

  const loadAndCommit = (
    browser: ClientNavigationEnvironment,
    destination: URL,
    type: DocumentNavigationType | 'back' | 'refresh',
    adopted?: {
      readonly controller: AbortController;
      readonly promise: Promise<ReactNavigationLoadResult>;
    } | {
      readonly result: Extract<ReactNavigationLoadResult, { ok: true }>;
      readonly expiresAt: number;
    },
  ): void => {
    const load = browser.load;
    if (load === undefined) {
      return;
    }
    const controller = adopted && 'controller' in adopted ? adopted.controller : new AbortController();
    const expectedHref = browser.currentHref();
    pending = { controller, href: destination.href, type };
    const requestGeneration = generation;
    const refreshResolver = type === 'refresh' ? settleRefresh : null;
    const completeRefresh = (result: ReactRevalidationResult): void => {
      if (refreshResolver !== null && settleRefresh === refreshResolver) {
        settleRefresh = null;
        refreshResolver(result);
      }
    };
    void (async () => {
      let result: ReactNavigationLoadResult;
      try {
        if (adopted && 'promise' in adopted) {
          const prefetchedResult = await adopted.promise.catch(
            (): ReactNavigationLoadResult => ({ ok: false, reason: 'unavailable' }),
          );
          result = prefetchedResult.ok && prefetchedResult.prefetchExpiresAt !== undefined
            && Date.now() < prefetchedResult.prefetchExpiresAt
            ? prefetchedResult
            : controller.signal.aborted
              ? { ok: false, reason: 'cancelled' }
              : await load(destination.href, controller.signal);
        } else if (adopted && 'result' in adopted && Date.now() < adopted.expiresAt) {
          result = adopted.result;
        } else {
          result = await load(destination.href, controller.signal);
        }
      } catch {
        if (controller.signal.aborted || requestGeneration !== generation) {
          return;
        }
        result = { ok: false, reason: 'unavailable' };
      }
      const currentHref = browser.currentHref();
      if (controller.signal.aborted || requestGeneration !== generation
        || (type === 'back' || type === 'refresh'
          ? currentHref.split('#', 1)[0] !== expectedHref.split('#', 1)[0]
          : currentHref !== expectedHref)) {
        return;
      }
      if (!result.ok) {
        if (result.reason === 'cancelled') {
          pending = null;
          completeRefresh({ status: 'cancelled' });
          publish(createSnapshotWithNavigation(snapshot, IDLE_NAVIGATION));
          return;
        }
        let failure: ReactNavigationFailure = Object.freeze({
          destination: destination.pathname,
          reason: result.reason,
          type,
        });
        let decision: 'preserve' | 'document' = 'document';
        try {
          if (browser.failurePolicy !== undefined) {
            decision = await browser.failurePolicy(failure);
          }
        } catch {
          if (controller.signal.aborted || requestGeneration !== generation) {
            return;
          }
          console.error('React navigation failure policy rejected.');
          decision = 'preserve';
          failure = Object.freeze({ ...failure, reason: 'application-error' });
        }
        if (controller.signal.aborted || requestGeneration !== generation
          || (type === 'back' || type === 'refresh'
            ? browser.currentHref().split('#', 1)[0] !== expectedHref.split('#', 1)[0]
            : browser.currentHref() !== expectedHref)) {
          return;
        }
        pending = null;
        if (decision === 'preserve' && (type !== 'back'
          || (browser.historyIndex?.() !== null && browser.historyIndex?.() !== undefined && browser.go !== undefined))) {
          failed = { href: type === 'back' ? currentHref : destination.href, type, index: browser.historyIndex?.() ?? null };
          if (type === 'back' && failed.index !== null) {
            restoringIndex = approvedIndex;
            browser.go?.(approvedIndex - failed.index);
          }
          completeRefresh({ status: 'error', failure });
          publish(createSnapshotWithNavigation(snapshot, {
            ...createNavigationSnapshot('error', type, toSnapshotUrl(destination.href)),
            failure,
          }));
          return;
        }
        if (type === 'refresh') {
          completeRefresh({ status: 'document' });
          browser.reload();
        } else if (type === 'replace') {
          browser.replace(destination.href);
        } else {
          browser.assign(type === 'back' ? currentHref : destination.href);
        }
        return;
      }
      pending = null;
      failed = null;
      const confirmed = new URL(result.payload.url, destination.origin);
      const confirmedHref = `${confirmed.href}${type === 'back' || type === 'refresh'
        ? new URL(browser.currentHref()).hash : destination.hash}`;
      if (type === 'push') {
        approvedIndex += 1;
        if (browser.failurePolicy !== undefined && browser.historyIndex !== undefined) {
          browser.pushState?.(confirmedHref, approvedIndex);
        } else {
          browser.pushState?.(confirmedHref);
        }
      } else if (type === 'replace') {
        if (browser.failurePolicy !== undefined && browser.historyIndex !== undefined) {
          browser.replaceState?.(confirmedHref, approvedIndex);
        } else {
          browser.replaceState?.(confirmedHref);
        }
      } else {
        approvedIndex = browser.historyIndex?.() ?? approvedIndex;
      }
      destinationElement = createElement(result.component, {
        ...result.payload.destination.props,
        key: `${requestGeneration}:${result.payload.url}`,
      });
      completeRefresh({ status: 'complete' });
      publish(createSnapshotForHref(
        confirmedHref,
        createNavigationSnapshot('complete', type, toSnapshotUrl(confirmedHref)),
        result.payload.params,
      ));
    })();
  };

  const navigateDocument = (href: string | URL, type: DocumentNavigationType, fromPrefetch = false): void => {
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
    const browser = requireEnvironment();
    if (restoringIndex !== null) {
      deferredNavigation = { destination, type, fromPrefetch };
      return;
    }
    if (browser.failurePolicy !== undefined && pending?.type === 'back'
      && toSnapshotUrl(browser.currentHref()) !== snapshot.url) {
      const activated = browser.historyIndex?.();
      if (activated !== null && activated !== undefined && browser.go !== undefined) {
        cancelPending();
        deferredNavigation = { destination, type, fromPrefetch };
        restoringIndex = approvedIndex;
        browser.go(approvedIndex - activated);
        return;
      }
      browser.assign(destination.href);
      return;
    }
    if ((destinationUrl === snapshot.url && pending === null) || pending?.href === destination.href) {
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('skipped', type, destinationUrl)));
      return;
    }

    const key = fromPrefetch ? prefetchKey(destination) : undefined;
    const activePrefetch = key === undefined ? undefined : prefetched.get(key);
    let adopted: Parameters<typeof loadAndCommit>[3];
    if (activePrefetch !== undefined) {
      activePrefetch.adopted = true;
      adopted = activePrefetch;
    } else if (key !== undefined) {
      const entry = cached.get(key);
      if (entry !== undefined) {
        cached.delete(key);
        if (Date.now() < entry.expiresAt) {
          adopted = entry;
        }
      }
    }
    cancelPending();
    failed = null;
    discardPrefetches(key);
    publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', type, destinationUrl)));
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
      loadAndCommit(browser, destination, type, adopted);
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
      discardPrefetches();
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', 'back')));
      browser.back();
    },
    invalidate,
    push(href: string | URL): void {
      navigateDocument(href, 'push');
    },
    retry(): void {
      const last = failed;
      if (last === null) {
        return;
      }
      failed = null;
      if (last.type === 'back' && last.index !== null) {
        cancelPending();
        requireEnvironment().go?.(last.index - approvedIndex);
      } else if (last.type === 'refresh') {
        void router.refresh();
      } else {
        navigateDocument(last.href, last.type === 'back' ? 'push' : last.type);
      }
    },
    openDocument(): void {
      const last = failed;
      if (last === null) {
        return;
      }
      failed = null;
      cancelPending();
      if (last.type === 'refresh') {
        requireEnvironment().reload();
      } else if (last.type === 'replace') {
        requireEnvironment().replace(last.href);
      } else {
        requireEnvironment().assign(last.href);
      }
    },
    refresh(): Promise<ReactRevalidationResult> {
      const browser = requireEnvironment();
      cancelPending();
      discardPrefetches();
      if (browser.load === undefined || browser.pushState === undefined || browser.replaceState === undefined) {
        publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('refreshing', 'refresh')));
        browser.reload();
        return Promise.resolve({ status: 'document' });
      }
      const destination = new URL(browser.currentHref());
      const refreshing = new Promise<ReactRevalidationResult>((resolve) => {
        settleRefresh = resolve;
        loadAndCommit(browser, destination, 'refresh');
      });
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('refreshing', 'refresh')));
      return refreshing;
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
      try {
        const destination = new URL(href, current);
        return isHttpProtocol(destination.protocol) && destination.origin === current.origin;
      } catch {
        return false;
      }
    },
    prefetch(href: string | URL, owner: object): Promise<void> {
      if (environment === null || !this.canHandleLink(href)) {
        return Promise.resolve();
      }
      const destination = new URL(href, environment.currentHref());
      const key = prefetchKey(destination);
      if (key === undefined || environment.prefetch === undefined) {
        return Promise.resolve();
      }
      const completed = cached.get(key);
      if (completed !== undefined) {
        cached.delete(key);
        if (Date.now() < completed.expiresAt) {
          cached.set(key, completed);
          return Promise.resolve();
        }
      }
      const ongoing = prefetched.get(key);
      if (ongoing !== undefined) {
        ongoing.owners.add(owner);
        return ongoing.promise.then(() => {}, () => {});
      }
      if (prefetched.size >= 4) {
        return Promise.resolve();
      }
      const controller = new AbortController();
      const entry = {
        controller,
        owners: new Set([owner]),
        promise: environment.prefetch(destination.href, controller.signal),
        adopted: false,
      };
      prefetched.set(key, entry);
      return entry.promise.then((result) => {
        if (prefetched.get(key) !== entry) {
          return;
        }
        prefetched.delete(key);
        if (!entry.adopted && !controller.signal.aborted && result.ok
          && result.prefetchExpiresAt !== undefined && Date.now() < result.prefetchExpiresAt) {
          cached.delete(key);
          cached.set(key, { result, expiresAt: result.prefetchExpiresAt });
          if (cached.size > 32) {
            cached.delete(cached.keys().next().value ?? '');
          }
        }
      }, () => {
        if (prefetched.get(key) === entry) {
          prefetched.delete(key);
        }
      });
    },
    cancelPrefetch(href: string | URL, owner: object): void {
      if (environment === null || !this.canHandleLink(href)) {
        return;
      }
      const key = prefetchKey(new URL(href, environment.currentHref()));
      const entry = key === undefined ? undefined : prefetched.get(key);
      if (entry === undefined || entry.adopted) {
        return;
      }
      entry.owners.delete(owner);
      if (entry.owners.size === 0 && key !== undefined) {
        prefetched.delete(key);
        entry.controller.abort();
      }
    },
    navigatePrefetchedLink(href: string | URL): void {
      navigateDocument(href, 'push', true);
    },
    connect(nextEnvironment: ClientNavigationEnvironment): () => void {
      invalidate();
      environment = nextEnvironment;
      if (nextEnvironment.failurePolicy !== undefined && nextEnvironment.historyIndex?.() === null) {
        nextEnvironment.replaceState?.(nextEnvironment.currentHref(), approvedIndex);
      }
      if (restoringIndex === null && toSnapshotUrl(nextEnvironment.currentHref()) === snapshot.url) {
        approvedIndex = nextEnvironment.historyIndex?.() ?? approvedIndex;
      }
      const unsubscribe = connectClientNavigationHistory(nextEnvironment, {
        cancelPending: () => {
          cancelPending();
          failed = null;
          discardPrefetches();
        },
        createSnapshotForHref,
        getSnapshot: () => snapshot,
        isRestoring: () => restoringIndex !== null,
        restore: () => {
          if (restoringIndex !== null && nextEnvironment.historyIndex?.() === restoringIndex
            && toSnapshotUrl(nextEnvironment.currentHref()) === snapshot.url) {
            restoringIndex = null;
            if (invalidatedTraversal) {
              invalidatedTraversal = false;
              publish(createSnapshotWithNavigation(snapshot, IDLE_NAVIGATION));
            }
            const deferred = deferredNavigation;
            deferredNavigation = null;
            if (deferred !== null) {
              navigateDocument(deferred.destination, deferred.type, deferred.fromPrefetch);
            }
            return true;
          }
          restoringIndex = null;
          invalidatedTraversal = false;
          return false;
        },
        loadAndCommit,
        publish,
      });
      notify();

      return () => {
        unsubscribe();
        if (environment === nextEnvironment) {
          invalidate();
          environment = null;
          notify();
        }
      };
    },
    getDestination: () => destinationElement,
    getSnapshot: () => snapshot,
    isConnected: () => environment !== null,
    router,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
