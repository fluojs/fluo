import { useSyncExternalStore } from 'react';

import { useClientNavigationStore } from './provider.js';
import type {
  ReactNavigationSnapshot,
  ReactReadonlySearchParams,
  ReactRouteSnapshot,
  ReactRouter,
} from './types.js';

/** Read the router operations bound to the hydrated browser document. */
export function useRouter(): ReactRouter {
  return useClientNavigationStore().router;
}

/** Read the current HTTP route pathname and subscribe to history updates. */
export function usePathname(): string {
  return useRouterState().pathname;
}

/** Read the path params supplied by the latest server-owned HTTP route match. */
export function useParams(): Readonly<Record<string, string>> {
  return useRouterState().params;
}

/** Read an immutable search parameter snapshot and subscribe to history updates. */
export function useSearchParams(): ReactReadonlySearchParams {
  return useRouterState().searchParams;
}

/** Read the current navigation lifecycle state. */
export function useNavigation(): ReactNavigationSnapshot {
  return useRouterState().navigation;
}

/** Read the complete route-state snapshot for the active HTTP document. */
export function useRouterState(): ReactRouteSnapshot {
  const store = useClientNavigationStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
