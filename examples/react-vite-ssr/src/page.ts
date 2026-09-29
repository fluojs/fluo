import {
  Link,
  ReactClientRouterProvider,
  createReactRouteSnapshot,
  type ReactNavigationModules,
  useNavigation,
  useParams,
  usePathname,
  useRouter,
  useRouterState,
  useSearchParams,
} from '@fluojs/react/client';
import type { ReactInitialNavigationPage, ReactPageMetadata } from '@fluojs/react';
import { Suspense, createElement, lazy, useId, useState, type ReactNode } from 'react';
import AdminDestination from './admin-page';
import { ExamplePageSlot } from './example-page-slot';
import { ResourceProbe } from './resource-probe';

const RECOMMENDATIONS_DELAY_MS = 25;

export type ProductDocumentProps = {
  readonly adminPage?: 'qr' | 'songs';
  readonly preview: boolean;
  readonly productName: string;
  readonly navigationModules?: ReactNavigationModules;
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

function ProductNavigation({ onSwitchUser }: { readonly onSwitchUser: () => void }) {
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
        router.invalidate();
        onSwitchUser();
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
  adminPage,
  preview,
  productName,
  navigationModules,
  initialPage,
  routeMetadata,
  routeParams,
  routeUrl,
  saved,
  sku,
  stylesheets,
}: ProductDocumentProps) {
  const identifier = useId();
  const [LazyRecommendations] = useState(() => lazy(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, RECOMMENDATIONS_DELAY_MS));
    const { Recommendations } = await import('./recommendations');
    return { default: Recommendations };
  }));
  const [prefetchScope, setPrefetchScope] = useState('catalog:anonymous');
  const initialSnapshot = createReactRouteSnapshot({ params: routeParams, url: routeUrl, metadata: routeMetadata });

  const renderRouteDocument = (destination: ReactNode | null): ReactNode => createElement(
    'html',
    {
      'data-admin-page': adminPage,
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
      createElement('link', { href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rel: 'icon' }),
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
        createElement(ExamplePageSlot, {
          destination,
          page: adminPage === undefined
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
        createElement(ResourceProbe),
        createElement('a', { href: '#details', id: 'details', tabIndex: -1 }, 'Page details'),
        createElement(ProductNavigation, {
          onSwitchUser: () => {
            const next = prefetchScope === 'catalog:anonymous' ? 'catalog:alice' : 'catalog:anonymous';
            document.cookie = next === 'catalog:alice' ? 'session=alice; Path=/' : 'session=; Max-Age=0; Path=/';
            setPrefetchScope(next);
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
    initialSnapshot,
    navigationModules,
    prefetchScope,
    children: renderRouteDocument,
  });
}
