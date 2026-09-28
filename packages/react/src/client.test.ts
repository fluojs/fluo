import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ClientNavigationEnvironment,
  createClientNavigationStore,
} from './client/store.js';
import {
  createReactRouteSnapshot,
  Link,
  ReactClientRouterProvider,
  type ReactNavigationLoadResult,
  useNavigation,
  useParams,
  usePathname,
  useRouter,
  useRouterState,
  useSearchParams,
} from './client.js';

function createEnvironment(href = 'https://example.test/products/sku-42?preview=true') {
  let currentHref = href;
  const listeners = new Set<(eventType: 'hashchange' | 'popstate') => void>();
  const updateHref = (nextHref: string): void => {
    const previousUrl = new URL(currentHref);
    const nextUrl = new URL(nextHref);
    currentHref = nextHref;
    if (
      previousUrl.origin === nextUrl.origin &&
      previousUrl.pathname === nextUrl.pathname &&
      previousUrl.search === nextUrl.search &&
      previousUrl.hash !== nextUrl.hash
    ) {
      for (const listener of listeners) {
        listener('hashchange');
      }
    }
  };
  const assign = vi.fn(updateHref);
  const replace = vi.fn(updateHref);
  const back = vi.fn();
  const reload = vi.fn();
  const environment: ClientNavigationEnvironment = {
    assign,
    back,
    currentHref: () => currentHref,
    reload,
    replace,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    assign,
    back,
    changeFragment: updateHref,
    environment,
    navigateFromHistory(nextHref: string) {
      const previousHash = new URL(currentHref).hash;
      currentHref = nextHref;
      for (const listener of listeners) {
        listener('popstate');
      }
      if (previousHash !== new URL(nextHref).hash) {
        for (const listener of listeners) {
          listener('hashchange');
        }
      }
    },
    reload,
    replace,
  };
}

