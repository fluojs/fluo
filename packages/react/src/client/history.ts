import {
  createNavigationSnapshot,
  createSnapshotWithNavigation,
  toSnapshotUrl,
} from './snapshot.js';
import type { ClientNavigationEnvironment } from './store.js';
import type { ReactNavigationSnapshot, ReactRouteSnapshot } from './types.js';

type HistoryHandlers = {
  readonly cancelPending: () => void;
  readonly createSnapshotForHref: (href: string, navigation: ReactNavigationSnapshot) => ReactRouteSnapshot;
  readonly getSnapshot: () => ReactRouteSnapshot;
  readonly loadAndCommit: (browser: ClientNavigationEnvironment, destination: URL, type: 'back') => void;
  readonly publish: (snapshot: ReactRouteSnapshot) => void;
};

/**
 * Bind browser traversal without guessing params from a URL or retaining private page data.
 *
 * @param browser Browser operations and history events.
 * @param handlers Store-owned navigation state transitions.
 * @returns A browser listener cleanup function.
 */
export function connectClientNavigationHistory(
  browser: ClientNavigationEnvironment,
  handlers: HistoryHandlers,
): () => void {
  const unsubscribe = browser.subscribe((eventType) => {
    const href = browser.currentHref();
    const currentUrl = toSnapshotUrl(href);
    const snapshot = handlers.getSnapshot();
    const activated = new URL(href);
    if (eventType === 'hashchange' &&
      (activated.pathname !== snapshot.pathname
        || activated.search !== new URL(snapshot.url, href).search)) {
      return;
    }
    if (activated.pathname === snapshot.pathname
      && activated.search === new URL(snapshot.url, href).search) {
      handlers.cancelPending();
      const navigating = snapshot.navigation;
      const type = eventType === 'hashchange' && navigating.destination === currentUrl
        && (navigating.type === 'push' || navigating.type === 'replace')
          ? navigating.type : 'back';
      handlers.publish(handlers.createSnapshotForHref(
        href,
        type === 'back'
          ? createNavigationSnapshot('complete', 'back')
          : createNavigationSnapshot('complete', type, currentUrl),
      ));
      return;
    }
    handlers.cancelPending();
    if (!browser.load) {
      browser.assign(href);
      return;
    }
    handlers.publish(createSnapshotWithNavigation(
      snapshot,
      createNavigationSnapshot('navigating', 'back', currentUrl),
    ));
    handlers.loadAndCommit(browser, activated, 'back');
  });

  const currentHref = browser.currentHref();
  const snapshot = handlers.getSnapshot();
  if (toSnapshotUrl(currentHref) !== snapshot.url) {
    if (new URL(currentHref).pathname === snapshot.pathname
      && new URL(currentHref).search === new URL(snapshot.url, currentHref).search) {
      handlers.publish(handlers.createSnapshotForHref(currentHref, snapshot.navigation));
    } else {
      browser.assign(currentHref);
    }
  }
  return unsubscribe;
}
