import type { ReactNavigationLoadResult } from './navigation-payload.js';
import type { ClientNavigationEnvironment } from './store.js';

type CompletedPrefetch = {
  readonly result: Extract<ReactNavigationLoadResult, { ok: true }>;
  readonly expiresAt: number;
};

type PendingPrefetch = {
  readonly controller: AbortController;
  readonly owners: Set<object>;
  readonly promise: Promise<ReactNavigationLoadResult>;
  adopted: boolean;
};

type PrefetchEnvironment = Pick<ClientNavigationEnvironment, 'currentHref' | 'prefetch' | 'prefetchScope'>;

/**
 * Own provider-local public speculation without owning navigation or session approval.
 *
 * @param getEnvironment The store's currently connected browser prefetch boundary.
 * @param getSessionGeneration The store-owned session generation used to partition reuse.
 * @returns Pending ownership, single-use cache and explicit revocation operations.
 */
export function createClientPrefetchStore(
  getEnvironment: () => PrefetchEnvironment | null,
  getSessionGeneration: () => number,
) {
  const cached = new Map<string, CompletedPrefetch>();
  const prefetched = new Map<string, PendingPrefetch>();

  const keyFor = (destination: URL): string | undefined => {
    const environment = getEnvironment();
    if (environment?.prefetchScope === undefined || environment.prefetch === undefined) {
      return undefined;
    }
    const current = new URL(environment.currentHref());
    if ((destination.protocol !== 'http:' && destination.protocol !== 'https:') || destination.origin !== current.origin
      || destination.pathname === current.pathname && destination.search === current.search) {
      return undefined;
    }
    return `${getSessionGeneration()}:${environment.prefetchScope}\0${destination.origin}${destination.pathname}${destination.search}\0v2`;
  };

  const discard = (except?: string): void => {
    for (const [key, entry] of prefetched) {
      if (key !== except) {
        prefetched.delete(key);
        entry.controller.abort();
      }
    }
  };

  return {
    keyFor,
    discard,
    invalidate(): void {
      cached.clear();
      discard();
    },
    detach(): readonly AbortController[] {
      // Session revocation detaches every owner before any operation's abort callbacks run.
      const controllers = [...prefetched.values()].map((entry) => entry.controller);
      prefetched.clear();
      cached.clear();
      return controllers;
    },
    adopt(key: string | undefined): PendingPrefetch | CompletedPrefetch | undefined {
      if (key === undefined) return undefined;
      const active = prefetched.get(key);
      if (active !== undefined) {
        active.adopted = true;
        return active;
      }
      const completed = cached.get(key);
      if (completed !== undefined) {
        cached.delete(key);
        if (Date.now() < completed.expiresAt) return completed;
      }
      return undefined;
    },
    prefetch(destination: URL, owner: object): Promise<void> {
      const key = keyFor(destination);
      const environment = getEnvironment();
      if (key === undefined || environment?.prefetch === undefined) {
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
      const cancelled = new Promise<ReactNavigationLoadResult>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }), { once: true });
      });
      const entry: PendingPrefetch = {
        controller,
        owners: new Set([owner]),
        promise: Promise.race([environment.prefetch(destination.href, controller.signal), cancelled]),
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
    cancel(destination: URL, owner: object): void {
      const key = keyFor(destination);
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
  };
}
