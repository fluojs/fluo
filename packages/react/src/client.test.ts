import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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
    expect(html).toContain('back,push,refresh,replace');
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
});