function approvedPrefetch(href: string, expiresAt = Date.now() + 15_000): ReactNavigationLoadResult {
  const url = new URL(href);
  const sku = url.pathname.split('/').at(-1) ?? '';
  return {
    ok: true,
    payload: {
      version: 1,
      url: `${url.pathname}${url.search}`,
      params: { sku },
      destination: { module: './navigation-product.ts', props: { sku } },
    },
    component: () => null,
    prefetchExpiresAt: expiresAt,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function RouteStateProbe() {
  const navigation = useNavigation();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const routerState = useRouterState();
  const searchParams = useSearchParams();

  return createElement(
    'output',
    {
      'data-navigation': navigation.status,
      'data-pathname': pathname,
      'data-router': Object.keys(router).sort().join(','),
      'data-url': routerState.url,
    },
    `${params.sku ?? 'missing'}:${searchParams.get('preview') ?? 'missing'}`,
  );
}

describe('@fluojs/react/client', () => {
  it('consumes an approved prefetch once before requiring another HTTP approval', async () => {
    // Given: a completed public prefetch and a connected browser history.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn() });
    const owner = {};
    await store.prefetch('/products/sku-84', owner);
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-84') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: the eligible Link uses the approved entry, leaves, and revisits its URL.
    store.navigatePrefetchedLink('/products/sku-84');
    await completed;
    const elsewhere = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-126') {
          unsubscribe();
          resolve();
        }
      });
    });
    store.router.push('/products/sku-126');
    await elsewhere;
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: the first activation needs no second GET, but consumed entries are not reusable.
    expect(prefetch).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenCalledWith('https://example.test/products/sku-84');
    expect(store.getSnapshot().params).toEqual({ sku: 'sku-126' });
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('partitions prefetched queries while sharing a pathname with fragment variants', async () => {
    // Given: a public entry for one precise search query.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn() });
    await store.prefetch('/products/sku-84?preview=false#first', {});
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-84?preview=false#second') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: a Link clicks the same query with another fragment, then the other query.
    store.navigatePrefetchedLink('/products/sku-84?preview=false#second');
    await completed;
    store.navigatePrefetchedLink('/products/sku-84?preview=true');

    // Then: the approved page follows the click fragment; another query needs fresh HTTP.
    expect(pushState).toHaveBeenCalledWith('https://example.test/products/sku-84?preview=false#second');
    expect(load).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenCalledOnce();
  });

  it('skips fragment-only, cross-origin, and non-HTTP prefetch opportunities', async () => {
    // Given: a hydrated provider with a working prefetch loader.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch });
    const owner = {};

    // When: unsupported anchors and a native fragment change offer prefetch.
    await Promise.all([
      store.prefetch('#details', owner),
      store.prefetch('https://elsewhere.test/products/sku-84', owner),
      store.prefetch('mailto:user@example.test', owner),
    ]);

    // Then: none makes an anonymous request or changes the route snapshot.
    expect(prefetch).not.toHaveBeenCalled();
    expect(store.getSnapshot().url).toBe('/products/sku-42?preview=true');
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('does not prefetch before hydration or without both scope and importers', async () => {
    // Given: a provider whose application has not supplied both opt-in prerequisites.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42' }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    const owner = {};

    // When: a Link offers the same destination at each incomplete lifecycle boundary.
    await store.prefetch('/products/sku-84', owner);
    const withoutScope = store.connect({ ...browser.environment, prefetch });
    await store.prefetch('/products/sku-84', owner);
    withoutScope();
    const withoutImporters = store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1' });
    await store.prefetch('/products/sku-84', owner);
    withoutImporters();

    // Then: there is no speculative GET or guessed route change.
    expect(prefetch).not.toHaveBeenCalled();
    expect(store.getSnapshot().url).toBe('/products/sku-42');
  });

  it('skips a fifth simultaneous prefetch instead of queuing it', async () => {
    // Given: four public requests remain active until their own cancellation signals.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const requests: { href: string; resolve: (result: ReactNavigationLoadResult) => void }[] = [];
    const prefetch = vi.fn((href: string) => new Promise<ReactNavigationLoadResult>((resolve) => {
      requests.push({ href, resolve });
    }));
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch });
    const owners = Array.from({ length: 5 }, () => ({}));

    // When: five independent Link opportunities occur without completing any response.
    const pending = owners.map((owner, index) => store.prefetch(`/products/sku-${100 + index}`, owner));

    // Then: only four network requests start; the fifth is not retained as a queue item.
    expect(prefetch).toHaveBeenCalledTimes(4);
    requests.forEach(({ href, resolve }) => {
      resolve(approvedPrefetch(href));
    });
    await Promise.all(pending);
    expect(prefetch).toHaveBeenCalledTimes(4);
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous opportunities for one destination', async () => {
    // Given: a public response held pending while two owners request the same key.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    let resolvePrefetch = (_result: ReactNavigationLoadResult) => {};
    const prefetch = vi.fn(() => new Promise<ReactNavigationLoadResult>((resolve) => {
      resolvePrefetch = resolve;
    }));
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch });
    const first = {};
    const second = {};

    // When: hover and viewport both claim one destination.
    const hovering = store.prefetch('/products/sku-84#details', first);
    const visible = store.prefetch('/products/sku-84#reviews', second);
    resolvePrefetch(approvedPrefetch('https://example.test/products/sku-84'));
    await Promise.all([hovering, visible]);

    // Then: one HTTP approval serves both claims, regardless of their fragments.
    expect(prefetch).toHaveBeenCalledOnce();
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('adopts an in-flight prefetch click without letting hover cancellation abort it', async () => {
    // Given: an in-flight public request with an abort signal and a waiting Link owner.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    let approve = (_result: ReactNavigationLoadResult) => {};
    let signal: AbortSignal | undefined;
    const prefetch = vi.fn((_href: string, nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<ReactNavigationLoadResult>((resolve) => { approve = resolve; });
    });
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn() });
    const owner = {};
    const loading = store.prefetch('/products/sku-84', owner);
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-84') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: an eligible click adopts the pending GET before pointer exit cancels its owner.
    store.navigatePrefetchedLink('/products/sku-84');
    store.cancelPrefetch('/products/sku-84', owner);
    approve(approvedPrefetch('https://example.test/products/sku-84'));
    await Promise.all([loading, completed]);

    // Then: no second GET or abort loses the adopted page or its server-owned params.
    expect(signal?.aborted).toBe(false);
    expect(prefetch).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledOnce();
    expect(store.getSnapshot().params).toEqual({ sku: 'sku-84' });
  });

  it('evicts the least recently used entry when the cache reaches 32 pages', async () => {
    // Given: one provider has completed 32 distinct public representations.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn() });
    const owner = {};
    for (let index = 0; index < 32; index++) {
      await store.prefetch(`/products/sku-${100 + index}`, owner);
    }

    // When: the oldest entry is touched before admitting a thirty-third page.
    await store.prefetch('/products/sku-100', owner);
    await store.prefetch('/products/sku-132', owner);
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-100') {
          unsubscribe();
          resolve();
        }
      });
    });
    store.navigatePrefetchedLink('/products/sku-100');
    await completed;
    store.navigatePrefetchedLink('/products/sku-101');

    // Then: the touched entry is reused while the actual least-recent entry reloads.
    expect(prefetch).toHaveBeenCalledTimes(33);
    expect(load).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith('https://example.test/products/sku-100');
  });

  it('never consumes a completed prefetch at the exact freshness deadline', async () => {
    // Given: one public result expires exactly 15 seconds after admission.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState: vi.fn(), replaceState: vi.fn() });
    await store.prefetch('/products/sku-84', {});

    // When: the eligible Link activates at the first expired millisecond.
    vi.setSystemTime(Date.now() + 15_000);
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: a fresh credentialed navigation replaces expired anonymous data.
    expect(load).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenCalledOnce();
  });

  it('cancels an unclaimed prefetch and ignores a response delivered after abort', async () => {
    // Given: the network can deliver a late approved result despite cancellation.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    let approve = (_result: ReactNavigationLoadResult) => {};
    let signal: AbortSignal | undefined;
    const prefetch = vi.fn((_href: string, nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<ReactNavigationLoadResult>((resolve) => { approve = resolve; });
    });
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn() });
    const owner = {};
    const pending = store.prefetch('/products/sku-84', owner);

    // When: the owner leaves before adoption but the network still reports success.
    store.cancelPrefetch('/products/sku-84', owner);
    approve(approvedPrefetch('https://example.test/products/sku-84'));
    await pending;
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: cancellation creates no cached entry, history commit, or document fallback.
    expect(signal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    expect(pushState).not.toHaveBeenCalled();
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('cancels pending prefetch when browser history activates a fragment', async () => {
    // Given: a public request remains pending while the browser owns fragment history.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({
      url: '/products/sku-42?preview=true',
    }));
    let approve = (_result: ReactNavigationLoadResult) => {};
    let signal: AbortSignal | undefined;
    const prefetch = vi.fn((_href: string, pendingSignal: AbortSignal) => {
      signal = pendingSignal;
      return new Promise<ReactNavigationLoadResult>((resolve) => { approve = resolve; });
    });
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    store.connect({
      ...browser.environment, prefetchScope: 'anonymous-v1',
      prefetch, load, pushState: vi.fn(), replaceState: vi.fn(),
    });
    const pending = store.prefetch('/products/sku-84', {});

    // When: a same-document fragment activates before the prefetch finishes.
    browser.changeFragment('https://example.test/products/sku-42?preview=true#details');
    approve(approvedPrefetch('https://example.test/products/sku-84'));
    await pending;
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: the stale anonymous response cannot be consumed after history activation.
    expect(signal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    expect(store.getSnapshot().hash).toBe('#details');
  });

  it('discards pending and completed prefetches when the provider disconnects', async () => {
    // Given: one completed entry and one pending entry belong to the same provider.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    let approve = (_result: ReactNavigationLoadResult) => {};
    let pendingSignal: AbortSignal | undefined;
    const prefetch = vi.fn((href: string, signal: AbortSignal) => href.endsWith('/sku-84')
      ? Promise.resolve(approvedPrefetch(href))
      : new Promise<ReactNavigationLoadResult>((resolve) => {
        pendingSignal = signal;
        approve = resolve;
      }));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    const disconnect = store.connect({
      ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn(),
    });
    await store.prefetch('/products/sku-84', {});
    const pending = store.prefetch('/products/sku-126', {});

    // When: the provider unmounts before the second network result is delivered.
    disconnect();
    approve(approvedPrefetch('https://example.test/products/sku-126'));
    await pending;
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState: vi.fn() });
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: old work was aborted and neither old page survives a new connection.
    expect(pendingSignal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('invalidates completed and pending entries at an explicit mutation boundary', async () => {
    // Given: a completed public page and another pending anonymous response.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    let approve = (_result: ReactNavigationLoadResult) => {};
    let pendingSignal: AbortSignal | undefined;
    const prefetch = vi.fn((href: string, signal: AbortSignal) => href.endsWith('/sku-84')
      ? Promise.resolve(approvedPrefetch(href))
      : new Promise<ReactNavigationLoadResult>((resolve) => {
        pendingSignal = signal;
        approve = resolve;
      }));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState: vi.fn(), replaceState: vi.fn() });
    await store.prefetch('/products/sku-84', {});
    const pending = store.prefetch('/products/sku-126', {});

    // When: the application explicitly invalidates after changing auth or page data.
    store.router.invalidate();
    approve(approvedPrefetch('https://example.test/products/sku-126'));
    await pending;
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: both generations were discarded, requiring credentialed approval.
    expect(pendingSignal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it('settles in-flight navigation to idle when invalidate cancels it', async () => {
    // Given: a committed soft page, a completed prefetch entry, and a deferred in-flight push.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    const committedPage = vi.fn(() => null);
    const approvedLoad = (href: string, page: () => null) => {
      const approved = approvedPrefetch(href);
      if (!approved.ok) {
        throw new Error('approvedPrefetch always resolves ok');
      }
      return { ...approved, component: page };
    };
    const requests: { href: string; resolve: (result: ReactNavigationLoadResult) => void }[] = [];
    const load = vi.fn((href: string) => new Promise<ReactNavigationLoadResult>((resolve) => {
      requests.push({ href, resolve });
    }));
    const prefetch = vi.fn(async (href: string) => approvedPrefetch(href));
    const pushState = vi.fn();
    const replaceState = vi.fn();
    store.connect({ ...browser.environment, prefetchScope: 'anonymous-v1', prefetch, load, pushState, replaceState });
    const statuses: string[] = [];
    store.subscribe(() => statuses.push(store.getSnapshot().navigation.status));
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'complete') {
          unsubscribe();
          resolve();
        }
      });
    });

    store.router.push('/products/sku-84');
    requests[0]?.resolve(approvedLoad('https://example.test/products/sku-84', committedPage));
    await completed;
    const committedElement = store.getDestination();
    await store.prefetch('/products/sku-210', {});
    store.router.push('/products/sku-126');
    expect(store.getSnapshot().navigation).toEqual({
      destination: '/products/sku-126',
      status: 'navigating',
      type: 'push',
    });

    // When: the application invalidates while the credentialed navigation is still in flight.
    store.router.invalidate();

    // Then: navigation settles immediately to idle over the retained committed route and element.
    expect(statuses.at(-1)).toBe('idle');
    expect(store.getSnapshot().navigation).toEqual({ status: 'idle', type: null });
    expect(store.getSnapshot().pathname).toBe('/products/sku-84');
    expect(store.getSnapshot().url).toBe('/products/sku-84');
    expect(store.getSnapshot().params).toEqual({ sku: 'sku-84' });
    expect(store.getDestination()).toBe(committedElement);
    expect(pushState).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith('https://example.test/products/sku-84');
    expect(replaceState).not.toHaveBeenCalled();
    expect(browser.assign).not.toHaveBeenCalled();
    expect(browser.replace).not.toHaveBeenCalled();
    expect(browser.reload).not.toHaveBeenCalled();

    // And: invalidation cleared the completed prefetch entry, so a fresh HTTP approval is required.
    await store.prefetch('/products/sku-210', {});
    expect(prefetch).toHaveBeenCalledTimes(2);

    // And: the late response cannot change the settled state.
    requests[1]?.resolve(approvedLoad('https://example.test/products/sku-126', () => null));
    await Promise.resolve();
    expect(store.getSnapshot().navigation).toEqual({ status: 'idle', type: null });
    expect(store.getSnapshot().pathname).toBe('/products/sku-84');
    expect(store.getDestination()).toBe(committedElement);
    expect(pushState).toHaveBeenCalledOnce();
    expect(browser.assign).not.toHaveBeenCalled();
    expect(browser.replace).not.toHaveBeenCalled();
  });

  it('discards public entries and pending responses when the provider scope changes', async () => {
    // Given: a completed anonymous page and a second anonymous response still in flight.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    let approve = (_result: ReactNavigationLoadResult) => {};
    let pendingSignal: AbortSignal | undefined;
    const prefetch = vi.fn((href: string, signal: AbortSignal) => href.endsWith('/sku-84')
      ? Promise.resolve(approvedPrefetch(href))
      : new Promise<ReactNavigationLoadResult>((resolve) => {
        pendingSignal = signal;
        approve = resolve;
      }));
    const load = vi.fn(async (href: string) => approvedPrefetch(href));
    const first = store.connect({
      ...browser.environment, prefetchScope: 'anonymous-v1',
      prefetch, load, pushState: vi.fn(), replaceState: vi.fn(),
    });
    await store.prefetch('/products/sku-84', {});
    const pending = store.prefetch('/products/sku-126', {});

    // When: the application changes its auth/session epoch before the old response settles.
    const second = store.connect({
      ...browser.environment, prefetchScope: 'authenticated-v2',
      prefetch, load, pushState: vi.fn(), replaceState: vi.fn(),
    });
    approve(approvedPrefetch('https://example.test/products/sku-126'));
    await pending;
    store.navigatePrefetchedLink('/products/sku-84');

    // Then: no anonymous result can survive or commit within the authenticated scope.
    expect(pendingSignal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    expect(browser.assign).not.toHaveBeenCalled();
    first();
    second();
  });

  it('creates an immutable route snapshot from HTTP-owned route state', () => {
    // Given: the current request URL and path params produced by the HTTP route match.
    const params = { sku: 'sku-42' };

    // When: the app creates the hydration-safe client route snapshot.
    const snapshot = createReactRouteSnapshot({
      params,
      url: '/products/sku-42?preview=true#details',
    });
    params.sku = 'changed';

    // Then: URL readers and params expose a defensive snapshot without mutation methods.
    expect(snapshot).toMatchObject({
      hash: '#details',
      navigation: { status: 'idle', type: null },
      params: { sku: 'sku-42' },
      pathname: '/products/sku-42',
      url: '/products/sku-42?preview=true#details',
    });
    expect(snapshot.searchParams.get('preview')).toBe('true');
    expect('set' in snapshot.searchParams).toBe(false);
  });

  it('renders hooks from the same explicit snapshot during server rendering', () => {
    // Given: an HTTP route snapshot shared with the client hydration entry.
    const initialSnapshot = createReactRouteSnapshot({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true',
    });

    // When: a route-state consumer renders inside the provider.
    const html = renderToStaticMarkup(
      createElement(ReactClientRouterProvider, { initialSnapshot }, createElement(RouteStateProbe)),
    );

    // Then: all hooks read the request-owned snapshot without touching browser globals.
    expect(html).toContain('data-pathname="/products/sku-42"');
    expect(html).toContain('data-navigation="idle"');
    expect(html).toContain('data-url="/products/sku-42?preview=true"');
    expect(html).toContain('back,invalidate,openDocument,push,refresh,replace,retry');
    expect(html).toContain('sku-42:true');
  });

  it('lets compatible package copies share a Provider context without sharing Provider stores', async () => {
    // Given: one copy owns the outer provider while another copy supplies the hook.
    const clientA = await import('./client.js');
    vi.resetModules();
    const clientB = await import('./client.js');
    function CopyBPathname() {
      return createElement('output', null, clientB.usePathname());
    }

    // When: the copied hook reads both an outer and a nested provider.
    const html = renderToStaticMarkup(
      createElement(
        clientA.ReactClientRouterProvider,
        { initialSnapshot: clientA.createReactRouteSnapshot({ url: '/outer' }) },
        createElement(
          'section',
          null,
          createElement(CopyBPathname),
          createElement(
            clientB.ReactClientRouterProvider,
            { initialSnapshot: clientB.createReactRouteSnapshot({ url: '/inner' }) },
            createElement(CopyBPathname),
          ),
        ),
      ),
    );

    // Then: copy B sees copy A's context, while nested providers retain their own snapshots.
    expect(html).toContain('<section><output>/outer</output><output>/inner</output></section>');
  });

  it('renders Link as a real anchor for progressive enhancement', () => {
    // Given: a client router provider and a same-origin destination.
    const initialSnapshot = createReactRouteSnapshot({ url: '/products/sku-42' });

    // When: Link is rendered before any browser hydration occurs.
    const html = renderToStaticMarkup(
      createElement(
        ReactClientRouterProvider,
        { initialSnapshot },
        createElement(Link, { href: '/products/sku-84?preview=false' }, 'Open product'),
      ),
    );

    // Then: JavaScript-free navigation remains a normal anchor contract.
    expect(html).toContain('href="/products/sku-84?preview=false"');
    expect(html).toContain('>Open product</a>');
  });

  it('notifies hydrated Links when the browser environment becomes available', () => {
    // Given: viewport Links subscribe before the provider's browser effect connects.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({
      url: '/products/sku-42?preview=true',
    }));
    const observed: boolean[] = [];
    const initialSnapshot = store.getSnapshot();
    const unsubscribe = store.subscribe(() => observed.push(store.isConnected()));

    // When: the provider connects and later disconnects without navigating.
    const disconnect = store.connect(browser.environment);
    disconnect();
    unsubscribe();

    // Then: the observer can begin after hydration and stop on teardown without rewriting the route.
    expect(observed).toEqual([true, false]);
    expect(store.getSnapshot()).toBe(initialSnapshot);
  });

  it('reconciles a browser-only hash when the client store connects', () => {
    // Given: SSR route state without a fragment and the hydrated browser location with one.
    const browser = createEnvironment('https://example.test/products/sku-42?preview=true#details');
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );

    // When: hydration connects the store to the current browser location.
    store.connect(browser.environment);

    // Then: URL-derived state reflects the browser while HTTP-matched params stay intact.
    expect(store.getSnapshot()).toMatchObject({
      hash: '#details',
      navigation: { status: 'idle', type: null },
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true#details',
    });
  });

  it('requests the document rather than installing a different URL during hydration', () => {
    // Given: the server rendered one matched route but the browser starts at another URL.
    const browser = createEnvironment('https://example.test/admin/songs');
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42' }),
    );

    // When: hydration binds the browser environment.
    store.connect(browser.environment);

    // Then: stale server content cannot acquire the new URL or the old path params.
    expect(browser.assign).toHaveBeenCalledWith('https://example.test/admin/songs');
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-42' },
      url: '/products/sku-42',
    });
  });

  it('completes router-owned fragment push with push lifecycle semantics', () => {
    // Given: a connected store whose browser fake emits hashchange for fragment navigation.
    const browser = createEnvironment();
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );
    store.connect(browser.environment);

    // When: router.push changes only the current document fragment.
    store.router.push('#details');

    // Then: the resulting hashchange completes the requested push lifecycle.
    expect(browser.assign).toHaveBeenCalledWith('https://example.test/products/sku-42?preview=true#details');
    expect(store.getSnapshot()).toMatchObject({
      hash: '#details',
      navigation: {
        destination: '/products/sku-42?preview=true#details',
        status: 'complete',
        type: 'push',
      },
      url: '/products/sku-42?preview=true#details',
    });
  });

  it('completes router-owned fragment replace with replace lifecycle semantics', () => {
    // Given: a connected store at one fragment whose fake emits the next hashchange.
    const browser = createEnvironment('https://example.test/products/sku-42?preview=true#details');
    const store = createClientNavigationStore(
      createReactRouteSnapshot({
        params: { sku: 'sku-42' },
        url: '/products/sku-42?preview=true#details',
      }),
    );
    store.connect(browser.environment);

    // When: router.replace changes only the current document fragment.
    store.router.replace('#reviews');

    // Then: the resulting hashchange completes the requested replace lifecycle.
    expect(browser.replace).toHaveBeenCalledWith('https://example.test/products/sku-42?preview=true#reviews');
    expect(store.getSnapshot()).toMatchObject({
      hash: '#reviews',
      navigation: {
        destination: '/products/sku-42?preview=true#reviews',
        status: 'complete',
        type: 'replace',
      },
      url: '/products/sku-42?preview=true#reviews',
    });
  });

  it('delegates push and replace to full-document same-origin navigation', () => {
    // Given: a connected client store and browser navigation environment.
    const browser = createEnvironment();
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );
    store.connect(browser.environment);

    // When: the public router starts push and replace navigation.
    store.router.push('/products/sku-84?preview=false');
    store.router.replace('/products/sku-126?preview=true');

    // Then: browser document navigation owns HTTP matching, rendering, and history semantics.
    expect(browser.assign).toHaveBeenCalledWith('https://example.test/products/sku-84?preview=false');
    expect(browser.replace).toHaveBeenCalledWith('https://example.test/products/sku-126?preview=true');
    expect(store.getSnapshot().navigation).toEqual({
      destination: '/products/sku-126?preview=true',
      status: 'navigating',
      type: 'replace',
    });
  });

  it('commits only an HTTP-approved destination and its server-owned params', async () => {
    // Given: a browser with a successful negotiated destination and an observable store.
    const browser = createEnvironment();
    const approved = {
      ok: true as const,
      payload: {
        version: 1 as const,
        url: '/products/sku-84?preview=false',
        params: { sku: 'sku-84' },
        destination: { module: './navigation-product.ts', props: { sku: 'sku-84' } },
      },
      component: () => createElement('p', null, 'Approved product'),
    };
    const load = vi.fn(async () => approved);
    const pushState = vi.fn();
    const replaceState = vi.fn();
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );
    store.connect({ ...browser.environment, load, pushState, replaceState });
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'complete') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: the existing router pushes a destination.
    store.router.push('/products/sku-84?preview=false');
    await completed;

    // Then: approval, not the requested URL or old params, determines the committed route.
    expect(load).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith('https://example.test/products/sku-84?preview=false');
    expect(browser.assign).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-84' },
      pathname: '/products/sku-84',
      url: '/products/sku-84?preview=false',
      navigation: { status: 'complete', type: 'push' },
    });
  });

  it('ignores a late response after a newer navigation and deduplicates pending clicks', async () => {
    // Given: two request results whose completion order differs from activation order.
    const browser = createEnvironment();
    const requests: {
      readonly href: string;
      readonly signal: AbortSignal;
      readonly resolve: (result: {
        ok: true;
        payload: {
          version: 1;
          url: string;
          params: { sku: string };
          destination: { module: string; props: { sku: string } };
        };
        component: () => null;
      }) => void;
    }[] = [];
    const load = vi.fn((href: string, signal: AbortSignal) => new Promise<
      Parameters<(typeof requests)[number]['resolve']>[0]
    >((resolve) => {
      requests.push({ href, signal, resolve });
    }));
    const pushState = vi.fn();
    const store = createClientNavigationStore(createReactRouteSnapshot({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true',
    }));
    store.connect({ ...browser.environment, load, pushState, replaceState: vi.fn() });
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'complete') {
          unsubscribe();
          resolve();
        }
      });
    });
    const approve = (sku: string) => ({
      ok: true as const,
      payload: {
        version: 1 as const,
        url: `/products/${sku}`,
        params: { sku },
        destination: { module: './navigation-product.ts', props: { sku } },
      },
      component: () => null,
    });

    // When: the first activation repeats, then another URL supersedes it.
    store.router.push('/products/sku-84');
    store.router.push('/products/sku-84');
    store.router.push('/products/sku-126');
    requests[1]?.resolve(approve('sku-126'));
    await completed;
    requests[0]?.resolve(approve('sku-84'));
    await Promise.resolve();

    // Then: only the latest confirmed result updates the URL or matched params.
    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(pushState).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-126' },
      url: '/products/sku-126',
    });
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('cancels a pending page response on fragment activation without document fallback', async () => {
    // Given: a pending page request that settles only after its abort signal.
    const browser = createEnvironment();
    const load = vi.fn((_href: string, signal: AbortSignal) =>
      new Promise<{ ok: false; reason: 'cancelled' }>((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, reason: 'cancelled' }), { once: true });
      }));
    const store = createClientNavigationStore(createReactRouteSnapshot({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true',
    }));
    store.connect({ ...browser.environment, load, pushState: vi.fn(), replaceState: vi.fn() });

    // When: a fragment activation supersedes the pending HTTP page.
    store.router.push('/products/sku-84');
    store.router.push('#details');
    await Promise.resolve();

    // Then: the browser handles only the fragment and cancellation causes no fallback.
    expect(browser.assign).toHaveBeenCalledOnce();
    expect(browser.assign).toHaveBeenCalledWith('https://example.test/products/sku-42?preview=true#details');
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true#details',
    });
  });

  it('reloads server-owned data on history traversal instead of reusing a prior response', async () => {
    // Given: a browser returning a fresh HTTP approval for each history activation.
    const browser = createEnvironment();
    const load = vi.fn(async (href: string) => {
      const sku = new URL(href).pathname.split('/').at(-1) ?? '';
      return {
        ok: true as const,
        payload: {
          version: 1 as const,
          url: `/products/${sku}`,
          params: { sku },
          destination: { module: './navigation-product.ts', props: { sku } },
        },
        component: () => null,
      };
    });
    const store = createClientNavigationStore(createReactRouteSnapshot({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true',
    }));
    store.connect({ ...browser.environment, load, pushState: vi.fn(), replaceState: vi.fn() });
    const completedAt = (url: string) => new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === url) {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: browser history activates a prior page and then a forward page.
    const back = completedAt('/products/sku-84');
    browser.navigateFromHistory('https://example.test/products/sku-84');
    await back;
    const forward = completedAt('/products/sku-126');
    browser.navigateFromHistory('https://example.test/products/sku-126');
    await forward;

    // Then: every activation receives fresh params from its own negotiated response.
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-126' },
      url: '/products/sku-126',
      navigation: { status: 'complete', type: 'back' },
    });
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('uses one approval when popstate also emits hashchange for a new search', async () => {
    // Given: history will change both query and fragment on the same pathname.
    const browser = createEnvironment('https://example.test/products/sku-42?preview=true#first');
    const load = vi.fn(async () => ({
      ok: true as const,
      payload: {
        version: 1 as const,
        url: '/products/sku-42?preview=false',
        params: { sku: 'sku-42' },
        destination: { module: './navigation-product.ts', props: { sku: 'sku-42' } },
      },
      component: () => null,
    }));
    const store = createClientNavigationStore(createReactRouteSnapshot({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true#first',
    }));
    store.connect({ ...browser.environment, load, pushState: vi.fn(), replaceState: vi.fn() });
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-42?preview=false#second') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: one history activation emits popstate followed by hashchange.
    browser.navigateFromHistory('https://example.test/products/sku-42?preview=false#second');
    await completed;

    // Then: the fragment event cannot cancel or duplicate its pending HTTP approval.
    expect(load).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=false#second',
    });
  });

  it('commits a cross-path popstate approval after its activated fragment changes', async () => {
    // Given: history activates a different page while its HTTP approval is pending.
    const browser = createEnvironment('https://example.test/admin/qr');
    let approve: ((result: ReactNavigationLoadResult) => void) | undefined;
    const load = vi.fn((_href: string) => new Promise<ReactNavigationLoadResult>((resolve) => {
      approve = resolve;
    }));
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/admin/qr' }));
    store.connect({ ...browser.environment, load, pushState: vi.fn(), replaceState: vi.fn() });

    // When: the activated page gains a fragment before its approval resolves.
    browser.navigateFromHistory('https://example.test/admin/songs');
    browser.changeFragment('https://example.test/admin/songs#details');
    approve?.({
      ok: true,
      payload: {
        version: 1,
        url: '/admin/songs',
        params: {},
        destination: { module: './navigation-admin.ts', props: {} },
      },
      component: () => null,
    });
    await Promise.resolve();

    // Then: one approval installs the new page and current fragment, not stale route state.
    expect(load).toHaveBeenCalledOnce();
    expect(store.getDestination()).not.toBeNull();
    expect(store.getSnapshot()).toMatchObject({
      pathname: '/admin/songs',
      url: '/admin/songs#details',
      hash: '#details',
      navigation: { status: 'complete', type: 'back' },
    });
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it('falls back to the activated fragment when cross-path history approval is rejected', async () => {
    // Given: a history activation is awaiting HTTP approval for another page.
    const browser = createEnvironment('https://example.test/admin/qr');
    let reject: ((result: ReactNavigationLoadResult) => void) | undefined;
    const load = vi.fn(() => new Promise<ReactNavigationLoadResult>((resolve) => {
      reject = resolve;
    }));
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/admin/qr' }));
    store.connect({ ...browser.environment, load, pushState: vi.fn(), replaceState: vi.fn() });

    // When: its fragment changes before the HTTP response rejects the destination.
    browser.navigateFromHistory('https://example.test/admin/songs');
    browser.changeFragment('https://example.test/admin/songs#details');
    reject?.({ ok: false, reason: 'unavailable' });
    await Promise.resolve();

    // Then: the document fallback loads the currently activated browser URL.
    expect(load).toHaveBeenCalledOnce();
    expect(browser.assign).toHaveBeenCalledWith('https://example.test/admin/songs#details');
  });

  it('honors activation of the prior URL while a popstate approval is pending', async () => {
    // Given: history activated a second URL, but its HTTP result has not completed.
    const browser = createEnvironment();
    const requests: {
      readonly href: string;
      readonly resolve: (result: ReactNavigationLoadResult) => void;
    }[] = [];
    const load = vi.fn((href: string) => new Promise<ReactNavigationLoadResult>((resolve) => {
      requests.push({ href, resolve });
    }));
    const store = createClientNavigationStore(createReactRouteSnapshot({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true',
    }));
    const pushState = vi.fn();
    store.connect({ ...browser.environment, load, pushState, replaceState: vi.fn() });
    browser.navigateFromHistory('https://example.test/products/sku-84?preview=false');

    // When: the user explicitly reactivates the previous URL before approval.
    store.router.push('/products/sku-42?preview=true');

    // Then: the activation supersedes history; a stale pending response cannot win.
    expect(requests).toHaveLength(2);
    expect(requests[1]?.href).toBe('https://example.test/products/sku-42?preview=true');
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'complete') {
          unsubscribe();
          resolve();
        }
      });
    });
    requests[1]?.resolve({
      ok: true,
      payload: {
        version: 1,
        url: '/products/sku-42?preview=true',
        params: { sku: 'sku-42' },
        destination: { module: './navigation-product.ts', props: { sku: 'sku-42' } },
      },
      component: () => null,
    });
    await completed;
    requests[0]?.resolve({ ok: false, reason: 'unavailable' });
    await Promise.resolve();
    expect(pushState).toHaveBeenCalledOnce();
    expect(browser.assign).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      params: { sku: 'sku-42' },
      url: '/products/sku-42?preview=true',
      navigation: { status: 'complete', type: 'push' },
    });
  });

  it('falls back to the document without committing a rejected soft URL', async () => {
    // Given: the HTTP destination response cannot be approved.
    const browser = createEnvironment();
    const assigned = new Promise<string>((resolve) => {
      const store = createClientNavigationStore(createReactRouteSnapshot({
        params: { sku: 'sku-42' },
        url: '/products/sku-42?preview=true',
      }));
      store.connect({
        ...browser.environment,
        assign: resolve,
        load: async () => ({ ok: false, reason: 'unavailable' }),
        pushState: vi.fn(),
        replaceState: vi.fn(),
      });
      store.router.push('/products/sku-84');
      expect(store.getSnapshot().url).toBe('/products/sku-42?preview=true');
    });

    // When: the rejected HTTP result settles.
    const href = await assigned;

    // Then: the browser handles the actual document navigation.
    expect(href).toBe('https://example.test/products/sku-84');
  });

  it('delegates back and refresh to browser history and document reload semantics', () => {
    // Given: a connected client store.
    const browser = createEnvironment();
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42' }));
    store.connect(browser.environment);

    // When: callers request history traversal and an HTTP-first refresh.
    store.router.back();
    expect(store.getSnapshot().navigation).toEqual({ status: 'navigating', type: 'back' });
    store.router.refresh();

    // Then: the browser performs both operations and exposes refreshing before reload.
    expect(browser.back).toHaveBeenCalledOnce();
    expect(browser.reload).toHaveBeenCalledOnce();
    expect(store.getSnapshot().navigation).toEqual({ status: 'refreshing', type: 'refresh' });
  });

  it('falls back to a document request when history has no approved destination loader', () => {
    // Given: a connected store with no opted-in browser module importer map.
    const browser = createEnvironment();
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );
    store.connect(browser.environment);

    // When: browser history activates a different document URL.
    browser.navigateFromHistory('https://example.test/products/sku-84?preview=false#details');

    // Then: the browser requests the HTTP document; no guessed route state is installed.
    expect(browser.assign).toHaveBeenCalledWith('https://example.test/products/sku-84?preview=false#details');
    expect(store.getSnapshot().params).toEqual({ sku: 'sku-42' });
  });

  it('records back semantics when history traversal follows a prior push', () => {
    // Given: a connected store whose latest lifecycle state came from router.push().
    const browser = createEnvironment();
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );
    store.connect(browser.environment);
    store.router.push('#details');

    // When: browser history traverses back to the previous route.
    browser.navigateFromHistory('https://example.test/products/sku-42?preview=true');

    // Then: the completed lifecycle reports back rather than reusing push.
    expect(store.getSnapshot().navigation).toEqual({ status: 'complete', type: 'back' });
  });

  it.each(['network', 'server-error'] as const)(
    'retains the approved route on %s and retries through fresh HTTP approval',
    async (reason) => {
      // Given: a connected shell with one approved page and a failed credentialed load.
      const browser = createEnvironment();
      const store = createClientNavigationStore(createReactRouteSnapshot({
        params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true',
      }));
      const decisions: string[] = [];
      const load = vi.fn()
        .mockResolvedValueOnce({ ok: false, reason })
        .mockResolvedValueOnce(approvedPrefetch('https://example.test/products/sku-84'));
      let settled = (_value: 'preserved' | 'document') => {};
      const outcome = new Promise<'preserved' | 'document'>((resolve) => { settled = resolve; });
      store.connect({
        ...browser.environment,
        assign: (href) => {
          browser.assign(href);
          settled('document');
        },
        failurePolicy: (failure) => {
          decisions.push(`${failure.reason}:${failure.destination}:${failure.type}`);
          return 'preserve';
        },
        load,
        pushState: vi.fn(),
        replaceState: vi.fn(),
      });
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'error') {
          settled('preserved');
        }
      });

      // When: a rejected push settles, then the user retries.
      store.router.push('/products/sku-84');
      expect(await outcome).toBe('preserved');
      unsubscribe();
      expect(store.getSnapshot()).toMatchObject({
        params: { sku: 'sku-42' },
        url: '/products/sku-42?preview=true',
        navigation: {
          status: 'error', type: 'push',
          failure: { reason, destination: '/products/sku-84', type: 'push' },
        },
      });
      expect(browser.assign).not.toHaveBeenCalled();
      const completed = new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe(() => {
          if (store.getSnapshot().url === '/products/sku-84') {
            unsubscribe();
            resolve();
          }
        });
      });
      store.router.retry();
      await completed;

      // Then: the same shell has a newly approved destination and one committed URL.
      expect(decisions).toEqual([`${reason}:/products/sku-84:push`]);
      expect(load).toHaveBeenCalledTimes(2);
      expect(store.getSnapshot().params).toEqual({ sku: 'sku-84' });
      expect(browser.assign).not.toHaveBeenCalled();
    },
  );

  it.each(['invalidate', 'reconnect'] as const)(
    'settles preserved failure controls when %s clears their recovery target',
    async (action) => {
      // Given: the old approved page remains mounted after a failed soft navigation.
      const browser = createEnvironment();
      const store = createClientNavigationStore(createReactRouteSnapshot({
        params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true',
      }));
      const load = vi.fn(async (): Promise<ReactNavigationLoadResult> => ({
        ok: false, reason: 'network',
      }));
      const environment = {
        ...browser.environment, failurePolicy: () => 'preserve' as const,
        load, pushState: vi.fn(), replaceState: vi.fn(),
      };
      store.connect(environment);
      const failure = new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe(() => {
          if (store.getSnapshot().navigation.failure !== undefined) {
            unsubscribe();
            resolve();
          }
        });
      });
      store.router.push('/products/sku-84');
      await failure;
      const settled = new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe(() => {
          if (store.getSnapshot().navigation.status === 'idle') {
            unsubscribe();
            resolve();
          }
        });
      });

      // When: an explicit invalidation or provider policy reconnection discards that target.
      if (action === 'invalidate') {
        store.router.invalidate();
      } else {
        store.connect({ ...environment, failurePolicy: () => 'document' });
      }

      // Then: observers cannot show failed recovery controls that no longer work.
      expect(store.getSnapshot().navigation).toEqual({ status: 'idle', type: null });
      await settled;
      expect(store.getSnapshot()).toMatchObject({
        params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true',
      });
      store.router.retry();
      store.router.openDocument();
      expect(load).toHaveBeenCalledOnce();
      expect(browser.assign).not.toHaveBeenCalled();
    },
  );

  it.each(['throws', 'rejects'] as const)(
    'keeps an actionable failure when the application policy %s',
    async (behavior) => {
      // Given: a failed request and an application policy callback that cannot decide safely.
      const browser = createEnvironment();
      const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
      const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
      store.connect({
        ...browser.environment,
        failurePolicy: behavior === 'throws'
          ? () => { throw new Error('private policy context'); }
          : async () => { throw new Error('private policy context'); },
        load: async () => ({ ok: false, reason: 'network' }),
        pushState: vi.fn(),
        replaceState: vi.fn(),
      });
      const failure = new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe(() => {
          if (store.getSnapshot().navigation.status === 'error') {
            unsubscribe();
            resolve();
          }
        });
      });

      // When: the policy throws or rejects during a failed push.
      store.router.push('/products/sku-84');
      await failure;

      // Then: no document fallback or unhandled rejection escapes; only a safe reason is public.
      expect(store.getSnapshot().navigation.failure).toEqual({
        destination: '/products/sku-84', reason: 'application-error', type: 'push',
      });
      expect(browser.assign).not.toHaveBeenCalled();
      expect(diagnostic).toHaveBeenCalledOnce();
      diagnostic.mockRestore();
    },
  );

  it('ignores a late failed policy decision after a newer approved navigation', async () => {
    // Given: one failure policy decision held until a second HTTP navigation succeeds.
    const browser = createEnvironment();
    let decide = (_decision: 'preserve' | 'document') => {};
    const deciding = new Promise<'preserve' | 'document'>((resolve) => { decide = resolve; });
    let policyStarted = () => {};
    const started = new Promise<void>((resolve) => { policyStarted = resolve; });
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42?preview=true' }));
    store.connect({
      ...browser.environment,
      failurePolicy: () => { policyStarted(); return deciding; },
      load: vi.fn().mockResolvedValueOnce({ ok: false, reason: 'network' })
        .mockResolvedValueOnce(approvedPrefetch('https://example.test/products/sku-126')),
      pushState: vi.fn(),
      replaceState: vi.fn(),
    });
    const approved = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-126') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: a second push supersedes the pending failure callback.
    store.router.push('/products/sku-84');
    await started;
    store.router.push('/products/sku-126');
    await approved;
    decide('document');
    await deciding;

    // Then: stale fallback cannot replace the newly approved page.
    expect(browser.assign).not.toHaveBeenCalled();
    expect(store.getSnapshot().url).toBe('/products/sku-126');
  });

  it('never calls the failure policy for cancelled or superseded HTTP results', async () => {
    // Given: a request whose late failure only resolves after its abort event.
    const browser = createEnvironment();
    const policy = vi.fn(() => 'preserve' as const);
    const store = createClientNavigationStore(createReactRouteSnapshot({
      url: '/products/sku-42?preview=true',
    }));
    const load = vi.fn((_href: string, signal: AbortSignal) =>
      new Promise<ReactNavigationLoadResult>((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, reason: 'network' }), { once: true });
      }));
    store.connect({
      ...browser.environment, failurePolicy: policy, load, pushState: vi.fn(), replaceState: vi.fn(),
    });
    const settled = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: the application invalidates the pending request.
    store.router.push('/products/sku-84');
    store.router.invalidate();
    await settled;

    // Then: abort invalidates the late network failure without touching the approved route.
    expect(policy).not.toHaveBeenCalled();
    expect(browser.assign).not.toHaveBeenCalled();
    expect(store.getSnapshot().url).toBe('/products/sku-42?preview=true');
  });

  it('restores a pending traversal before preserving a newer failed push', async () => {
    // Given: one approved push and a back request awaiting a late HTTP result.
    const browser = createEnvironment('https://example.test/products/sku-42');
    const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/products/sku-42' }));
    let index: number | null = null;
    let rejectBack = (_result: ReactNavigationLoadResult) => {};
    const go = vi.fn((delta: number) => {
      index = (index ?? 0) + delta;
      browser.navigateFromHistory(`https://example.test/products/${index === 0 ? 'sku-42' : 'sku-84'}`);
    });
    const load = vi.fn((href: string) => href.endsWith('sku-84')
      ? Promise.resolve(approvedPrefetch(href))
      : href.endsWith('sku-42')
        ? new Promise<ReactNavigationLoadResult>((resolve) => { rejectBack = resolve; })
        : Promise.resolve({ ok: false, reason: 'server-error' } as const));
    store.connect({
      ...browser.environment,
      failurePolicy: ({ reason }) => reason === 'server-error' ? 'preserve' : 'document',
      historyIndex: () => index,
      go,
      load,
      pushState: (href, position) => {
        index = position ?? null;
        browser.changeFragment(href);
      },
      replaceState: (_href, position) => { index = position ?? null; },
    });
    const committed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().url === '/products/sku-84') {
          unsubscribe();
          resolve();
        }
      });
    });
    store.router.push('/products/sku-84');
    await committed;
    index = 0;
    browser.navigateFromHistory('https://example.test/products/sku-42');
    const failed = new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().navigation.status === 'error') {
          unsubscribe();
          resolve();
        }
      });
    });

    // When: a newer push fails while back approval is still in flight.
    store.router.push('/products/sku-126');
    await failed;
    rejectBack({ ok: false, reason: 'network' });

    // Then: restoration happened before the policy preserved the latest approved route.
    expect(go).toHaveBeenCalledWith(1);
    expect(browser.environment.currentHref()).toBe('https://example.test/products/sku-84');
    expect(store.getSnapshot().url).toBe('/products/sku-84');
    expect(store.getSnapshot().navigation.failure).toMatchObject({
      destination: '/products/sku-126', reason: 'server-error',
    });
    expect(browser.assign).not.toHaveBeenCalled();
  });
});
