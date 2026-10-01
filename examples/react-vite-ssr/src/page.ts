import {
  Link,
  ReactClientRouterProvider,
  createReactRouteSnapshot,
  type ReactNavigationFailurePolicy,
  type ReactNavigationModules,
  type ReactSessionContext,
  useNavigation,
  useParams,
  usePathname,
  useRouter,
  useRouterState,
  useSearchParams,
} from '@fluojs/react/client';
import type { ReactInitialNavigationPage } from '@fluojs/react';
import type { ReactPageMetadata } from '@fluojs/react';
import { Suspense, createElement, lazy, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import AdminDestination from './admin-page';
import { ExamplePageSlot } from './example-page-slot';
import { ResourceProbe } from './resource-probe';
import CatalogPage, { BackgroundSearch, type CatalogPageProps } from './catalog-page';
import { SessionControls, SessionResources } from './session-controls';
import { reactPageModules } from './generated/react-pages';

const RECOMMENDATIONS_DELAY_MS = 25;

declare global {
  interface Window {
    __reactResource?: { readonly id: string; operate: () => string };
    __reactResourceStats?: { mounts: number; cleanups: number };
  }
}

const preserveTransientNavigation: ReactNavigationFailurePolicy = (failure) =>
  failure.reason === 'network' || failure.reason === 'server-error'
    || failure.reason === 'incompatible-build'
    || failure.reason === 'import-failure'
    ? 'preserve' : 'document';

export type ProductDocumentProps = {
  readonly catalog?: CatalogPageProps;
  readonly adminPage?: 'qr' | 'songs';
  readonly preview: boolean;
  readonly productName: string;
  readonly navigationModules?: ReactNavigationModules;
  readonly navigationBuildId?: string;
  readonly initialPage?: ReactInitialNavigationPage;
  readonly routeMetadata?: ReactPageMetadata;
  readonly routeParams: Readonly<Record<string, string>>;
  readonly routeUrl: string;
  readonly saved: boolean;
  readonly sku: string;
  readonly stylesheets: readonly string[];
};

export function HydratedCounter() {
  const [count, setCount] = useState(0);

  return createElement('button', { onClick: () => setCount((value) => value + 1), type: 'button' }, `Count: ${count}`);
}

function LongLivedResource() {
  const resource = useRef<Window['__reactResource']>(undefined);
  const [ack, setAck] = useState('');
  useEffect(() => {
    const instance = {
      id: crypto.randomUUID(),
      operate: () => `${instance.id}:${++operations}`,
    };
    let operations = 0;
    resource.current = instance;
    window.__reactResource = instance;
    const stats = window.__reactResourceStats ?? { mounts: 0, cleanups: 0 };
    stats.mounts++;
    window.__reactResourceStats = stats;
    return () => {
      stats.cleanups++;
      resource.current = undefined;
      window.__reactResource = undefined;
    };
  }, []);
  return createElement(
    'div',
    { 'aria-label': 'Long-lived shell resource' },
    createElement('button', {
      onClick: () => setAck(resource.current?.operate() ?? 'resource unavailable'),
      type: 'button',
    }, 'Use shell resource'),
    createElement('span', { 'data-testid': 'resource-ack' }, ack),
  );
}

function ProductNavigation({ onSwitchUser }: { readonly onSwitchUser: () => string }) {
  const navigation = useNavigation();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const routerState = useRouterState();
  const searchParams = useSearchParams();
  const [mutationStatus, setMutationStatus] = useState('');

  const renameWithoutReload = async (): Promise<void> => {
    const body = new FormData();
    body.set('name', 'Updated without reload');
    const response = await fetch('/products/sku-42', {
      body,
      headers: { 'x-example-user': 'catalog-editor' },
      method: 'POST',
    });
    if (response.ok && new URL(response.url).searchParams.get('updated') === 'true') {
      router.invalidate();
      setMutationStatus('Mutation completed; prefetched pages invalidated');
    } else {
      setMutationStatus(`Mutation rejected: ${response.status}`);
    }
  };

  return createElement(
    'nav',
    { 'aria-label': 'Product navigation' },
    createElement('p', null, `Current path: ${pathname}`),
    createElement('p', null, `Current preview: ${searchParams.get('preview') ?? 'unset'}`),
    createElement('p', null, `Current route sku: ${params.sku ?? 'unset'}`),
    createElement('p', null, `Current route scenario: ${params.scenario ?? 'unset'}`),
    createElement('p', null, `Current URL: ${routerState.url}`),
    createElement('p', null, `Current hash: ${routerState.hash || 'unset'}`),
    createElement('p', null, `Navigation: ${navigation.status}`),
    navigation.failure === undefined ? null : createElement(
      'div',
      { role: 'alert' },
      createElement('p', null, `Navigation failed: ${navigation.failure.reason} (${navigation.failure.destination})`),
      createElement('button', { onClick: () => router.retry(), type: 'button' }, 'Retry navigation'),
      createElement('button', { onClick: () => router.openDocument(), type: 'button' }, 'Update application (open full document)'),
    ),
    searchParams.get('prefetchBounds') === 'true'
      ? createElement(
        'div',
        { 'aria-label': 'Concurrent viewport prefetch fixtures' },
        ...Array.from({ length: 5 }, (_, index) => createElement(Link, {
          href: `/prefetch/public-bound-${index + 1}`,
          key: index,
          prefetch: 'viewport',
        }, `Viewport bound ${index + 1}`)),
      )
      : null,
    searchParams.get('prefetchBounds') === 'cache'
      ? createElement(
        'div',
        { 'aria-label': 'LRU prefetch fixtures' },
        ...Array.from({ length: 33 }, (_, index) => createElement(Link, {
          href: `/prefetch/public-cache-${index + 1}`,
          key: index,
          prefetch: 'hover',
        }, `Cache entry ${index + 1}`)),
      )
      : null,
    createElement(Link, { href: '/products/sku-84?preview=false' }, 'Open sku-84'),
    createElement(Link, { href: '/products/sku-42?preview=false' }, 'Change product query'),
    createElement(Link, { href: '#details' }, 'Jump to details'),
    createElement(Link, { href: '#admin-details' }, 'Jump to admin details'),
    createElement(Link, { href: '#%' }, 'Open malformed fragment'),
    createElement(Link, { href: '/products/render-error' }, 'Open throwing destination'),
    createElement(Link, { href: '/products/render-error?throwFallback=true' }, 'Open throwing error view'),
    createElement(Link, { href: '/admin/qr' }, 'Open admin QR'),
    createElement(Link, { href: '/admin/songs' }, 'Open admin songs'),
    createElement(Link, { href: '/deployment/b-only' }, 'Open B-only page'),
    createElement(Link, { href: '/products/x?preview=maybe' }, 'Open invalid product'),
    createElement(Link, { href: '/prefetch/public-84', prefetch: 'hover' }, 'Prefetch public sku-84'),
    createElement(Link, { href: '/prefetch/public-84' }, 'Open public sku-84 without prefetch'),
    createElement(Link, { href: '/prefetch/public-viewport', prefetch: 'hover' }, 'Prefetch public-viewport by hover'),
    createElement(Link, { href: '/prefetch/public-race', prefetch: 'hover' }, 'Prefetch public race'),
    createElement(Link, { href: '/prefetch/public-cancel', prefetch: 'hover' }, 'Prefetch public cancellation'),
    createElement(Link, { href: '/prefetch/public-cancel' }, 'Open cancelled destination without prefetch'),
    createElement(Link, { href: '/prefetch/private', prefetch: 'hover' }, 'Prefetch private'),
    createElement(Link, { href: '/prefetch/no-store', prefetch: 'hover' }, 'Prefetch no-store'),
    createElement(Link, { href: '/prefetch/set-cookie', prefetch: 'hover' }, 'Prefetch Set-Cookie'),
    createElement(Link, { href: '/prefetch/vary-cookie', prefetch: 'hover' }, 'Prefetch Vary Cookie'),
    createElement(Link, { href: '/prefetch/redirect', prefetch: 'hover' }, 'Prefetch redirect'),
    createElement(Link, { href: '/prefetch/missing', prefetch: 'hover' }, 'Prefetch missing'),
    createElement(Link, { href: '/prefetch/auth', prefetch: 'hover' }, 'Prefetch auth'),
    createElement(
      'button',
      { onClick: () => router.push('/products/sku-126?preview=true'), type: 'button' },
      'Push sku-126',
    ),
    createElement(
      'button',
      { onClick: () => router.replace('/products/sku-168?preview=false'), type: 'button' },
      'Replace with sku-168',
    ),
    createElement('button', { onClick: () => router.back(), type: 'button' }, 'Back'),
    createElement('button', { onClick: () => router.refresh(), type: 'button' }, 'Refresh'),
    createElement('button', {
      onClick: () => {
        void router.sessionChanged({ epoch: onSwitchUser(), reason: 'login' });
      },
      type: 'button',
    }, 'Switch user and prefetch scope'),
    createElement('button', { onClick: () => router.invalidate(), type: 'button' }, 'Invalidate prefetched pages'),
    createElement('button', { onClick: () => { void renameWithoutReload(); }, type: 'button' }, 'Rename without reload'),
    createElement('p', { role: 'status' }, mutationStatus),
    createElement(
      'div',
      { className: 'viewport-prefetch' },
      createElement(Link, { href: '/prefetch/public-viewport', prefetch: 'viewport' }, 'Prefetch public on viewport'),
    ),
  );
}

export function ProductDocument({
  catalog,
  adminPage,
  preview,
  productName,
  navigationModules,
  navigationBuildId,
  initialPage,
  routeMetadata,
  routeParams,
  routeUrl,
  saved,
  sku,
  stylesheets,
}: ProductDocumentProps) {
  const sessionDemo = catalog?.sessionDemo === true || initialPage?.payload.destination.props.sessionDemo === true;
  const initialIdentity: unknown = initialPage?.payload.destination.props.sessionIdentity;
  const sessionIdentity = catalog?.sessionIdentity ?? (typeof initialIdentity === 'string' ? initialIdentity : undefined);
  const identifier = useId();
  const [LazyRecommendations] = useState(() => lazy(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, RECOMMENDATIONS_DELAY_MS));
    const { Recommendations } = await import('./recommendations');
    return { default: Recommendations };
  }));
  const prefetchScope = 'catalog:public';
  const initialSnapshot = createReactRouteSnapshot({ params: routeParams, url: routeUrl, metadata: routeMetadata });
  const testOptions = new URL(routeUrl, 'http://localhost').searchParams;
  const legacySession = sessionDemo && testOptions.has('legacySession');
  let authRefreshed = false;

  const renderRouteDocument = (destination: ReactNode | null): ReactNode => createElement(
    'html',
    {
      'data-admin-page': adminPage,
      'data-build-id': navigationBuildId,
      'data-preview': String(preview),
      'data-product-name': productName,
      'data-saved': String(saved),
      'data-sku': sku,
      lang: 'en',
    },
    createElement(
      'head',
      null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('meta', { content: 'width=device-width, initial-scale=1', name: 'viewport' }),
      createElement('link', { href: '/assets/favicon.svg', rel: 'icon' }),
      ...stylesheets.map((href) =>
        createElement('link', { 'data-vite-style': true, href, key: href, rel: 'stylesheet' }),
      ),
    ),
    createElement(
      'body',
      null,
      createElement(
        'main',
        { tabIndex: -1 },
        legacySession ? createElement('p', { 'data-legacy-protected': true }, `Legacy protected ${sessionIdentity}`)
        : createElement(ExamplePageSlot, {
          destination,
          page: catalog !== undefined ? createElement(CatalogPage, { ...catalog,
            ...(sessionDemo ? { sessionDemo: true, sessionIdentity } : {}),
          }) : adminPage === undefined
          ? createElement(
            'section',
            { 'aria-label': 'Product page' },
            createElement('h1', null, `Catalog item ${sku}`),
            createElement('p', null, preview ? 'Preview mode' : 'Published mode'),
            createElement('p', null, `DTO-bound sku: ${sku}`),
            saved ? createElement('p', { role: 'status' }, `Saved product: ${productName}`) : null,
            createElement(
              'form',
              {
                action: `/products/${encodeURIComponent(sku)}`,
                encType: 'multipart/form-data',
                method: 'post',
              },
              createElement(
                'p',
                null,
                createElement('label', { htmlFor: 'product-name' }, 'Product name'),
                createElement('br'),
                createElement('input', {
                  defaultValue: productName,
                  id: 'product-name',
                  minLength: 3,
                  name: 'name',
                  required: true,
                  type: 'text',
                }),
              ),
              createElement('button', { type: 'submit' }, 'Save product'),
            ),
            createElement('p', { 'data-react-identifier': true, id: identifier }, 'Shared hydration identifier'),
            createElement(
              Suspense,
              { fallback: createElement('p', null, 'Loading recommendations') },
              createElement(LazyRecommendations, { sku }),
            ),
          )
          : createElement(AdminDestination, { page: adminPage }),
        }),
        createElement(HydratedCounter),
        createElement(SessionResources, { children: createElement(BackgroundSearch, { id: 'song-widget' }) }),
        createElement(SessionResources, { children: createElement(ResourceProbe) }),
        createElement('a', { href: '#details', id: 'details', tabIndex: -1 }, 'Page details'),
        createElement(SessionResources, { children: createElement(LongLivedResource) }),
        sessionDemo || catalog?.backgroundDemo === true || routeUrl.startsWith('/catalog/background')
          ? createElement(SessionControls) : null,
        createElement(ProductNavigation, {
          onSwitchUser: () => {
            const next = document.cookie.includes('session=alice') ? 'catalog:anonymous' : 'catalog:alice';
            document.cookie = next === 'catalog:alice' ? 'session=alice; Path=/' : 'session=; Max-Age=0; Path=/';
            return next;
          },
        }),
      ),
      initialPage === undefined ? null : createElement('script', {
        id: 'fluo-initial-page',
        type: 'application/json',
      }, initialPage.json),
    ),
  );

  return createElement(ReactClientRouterProvider, {
    ...(legacySession ? {} : { session: {
      epoch: sessionIdentity === undefined ? 'demo:initial' : `demo:${sessionIdentity}`,
      ...(sessionDemo && testOptions.has('authRefresh') ? {
        policy: (context: ReactSessionContext) => {
          if ((context.reason === 'unauthorized' || context.reason === 'forbidden') && !authRefreshed) {
            authRefreshed = true;
            return 'refresh';
          }
          return context.reason === 'logout' || context.reason === 'unauthorized' ? 'signed-out'
            : context.reason === 'forbidden' ? 'forbidden' : 'refresh';
        },
      } : {}),
    } }),
    initialSnapshot,
    navigationModules,
    navigationContracts: reactPageModules,
    navigationBuildId,
    prefetchScope,
    failurePolicy: new URL(routeUrl, 'http://localhost').searchParams.has('defaultNavigation')
      ? undefined : preserveTransientNavigation,
    children: legacySession ? renderRouteDocument(null) : renderRouteDocument,
  });
}
