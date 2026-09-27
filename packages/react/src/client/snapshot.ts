import { ReadonlySearchParams } from './search-params.js';
import type {
  ReactNavigationSnapshot,
  ReactNavigationType,
  ReactRouteSnapshot,
  ReactRouteSnapshotInput,
} from './types.js';

const ROUTE_SNAPSHOT_BASE_URL = 'https://fluo.invalid/' as const;
const IDLE_NAVIGATION = Object.freeze({ status: 'idle', type: null } satisfies ReactNavigationSnapshot);

/**
 * Describe one browser navigation phase without deriving any route data.
 *
 * @param status Observable navigation phase.
 * @param type Browser navigation operation.
 * @param destination Optional requested or confirmed URL.
 * @returns The navigation lifecycle snapshot.
 */
export function createNavigationSnapshot(
  status: ReactNavigationSnapshot['status'],
  type: ReactNavigationType,
  destination?: string,
): ReactNavigationSnapshot {
  return destination === undefined ? { status, type } : { destination, status, type };
}

function toRouteUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Create a defensive route-state snapshot from an HTTP request URL and matched path params.
 *
 * @param input Request-owned URL and matched path params shared with hydration.
 * @returns An immutable URL snapshot suitable for `ReactClientRouterProvider`.
 */
export function createReactRouteSnapshot(input: ReactRouteSnapshotInput): ReactRouteSnapshot {
  const url = new URL(input.url, ROUTE_SNAPSHOT_BASE_URL);

  return Object.freeze({
    hash: url.hash,
    navigation: IDLE_NAVIGATION,
    params: Object.freeze({ ...input.params }),
    pathname: url.pathname,
    searchParams: new ReadonlySearchParams(url.search),
    url: toRouteUrl(url),
  });
}

/**
 * Rebuild a route snapshot after browser history activates a URL.
 *
 * @param href Confirmed browser location.
 * @param params HTTP-confirmed route parameters.
 * @param navigation Current navigation lifecycle.
 * @returns An immutable route snapshot.
 */
export function createSnapshotFromHref(
  href: string,
  params: Readonly<Record<string, string>>,
  navigation: ReactNavigationSnapshot,
): ReactRouteSnapshot {
  const url = new URL(href, ROUTE_SNAPSHOT_BASE_URL);

  return Object.freeze({
    hash: url.hash,
    navigation: Object.freeze(navigation),
    params: Object.freeze({ ...params }),
    pathname: url.pathname,
    searchParams: new ReadonlySearchParams(url.search),
    url: toRouteUrl(url),
  });
}

/**
 * Preserve route URL state while producing a new navigation lifecycle snapshot.
 *
 * @param snapshot Current route state.
 * @param navigation New lifecycle state.
 * @returns A route snapshot with unchanged URL and params.
 */
export function createSnapshotWithNavigation(
  snapshot: ReactRouteSnapshot,
  navigation: ReactNavigationSnapshot,
): ReactRouteSnapshot {
  return Object.freeze({ ...snapshot, navigation: Object.freeze(navigation) });
}

/**
 * Normalize an absolute browser URL to the request-relative route snapshot form.
 *
 * @param href Absolute browser URL.
 * @returns The request-relative route URL.
 */
export function toSnapshotUrl(href: string): string {
  return toRouteUrl(new URL(href));
}
