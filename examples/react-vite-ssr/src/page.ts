import {
  Link,
  ReactClientRouterProvider,
  createReactRouteSnapshot,
  loadReactNavigationDestination,
  type ReactNavigationModules,
  useNavigation,
  useParams,
  usePathname,
  useRouter,
  useRouterState,
  useSearchParams,
} from '@fluojs/react/client';
import { Suspense, createElement, lazy, useId, useState, type ReactNode } from 'react';

const RECOMMENDATIONS_DELAY_MS = 25;

const LazyRecommendations = lazy(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, RECOMMENDATIONS_DELAY_MS));
  const { Recommendations } = await import('./recommendations');
  return { default: Recommendations };
});

export type ProductDocumentProps = {
  readonly preview: boolean;
  readonly productName: string;
  readonly navigationModules?: ReactNavigationModules;
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

function ProductNavigation({ modules }: { readonly modules?: ReactNavigationModules }) {
  const navigation = useNavigation();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const routerState = useRouterState();
  const searchParams = useSearchParams();
  const [loadedDestination, setLoadedDestination] = useState<ReactNode>(null);

  async function loadDestination() {
    const href = '/products/sku-84?preview=false';
    if (modules === undefined) {
      window.location.assign(href);
      return;
    }
    const result = await loadReactNavigationDestination(href, modules);
    if (!result.ok) {
      if (result.reason !== 'cancelled') {
        window.location.assign(href);
      }
      return;
    }
    setLoadedDestination(createElement(result.component, result.payload.destination.props));
  }

  return createElement(
    'nav',
    { 'aria-label': 'Product navigation' },
    createElement('p', null, `Current path: ${pathname}`),
    createElement('p', null, `Current preview: ${searchParams.get('preview') ?? 'unset'}`),
    createElement('p', null, `Current route sku: ${params.sku ?? 'unset'}`),
    createElement('p', null, `Current URL: ${routerState.url}`),
    createElement('p', null, `Current hash: ${routerState.hash || 'unset'}`),
    createElement('p', null, `Navigation: ${navigation.status}`),
    createElement(Link, { href: '/products/sku-84?preview=false' }, 'Open sku-84'),
    createElement('button', { onClick: loadDestination, type: 'button' }, 'Load sku-84 destination'),
    loadedDestination,
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
  );
}

export function ProductDocument({
  preview,
  productName,
  navigationModules,
  routeParams,
  routeUrl,
  saved,
  sku,
  stylesheets,
}: ProductDocumentProps) {
  const identifier = useId();
  const initialSnapshot = createReactRouteSnapshot({ params: routeParams, url: routeUrl });

  return createElement(
    ReactClientRouterProvider,
    { initialSnapshot },
    createElement(
      'html',
      {
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
        createElement('meta', { content: 'A minimal fluo React SSR and hydration example.', name: 'description' }),
        createElement('link', { href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rel: 'icon' }),
        createElement('title', null, `Catalog item ${sku}`),
        ...stylesheets.map((href) =>
          createElement('link', { 'data-vite-style': true, href, key: href, rel: 'stylesheet' }),
        ),
      ),
      createElement(
        'body',
        null,
        createElement(
          'main',
          null,
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
          createElement(HydratedCounter),
          createElement(ProductNavigation, { modules: navigationModules }),
        ),
      ),
    ),
  );
}
