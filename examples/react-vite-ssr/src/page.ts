import { Suspense, createElement, lazy, useState } from 'react';

const LazyRecommendations = lazy(async () => {
  const { Recommendations } = await import('./recommendations');
  return { default: Recommendations };
});

export type ProductDocumentProps = {
  readonly preview: boolean;
  readonly sku: string;
  readonly stylesheets: readonly string[];
};

export function HydratedCounter() {
  const [count, setCount] = useState(0);

  return createElement('button', { onClick: () => setCount((value) => value + 1), type: 'button' }, `Count: ${count}`);
}

export function ProductDocument({ preview, sku, stylesheets }: ProductDocumentProps) {
  return createElement(
    'html',
    { 'data-preview': String(preview), 'data-sku': sku, lang: 'en' },
    createElement(
      'head',
      null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('meta', { content: 'width=device-width, initial-scale=1', name: 'viewport' }),
      createElement('meta', { content: 'A minimal fluo React SSR and hydration example.', name: 'description' }),
      createElement('link', { href: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rel: 'icon' }),
      createElement('title', null, `Catalog item ${sku}`),
      ...stylesheets.map((href) => createElement('link', { 'data-vite-style': true, href, key: href, rel: 'stylesheet' })),
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
        createElement(
          Suspense,
          { fallback: createElement('p', null, 'Loading recommendations') },
          createElement(LazyRecommendations, { sku }),
        ),
        createElement(HydratedCounter),
        createElement('a', { href: `/products/${encodeURIComponent(sku)}?preview=false` }, 'Open published view'),
      ),
    ),
  );
}
