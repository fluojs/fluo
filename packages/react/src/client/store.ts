import { createElement, type ReactElement } from 'react';
import { parseReactSessionChange, type ReactSessionChange } from '../form-result.js';
import { ReactClientNavigationError } from './errors.js';
import type { ClientFormStore } from './form-store.js';
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
  ReactSessionContext,
  ReactSessionDecision,
  ReactSessionOptions,
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
  /** Internal shared session ownership seam for later independent interactions. */
  readonly sessionLease: () => { readonly generation: number; readonly signal: AbortSignal; readonly current: () => boolean; readonly release: () => void };
  readonly applyFormSession: (change: ReactSessionChange, origin: ClientFormStore) => Promise<boolean>;
  readonly rejectFormAuth: (reason: 'unauthorized' | 'forbidden', origin: ClientFormStore) => Promise<void>;
  readonly releaseFormSession: (origin: ClientFormStore) => void;
  readonly forms: Map<string, ClientFormStore>;
  readonly invalidateBackground: () => void;
  readonly approveBackground: (signal: AbortSignal, origin: ClientFormStore) => Promise<ReactRevalidationResult>;
  readonly approveForm: (destination: string, followUp: 'refresh' | 'navigate', signal: AbortSignal, origin: ClientFormStore) => Promise<ReactRevalidationResult>;
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
 * @param sessionOptions Initial application epoch and optional post-revocation policy.
 * @returns A store whose router delegates rendering and validation to browser HTTP navigation.
 */
