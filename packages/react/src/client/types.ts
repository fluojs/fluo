import type { ReactNode } from 'react';
import type { ReactNavigationFailureReason, ReactNavigationModules } from './navigation-payload.js';

/** Navigation methods that can change or revalidate the active browser document. */
export type ReactNavigationType = 'push' | 'replace' | 'back' | 'refresh';

/** Observable lifecycle states for HTTP-first client navigation. */
export type ReactNavigationStatus =
  | 'idle'
  | 'navigating'
  | 'refreshing'
  | 'complete'
  | 'error'
  | 'skipped';

/** Immutable navigation lifecycle information exposed to hydrated components. */
export type ReactNavigationSnapshot = {
  readonly destination?: string;
  readonly failure?: ReactNavigationFailure;
  readonly status: ReactNavigationStatus;
  readonly type: ReactNavigationType | null;
};

/** Safe navigation context; destination is a pathname, never query, response, or credentials. */
export type ReactNavigationFailure = {
  readonly destination: string;
  readonly reason: ReactNavigationFailureReason | 'application-error';
  readonly type: 'push' | 'replace' | 'back';
};

/** An opt-in decision made before a rejected soft load starts document navigation. */
export type ReactNavigationFailurePolicy = (failure: ReactNavigationFailure) =>
  'preserve' | 'document' | Promise<'preserve' | 'document'>;

/** Read-only URL search parameter surface returned by `useSearchParams()`. */
export interface ReactReadonlySearchParams extends Iterable<[string, string]> {
  /** Number of search parameter entries, including duplicate keys. */
  readonly size: number;
  /** Iterate over search parameter entries in source order. */
  entries(): URLSearchParamsIterator<[string, string]>;
  /** Iterate over each search parameter pair in source order. */
  forEach(callback: (value: string, key: string, searchParams: ReactReadonlySearchParams) => void): void;
  /** Read the first value for a search parameter key. */
  get(name: string): string | null;
  /** Read every value for a search parameter key. */
  getAll(name: string): string[];
  /** Check whether a search parameter key, optionally with one value, exists. */
  has(name: string, value?: string): boolean;
  /** Iterate over search parameter keys in source order. */
  keys(): URLSearchParamsIterator<string>;
  /** Serialize the search parameter snapshot without the leading question mark. */
  toString(): string;
  /** Iterate over search parameter values in source order. */
  values(): URLSearchParamsIterator<string>;
}

/** HTTP-owned route state shared between server rendering and client hydration. */
export type ReactRouteSnapshot = {
  readonly hash: string;
  readonly navigation: ReactNavigationSnapshot;
  readonly params: Readonly<Record<string, string>>;
  readonly pathname: string;
  readonly searchParams: ReactReadonlySearchParams;
  readonly url: string;
};

/** Input used to create an immutable route snapshot at the HTTP application boundary. */
export type ReactRouteSnapshotInput = {
  readonly params?: Readonly<Record<string, string>>;
  readonly url: string | URL;
};

/** Browser navigation operations exposed by `useRouter()`. */
export interface ReactRouter {
  /** Delegate traversal to browser history semantics. */
  back(): void;
  /**
   * Discard completed prefetch entries and abort unconsumed pending work after auth or mutation.
   *
   * Canceling an in-flight soft navigation settles `useNavigation()` to idle over the retained
   * committed route; no history entry is written and no document fallback starts.
   */
  invalidate(): void;
  /** Load an HTTP-approved page softly, or navigate the full document on fallback. */
  push(href: string | URL): void;
  /** Retry the last retained failure with a new uncached, credentialed HTTP request. */
  retry(): void;
  /** Explicitly load the failed destination as an ordinary HTTP document. */
  openDocument(): void;
  /** Revalidate the current page with a full-document reload. */
  refresh(): void;
  /** Replace with an HTTP-approved page softly, or replace the full document on fallback. */
  replace(href: string | URL): void;
}

/** Props for the request-scoped client router state provider. */
export type ReactClientRouterProviderProps = {
  readonly children?: ReactNode | ((destination: ReactNode | null) => ReactNode);
  readonly initialSnapshot: ReactRouteSnapshot;
  /** Build-produced importers for HTTP-approved soft destinations. */
  readonly navigationModules?: ReactNavigationModules;
  /** Identity of the manifest that produced these importers and the initial document. */
  readonly navigationBuildId?: string;
  /** Opt in to preserving the last approved page on selected failed navigation requests. */
  readonly failurePolicy?: ReactNavigationFailurePolicy;
  /** Application-managed auth/session epoch; omitted means prefetch is disabled. */
  readonly prefetchScope?: string;
};
