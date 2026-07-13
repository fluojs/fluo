import type { ReactNode } from 'react';

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
  readonly status: ReactNavigationStatus;
  readonly type: ReactNavigationType | null;
};

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
  /** Start same-origin full-document navigation and add a history entry. */
  push(href: string | URL): void;
  /** Revalidate the current page with a full-document reload. */
  refresh(): void;
  /** Start same-origin full-document navigation and replace the current history entry. */
  replace(href: string | URL): void;
}

/** Props for the request-scoped client router state provider. */
export type ReactClientRouterProviderProps = {
  readonly children?: ReactNode;
  readonly initialSnapshot: ReactRouteSnapshot;
};
