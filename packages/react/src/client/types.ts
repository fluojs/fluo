import type { ReactNode } from 'react';
import type { ReactPageMetadata } from '../page-metadata.js';
import type { ReactNavigationContracts, ReactNavigationFailureReason, ReactNavigationModules } from './navigation-payload.js';
import type { ReactSessionChange } from '../form-result.js';

/** Provider-local approval state; epoch labels are not credentials or identities. */
export type ReactSessionSnapshot = {
  readonly epoch: string;
  readonly generation: number;
  readonly status: 'approved' | 'pending' | 'signed-out' | 'forbidden';
};

/** Explicit session and fresh HTTP auth rejection context, without response bodies. */
export type ReactSessionContext = {
  readonly epoch: string;
  readonly reason: ReactSessionChange['reason'] | 'unauthorized' | 'forbidden';
  readonly destination: string;
};

/** App policy cannot preserve revoked content; a document exit is validated same-origin. */
export type ReactSessionDecision = 'refresh' | 'signed-out' | 'forbidden' | { readonly document: string };

/** Session policy runs only after old approval and operation ownership are revoked. */
export type ReactSessionPolicy = (context: ReactSessionContext, signal: AbortSignal) =>
  ReactSessionDecision | Promise<ReactSessionDecision>;

/** Initial nonsecret application epoch and optional authentication UI policy. */
export type ReactSessionOptions = {
  readonly epoch: string;
  readonly policy?: ReactSessionPolicy;
};

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
  readonly type: ReactNavigationType;
};

/** Outcome of a current-page refresh; complete means store commit, not browser paint. */
export type ReactRevalidationResult =
  | { readonly status: 'complete' }
  | { readonly status: 'error'; readonly failure: ReactNavigationFailure }
  | { readonly status: 'cancelled' }
  | { readonly status: 'document' };

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
  readonly session?: ReactSessionSnapshot;
  readonly hash: string;
  readonly metadata?: ReactPageMetadata;
  readonly navigation: ReactNavigationSnapshot;
  readonly params: Readonly<Record<string, string>>;
  readonly pathname: string;
  readonly searchParams: ReactReadonlySearchParams;
  readonly url: string;
};

/** Input used to create an immutable route snapshot at the HTTP application boundary. */
export type ReactRouteSnapshotInput = {
  readonly metadata?: ReactPageMetadata;
  readonly params?: Readonly<Record<string, string>>;
  readonly url: string | URL;
};

/** Browser navigation operations exposed by `useRouter()`. */
export interface ReactRouter {
  /**
   * Revoke old page approval and work before applying explicit application session policy.
   *
   * @param change Application-issued epoch and login/logout/permissions reason.
   * @returns Fresh approval, safe auth UI settlement, cancellation or initiated document exit.
   */
  sessionChanged(change: ReactSessionChange): Promise<ReactRevalidationResult>;
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
  /** Revalidate the current page through fresh HTTP approval, or initiate a document reload. */
  refresh(): Promise<ReactRevalidationResult>;
  /** Replace with an HTTP-approved page softly, or replace the full document on fallback. */
  replace(href: string | URL): void;
}

/** Props for the request-scoped client router state provider. */
export type ReactClientRouterProviderProps = {
  readonly session?: ReactSessionOptions;
  readonly children?: ReactNode | ((destination: ReactNode | null) => ReactNode);
  readonly initialSnapshot: ReactRouteSnapshot;
  /** Build-produced importers for HTTP-approved soft destinations. */
  readonly navigationModules?: ReactNavigationModules;
  /** Generated props decoders shared by initial transfer and negotiated destinations. */
  readonly navigationContracts?: ReactNavigationContracts;
  /** Identity of the manifest that produced these importers and the initial document. */
  readonly navigationBuildId?: string;
  /** Opt in to preserving the last approved page on selected failed navigation requests. */
  readonly failurePolicy?: ReactNavigationFailurePolicy;
  /** Application-managed auth/session epoch; omitted means prefetch is disabled. */
  readonly prefetchScope?: string;
};
