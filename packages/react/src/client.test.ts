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

  it('updates URL readers after browser history navigation', () => {
    // Given: a connected store with one HTTP-owned path-param snapshot.
    const browser = createEnvironment();
    const store = createClientNavigationStore(
      createReactRouteSnapshot({ params: { sku: 'sku-42' }, url: '/products/sku-42?preview=true' }),
    );
    store.connect(browser.environment);

    // When: browser history activates a different document URL.
    browser.navigateFromHistory('https://example.test/products/sku-84?preview=false#details');

    // Then: URL hooks receive the current location and stale route params are not retained.
    expect(store.getSnapshot()).toMatchObject({
      hash: '#details',
      navigation: { status: 'complete', type: 'back' },
      params: {},
      pathname: '/products/sku-84',
      url: '/products/sku-84?preview=false#details',
    });
    expect(store.getSnapshot().searchParams.get('preview')).toBe('false');
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
