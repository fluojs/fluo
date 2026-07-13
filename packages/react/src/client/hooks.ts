import { useSyncExternalStore } from 'react';

import { useClientNavigationStore } from './provider.js';
import type {
  ReactNavigationSnapshot,
  ReactReadonlySearchParams,
  ReactRouter,
  ReactRouteSnapshot,
} from './types.js';

/**
 * Read the router operations bound to the hydrated browser document.
 *
 * @returns Router operations for full-document navigation and history traversal.
 */
export function useRouter(): ReactRouter {
  return useClientNavigationStore().router;
}

/**
 * Read the current HTTP route pathname and subscribe to history updates.
 *
 * @returns The pathname from the current immutable route snapshot.
 */
export function usePathname(): string {
  return useRouterState().pathname;
}

/**
 * Read the path params supplied by the latest server-owned HTTP route match.
 *
 * @returns The server-matched path parameter snapshot.
 */
export function useParams(): Readonly<Record<string, string>> {
  return useRouterState().params;
}

/**
 * Read an immutable search parameter snapshot and subscribe to history updates.
 *
 * @returns Read-only search parameters from the current route snapshot.
 */
export function useSearchParams(): ReactReadonlySearchParams {
  return useRouterState().searchParams;
}

/**
 * Read the current navigation lifecycle state.
 *
 * @returns The current navigation status, type, and optional destination.
 */
export function useNavigation(): ReactNavigationSnapshot {
  return useRouterState().navigation;
}

/**
 * Read the complete route-state snapshot for the active HTTP document.
 *
 * @returns The immutable route snapshot shared by the provider.
 */
export function useRouterState(): ReactRouteSnapshot {
  const store = useClientNavigationStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