export function createClientNavigationStore(initialSnapshot: ReactRouteSnapshot, sessionOptions?: ReactSessionOptions): ClientNavigationStore {
  if (sessionOptions !== undefined && sessionOptions.epoch.trim().length === 0) {
    throw new TypeError('An initial session epoch must be nonempty.');
  }
  let environment: ClientNavigationEnvironment | null = null;
  let snapshot: ReactRouteSnapshot = sessionOptions === undefined ? initialSnapshot
    : Object.freeze({ ...initialSnapshot, session: Object.freeze({ epoch: sessionOptions.epoch, generation: 0, status: 'approved' as const }) });
  let sessionGeneration = 0;
  let sessionActivated = sessionOptions !== undefined || initialSnapshot.session !== undefined;
  let barrierActive = false;
  let sessionPolicyController: AbortController | null = null;
  let sessionPolicyOrigin: ClientFormStore | undefined;
  let sessionPolicyOrigins = new Set<ClientFormStore>();
  const sessionLeases = new Set<AbortController>();
  let destinationElement: ReactElement | null = null;
  let pending: {
    readonly controller: AbortController;
    readonly href: string;
    readonly type: DocumentNavigationType | 'back' | 'refresh';
    readonly origin?: ClientFormStore;
    readonly backgroundOrigins?: ReadonlySet<ClientFormStore>;
  } | null = null;
  let failed: { readonly href: string; readonly type: DocumentNavigationType | 'back' | 'refresh'; readonly index: number | null } | null = null;
  let settleRefresh: ((result: ReactRevalidationResult) => void) | null = null;
  let approvedIndex = 0;
  let restoringIndex: number | null = null;
  let invalidatedTraversal = false;
  let deferredRefresh = false;
  let deferredBack = false;
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
  const forms = new Map<string, ClientFormStore>();
  const continuations = new Set<ClientFormStore>();
  const cancelForms = (clear = false, all = false): void => {
    const old = [...forms.values()].filter((form) => all || form.mode !== 'background');
    if (clear) for (const [key, form] of forms) {
      if (all || form.mode !== 'background') forms.delete(key);
    }
    for (const form of old) form.cancel();
  };
  let backgroundRevision = 0;
  let backgroundApproval: {
    readonly revision: number;
    readonly controller: AbortController;
    readonly promise: Promise<ReactRevalidationResult>;
    readonly waiters: Set<object>;
    readonly origins: Set<ClientFormStore>;
  } | null = null;
  const releaseSessionLeases = (): void => {
    const old = [...sessionLeases];
    sessionLeases.clear();
    sessionGeneration++;
    for (const form of continuations) form.revoke();
    continuations.clear();
    if (snapshot.session !== undefined) {
      snapshot = Object.freeze({ ...snapshot, session: Object.freeze({ ...snapshot.session, generation: sessionGeneration }) });
    }
    for (const controller of old) controller.abort();
  };

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
    metadata?: ReactRouteSnapshot['metadata'],
  ): ReactRouteSnapshot => {
    const pathname = new URL(href).pathname;
    const next = createSnapshotFromHref(
      href,
      params ?? (pathname === snapshot.pathname ? snapshot.params : {}),
      navigation,
    );
    const approvedMetadata = params === undefined ? snapshot.metadata : metadata;
    return Object.freeze({ ...next,
      ...(approvedMetadata === undefined ? {} : { metadata: approvedMetadata }),
      ...(snapshot.session === undefined ? {} : { session: snapshot.session }),
    });
  };

  const cancelPending = (): void => {
    generation += 1;
    const old = pending;
    const settle = settleRefresh;
    const policy = sessionPolicyController;
    sessionPolicyController = null;
    sessionPolicyOrigin = undefined;
    sessionPolicyOrigins.clear();
    pending = null;
    settleRefresh = null;
    settle?.({ status: 'cancelled' });
    policy?.abort();
    old?.controller.abort();
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
    return `${sessionGeneration}:${environment.prefetchScope}\0${destination.origin}${destination.pathname}${destination.search}\0v2`;
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
    deferredRefresh = false;
    deferredBack = false;
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

  const applySession = async (
    context: ReactSessionContext,
    origin?: ClientFormStore,
    documentHref?: string,
    origins?: ReadonlySet<ClientFormStore>,
  ): Promise<ReactSessionDecision | undefined> => {
    const authRejection = context.reason === 'unauthorized' || context.reason === 'forbidden';
    const legacyAuthExit = !sessionActivated && authRejection;
    if (!authRejection) sessionActivated = true;
    // Close approval and detach every old owner before invoking abort listeners or subscribers.
    barrierActive = true;
    const expected = ++sessionGeneration;
    generation++;
    const oldPending = pending;
    const oldSettle = settleRefresh;
    const oldPolicy = sessionPolicyController;
    const oldPrefetch = [...prefetched.values()];
    const oldLeases = [...sessionLeases];
    const oldForms = new Set([...forms.values(), ...continuations]);
    const savedOrigin = origin?.getSnapshot().mutation?.status === 'saved' ? origin : undefined;
    const savedOrigins = new Set([...origins ?? [], ...savedOrigin === undefined ? [] : [savedOrigin]]
      .filter((form) => form.getSnapshot().mutation?.status === 'saved'));
    const originEntries = [...forms.entries()].filter(([, form]) => savedOrigins.has(form));
    pending = null;
    settleRefresh = null;
    failed = null;
    deferredNavigation = null;
    deferredRefresh = false;
    deferredBack = false;
    restoringIndex = null;
    invalidatedTraversal = false;
    prefetched.clear();
    cached.clear();
    sessionLeases.clear();
    forms.clear();
    continuations.clear();
    for (const form of savedOrigins) continuations.add(form);
    for (const [key, form] of originEntries) forms.set(key, form);
    destinationElement = null;
    const controller = new AbortController();
    sessionPolicyController = controller;
    sessionPolicyOrigin = savedOrigin;
    sessionPolicyOrigins = new Set(savedOrigins);
    const cancelled = new Promise<undefined>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(undefined), { once: true });
    });
    snapshot = Object.freeze({
      ...createSnapshotFromHref(environment?.currentHref() ?? new URL(snapshot.url, 'https://fluo.invalid').href, {}, IDLE_NAVIGATION),
      session: Object.freeze({ epoch: context.epoch, generation: expected,
        status: context.reason === 'logout' || context.reason === 'unauthorized' ? 'signed-out' as const
          : context.reason === 'forbidden' ? 'forbidden' as const : 'pending' as const }),
    });
    oldSettle?.({ status: 'cancelled' });
    oldPolicy?.abort();
    oldPending?.controller.abort();
    for (const entry of oldPrefetch) entry.controller.abort();
    for (const lease of oldLeases) lease.abort();
    for (const form of oldForms) form.revoke(savedOrigins.has(form));
    if (savedOrigin === undefined) sessionPolicyOrigin = origin;
    barrierActive = false;
    notify();
    if (expected !== sessionGeneration || controller.signal.aborted) return undefined;
    let decision: ReactSessionDecision | undefined;
    try {
      decision = await Promise.race([
        Promise.resolve(sessionOptions?.policy === undefined
          ? legacyAuthExit ? { document: documentHref ?? requireEnvironment().currentHref() }
            : context.reason === 'logout' || context.reason === 'unauthorized' ? 'signed-out'
            : context.reason === 'forbidden' ? 'forbidden' : 'refresh'
          : sessionOptions.policy(context, controller.signal)),
        cancelled,
      ]);
    } catch {
      if (expected !== sessionGeneration) return undefined;
      console.error('React session policy rejected.');
      decision = context.reason === 'forbidden' ? 'forbidden' : 'signed-out';
    }
    if (expected !== sessionGeneration || controller.signal.aborted || decision === undefined) return undefined;
    sessionPolicyController = null;
    sessionPolicyOrigin = undefined;
    sessionPolicyOrigins.clear();
    const completedGeneration = generation;
    if (typeof decision === 'object') {
      const browser = requireEnvironment();
      const document = new URL(decision.document, browser.currentHref());
      if (!isHttpProtocol(document.protocol) || document.origin !== new URL(browser.currentHref()).origin
        || document.username !== '' || document.password !== '') {
        throw new TypeError('A session document exit must be a same-origin HTTP document.');
      }
      browser.assign(document.href);
    } else if (decision !== 'refresh') {
      publish(Object.freeze({ ...snapshot, session: Object.freeze({
        epoch: context.epoch, generation: expected, status: decision,
      }) }));
    }
    return expected === sessionGeneration && completedGeneration === generation ? decision : undefined;
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
    formApproval = false,
    formOrigin?: ClientFormStore,
    expectedBackgroundRevision?: number,
    backgroundOrigins?: ReadonlySet<ClientFormStore>,
  ): void => {
    const load = browser.load;
    if (load === undefined) {
      return;
    }
    const controller = adopted && 'controller' in adopted ? adopted.controller : new AbortController();
    const expectedHref = browser.currentHref();
    pending = { controller, href: destination.href, type,
      ...(formOrigin === undefined ? {} : { origin: formOrigin }),
      ...(backgroundOrigins === undefined ? {} : { backgroundOrigins }),
    };
    const requestGeneration = generation;
    const refreshResolver = settleRefresh;
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
      if (expectedBackgroundRevision !== undefined && expectedBackgroundRevision !== backgroundRevision) {
        if (pending?.controller === controller) pending = null;
        completeRefresh({ status: 'cancelled' });
        return;
      }
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
        if (result.reason === 'unauthorized' || result.reason === 'forbidden') {
          const failure: ReactNavigationFailure = Object.freeze({
            destination: destination.pathname, reason: result.reason, type,
          });
          pending = null;
          // Keep this caller's settlement out of the barrier's old-operation cancellation.
          if (settleRefresh === refreshResolver) settleRefresh = null;
          const expectedSession = sessionGeneration + 1;
          const decision = await applySession({
            epoch: snapshot.session?.epoch ?? sessionOptions?.epoch ?? browser.prefetchScope ?? 'initial',
            reason: result.reason, destination: destination.pathname,
          }, formOrigin, destination.href, backgroundOrigins);
          if (decision === undefined || expectedSession !== sessionGeneration) {
            refreshResolver?.({ status: 'cancelled' });
            return;
          }
          if (typeof decision === 'object') {
            refreshResolver?.({ status: 'document' });
            return;
          }
          if (decision === 'refresh') {
            settleRefresh = refreshResolver;
            loadAndCommit(browser, destination, type, undefined, formApproval, formOrigin,
              expectedBackgroundRevision, backgroundOrigins);
            publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot(
              type === 'refresh' ? 'refreshing' : 'navigating', type, toSnapshotUrl(destination.href),
            )));
            return;
          }
          refreshResolver?.({ status: 'error', failure });
          failed = { href: destination.href, type, index: browser.historyIndex?.() ?? null };
          publish(createSnapshotWithNavigation(snapshot, {
            ...createNavigationSnapshot('error', type, toSnapshotUrl(destination.href)), failure,
          }));
          return;
        }
        let failure: ReactNavigationFailure = Object.freeze({
          destination: destination.pathname,
          reason: result.reason,
          type,
        });
        let decision: 'preserve' | 'document' = formApproval ? 'preserve' : 'document';
        try {
          if (!formApproval && browser.failurePolicy !== undefined) {
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
          completeRefresh({ status: 'document' });
          browser.replace(destination.href);
        } else {
          completeRefresh({ status: 'document' });
          browser.assign(type === 'back' ? currentHref : destination.href);
        }
        return;
      }
      pending = null;
      failed = null;
      if (snapshot.session !== undefined) {
        snapshot = Object.freeze({ ...snapshot, session: Object.freeze({ ...snapshot.session, status: 'approved' as const }) });
      }
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
      if (type === 'refresh' && !formApproval) cancelForms(true);
      destinationElement = createElement(result.component, {
        ...result.payload.destination.props,
        key: formApproval && type === 'refresh'
          ? destinationElement?.key ?? null : `${requestGeneration}:${result.payload.url}`,
      });
      completeRefresh({ status: 'complete' });
      publish(createSnapshotForHref(
        confirmedHref,
        createNavigationSnapshot('complete', type, toSnapshotUrl(confirmedHref)),
        result.payload.params,
        result.payload.metadata,
      ));
    })();
  };

  const navigateDocument = (href: string | URL, type: DocumentNavigationType, fromPrefetch = false): void => {
    if (barrierActive) return;
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
      if (deferredRefresh) {
        cancelPending();
        deferredRefresh = false;
      }
      deferredBack = false;
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
    if ((destinationUrl === snapshot.url && pending === null
      && (snapshot.session === undefined || snapshot.session.status === 'approved')) || pending?.href === destination.href) {
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
    cancelForms();
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
    async sessionChanged(change: ReactSessionChange): Promise<ReactRevalidationResult> {
      const parsed = parseReactSessionChange(change);
      if (parsed === undefined) throw new TypeError('A session notification must carry a nonempty epoch and explicit reason.');
      const expectedSession = sessionGeneration + 1;
      const decision = await applySession({ ...parsed, destination: snapshot.pathname });
      if (decision === undefined || expectedSession !== sessionGeneration) return { status: 'cancelled' };
      if (typeof decision === 'object') return { status: 'document' };
      return decision === 'refresh' ? router.refresh() : { status: 'complete' };
    },
    back(): void {
      if (barrierActive) return;
      const browser = requireEnvironment();
      cancelForms();
      cancelPending();
      deferredRefresh = false;
      deferredNavigation = null;
      discardPrefetches();
      const deferBack = restoringIndex !== null;
      deferredBack = deferBack;
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('navigating', 'back')));
      if (deferBack) {
        return;
      }
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
      if (barrierActive) return Promise.resolve({ status: 'cancelled' });
      const browser = requireEnvironment();
      cancelForms();
      const unapprovedTraversal = (pending?.type === 'back' || failed?.type === 'back'
        || restoringIndex !== null) && toSnapshotUrl(browser.currentHref()) !== snapshot.url;
      const activatedIndex = browser.historyIndex?.();
      cancelPending();
      failed = null;
      deferredBack = false;
      deferredNavigation = null;
      discardPrefetches();
      if (unapprovedTraversal && restoringIndex === null
        && (activatedIndex === null || activatedIndex === undefined || browser.go === undefined)) {
        browser.replace(browser.currentHref());
        return Promise.resolve({ status: 'document' });
      }
      if (browser.load === undefined || browser.pushState === undefined || browser.replaceState === undefined) {
        publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('refreshing', 'refresh')));
        browser.reload();
        return Promise.resolve({ status: 'document' });
      }
      const refreshing = new Promise<ReactRevalidationResult>((resolve) => {
        settleRefresh = resolve;
      });
      if (unapprovedTraversal || restoringIndex !== null) {
        const restoreFrom = restoringIndex === null ? activatedIndex : null;
        if (restoreFrom !== null && restoreFrom !== undefined) {
          restoringIndex = approvedIndex;
        }
        deferredRefresh = true;
        publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('refreshing', 'refresh')));
        if (restoreFrom !== null && restoreFrom !== undefined) {
          browser.go?.(approvedIndex - restoreFrom);
        }
        return refreshing;
      }
      loadAndCommit(browser, new URL(browser.currentHref()), 'refresh');
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot('refreshing', 'refresh')));
      return refreshing;
    },
    replace(href: string | URL): void {
      navigateDocument(href, 'replace');
    },
  });

  return {
    sessionLease() {
      const expected = sessionGeneration;
      const controller = new AbortController();
      if (barrierActive) controller.abort();
      else sessionLeases.add(controller);
      return { generation: expected, signal: controller.signal,
        current: () => !controller.signal.aborted && expected === sessionGeneration,
        release: () => { sessionLeases.delete(controller); },
      };
    },
    async applyFormSession(change, origin) {
      const expectedSession = sessionGeneration + 1;
      const decision = await applySession({ ...change, destination: snapshot.pathname }, origin);
      return decision === 'refresh' && expectedSession === sessionGeneration;
    },
    async rejectFormAuth(reason, origin) {
      const expectedSession = sessionGeneration + 1;
      const decision = await applySession({ epoch: snapshot.session?.epoch ?? sessionOptions?.epoch ?? 'initial',
        reason, destination: snapshot.pathname }, origin);
      if (expectedSession === sessionGeneration && decision === 'refresh') await router.refresh();
      continuations.delete(origin);
    },
    releaseFormSession: (origin) => {
      continuations.delete(origin);
      const unownedPolicy = sessionPolicyOrigin !== origin && !sessionPolicyOrigins.has(origin);
      sessionPolicyOrigins.delete(origin);
      const lastPolicyOwner = !unownedPolicy && (sessionPolicyOrigin === origin || sessionPolicyOrigins.size === 0);
      const controller = lastPolicyOwner ? sessionPolicyController : null;
      if (lastPolicyOwner) {
        sessionPolicyController = null;
        sessionPolicyOrigin = undefined;
        sessionPolicyOrigins.clear();
      }
      const background = backgroundApproval;
      const lastBackgroundOwner = background?.origins.delete(origin) === true && background.origins.size === 0;
      if (lastBackgroundOwner && backgroundApproval === background) backgroundApproval = null;
      if (pending?.origin === origin) {
        cancelPending();
        publish(createSnapshotWithNavigation(snapshot, IDLE_NAVIGATION));
      }
      if (lastBackgroundOwner) background.controller.abort();
      controller?.abort();
    },
    forms,
    approveForm(href, followUp, signal, origin) {
      if (signal.aborted || barrierActive) return Promise.resolve({ status: 'cancelled' });
      const browser = requireEnvironment();
      const destination = resolveDestination(href);
      const current = new URL(browser.currentHref());
      if (followUp === 'refresh' && (destination.pathname !== current.pathname || destination.search !== current.search)) {
        return Promise.resolve({ status: 'error', failure: {
          destination: destination.pathname, reason: 'unsupported-destination', type: 'refresh',
        } });
      }
      if (followUp === 'navigate') {
        for (const other of forms.values()) {
          if (other !== origin && other.mode !== 'background') other.cancel();
        }
      }
      cancelPending();
      cached.clear();
      discardPrefetches();
      if (browser.load === undefined || browser.pushState === undefined || browser.replaceState === undefined) {
        return Promise.resolve({ status: 'error', failure: {
          destination: destination.pathname, reason: 'unavailable', type: followUp === 'refresh' ? 'refresh' : 'push',
        } });
      }
      const completed = new Promise<ReactRevalidationResult>((resolve) => { settleRefresh = resolve; });
      const type = followUp === 'refresh' ? 'refresh' : 'push';
      loadAndCommit(browser, destination, type, undefined, true, origin);
      const approvalGeneration = generation;
      const abort = (): void => {
        if (generation !== approvalGeneration) return;
        cancelPending();
        publish(createSnapshotWithNavigation(snapshot, IDLE_NAVIGATION));
      };
      signal.addEventListener('abort', abort, { once: true });
      publish(createSnapshotWithNavigation(snapshot, createNavigationSnapshot(
        type === 'refresh' ? 'refreshing' : 'navigating', type, toSnapshotUrl(destination.href),
      )));
      return completed.finally(() => signal.removeEventListener('abort', abort));
    },
    invalidateBackground() {
      backgroundRevision++;
      cached.clear();
      discardPrefetches();
      // A write never cancels a newer user navigation, only our own stale approval.
      const old = backgroundApproval;
      backgroundApproval = null;
      old?.controller.abort();
    },
    async approveBackground(signal, origin) {
      if (signal.aborted || barrierActive || environment === null) return { status: 'cancelled' };
      const expectedSession = sessionGeneration;
      const expectedUrl = snapshot.url.split('#', 1)[0];
      // Already-dispatched sibling writes share one latest read after their local settlement.
      // Subscribe before checking; cancellation never waits for an uncooperative writer.
      const writers = [...forms.values()].filter((form) => form.isWriting());
      if (writers.length > 0) await new Promise<void>((resolve) => {
        const subscriptions: (() => void)[] = [];
        const finish = (): void => {
          if (!signal.aborted && writers.some((form) => form.isWriting())) return;
          for (const unsubscribe of subscriptions) unsubscribe();
          signal.removeEventListener('abort', finish);
          resolve();
        };
        for (const writer of writers) subscriptions.push(writer.subscribe(finish));
        signal.addEventListener('abort', finish, { once: true });
        finish();
      });
      // Combine acknowledgements delivered in the same completion turn.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      if (signal.aborted || expectedSession !== sessionGeneration || environment === null
        || snapshot.url.split('#', 1)[0] !== expectedUrl) return { status: 'cancelled' };
      let approval = backgroundApproval;
      if (approval === null) {
        const browser = environment;
        if (pending !== null || toSnapshotUrl(browser.currentHref()).split('#', 1)[0] !== expectedUrl) {
          return { status: 'cancelled' };
        }
        if (browser.load === undefined) return { status: 'error', failure: {
          destination: snapshot.pathname, reason: 'unavailable', type: 'refresh',
        } };
        const controller = new AbortController();
        const revision = backgroundRevision;
        const promise = new Promise<ReactRevalidationResult>((resolve) => { settleRefresh = resolve; });
        const origins = new Set([origin]);
        approval = { revision, controller, promise, waiters: new Set(), origins };
        backgroundApproval = approval;
        const currentApproval = approval;
        const abort = (): void => {
          if (pending?.backgroundOrigins === origins) cancelPending();
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        loadAndCommit(browser, new URL(browser.currentHref()), 'refresh', undefined, true, undefined, revision, origins);
        void promise.finally(() => {
          controller.signal.removeEventListener('abort', abort);
          if (backgroundApproval === currentApproval) backgroundApproval = null;
        });
      }
      // A waiter may cancel without cancelling another form's shared read.
      if (signal.aborted) {
        this.releaseFormSession(origin);
        return { status: 'cancelled' };
      }
      const shared = approval;
      shared.origins.add(origin);
      const waiter = {};
      shared.waiters.add(waiter);
      let detach = () => {};
      const cancelled = new Promise<ReactRevalidationResult>((resolve) => {
        const abort = (): void => {
          this.releaseFormSession(origin);
          resolve({ status: 'cancelled' });
        };
        signal.addEventListener('abort', abort, { once: true });
        detach = () => signal.removeEventListener('abort', abort);
      });
      try { return await Promise.race([shared.promise, cancelled]); }
      finally {
        detach();
        shared.waiters.delete(waiter);
        if (shared.waiters.size === 0 && backgroundApproval === shared) shared.controller.abort();
      }
    },
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
      if (barrierActive || environment === null || !this.canHandleLink(href)) {
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
      const cancelled = new Promise<ReactNavigationLoadResult>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }), { once: true });
      });
      const entry = {
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
      if (environment !== null) {
        releaseSessionLeases();
        cancelForms(true, true);
      }
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
          cancelForms();
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
            if (deferredRefresh) {
              deferredRefresh = false;
              loadAndCommit(nextEnvironment, new URL(nextEnvironment.currentHref()), 'refresh');
              return true;
            }
            if (deferredBack) {
              deferredBack = false;
              nextEnvironment.back();
              return true;
            }
            if (deferred !== null) {
              navigateDocument(deferred.destination, deferred.type, deferred.fromPrefetch);
            }
            return true;
          }
          restoringIndex = null;
          invalidatedTraversal = false;
          deferredBack = false;
          deferredNavigation = null;
          if (deferredRefresh) {
            deferredRefresh = false;
            settleRefresh?.({ status: 'document' });
            settleRefresh = null;
            nextEnvironment.replace(nextEnvironment.currentHref());
            return true;
          }
          return false;
        },
        loadAndCommit,
        publish,
      });
      notify();

      return () => {
        unsubscribe();
        if (environment === nextEnvironment) {
          releaseSessionLeases();
          cancelForms(true, true);
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
