import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ReactPageCatalogEntry } from './page-catalog.js';
import { generateReactPageTypes } from './typegen.js';

const catalog = [
  {
    handler: 'index',
    id: 'GET /products ProductRouter index',
    kind: 'react-page',
    method: 'GET',
    params: [],
    path: '/products',
    router: 'ProductRouter',
  },
  {
    handler: 'show',
    id: 'GET /products/:productId ProductRouter show',
    kind: 'react-page',
    method: 'GET',
    params: ['productId'],
    path: '/products/:productId',
    router: 'ProductRouter',
  },
] satisfies readonly ReactPageCatalogEntry[];

describe('@fluojs/react/typegen', () => {
  it('generates absolute paths and href builders with required params', () => {
    // Given
    const pages = catalog;

    // When
    const output = generateReactPageTypes(pages);

    // Then
    expect(output).toContain('export type ReactPageRouteId =');
    expect(output).toContain('readonly "GET /products ProductRouter index": "/products";');
    expect(output).toContain('readonly "GET /products/:productId ProductRouter show": {');
    expect(output).toContain('readonly "productId": string;');
    expect(output).toContain('href: (): string => "/products"');
    expect(output).toContain('href: <Actual extends ReactPageParamsById["GET /products/:productId ProductRouter show"]>');
    expect(output).toContain('encodeURIComponent(params["productId"])');
  });

  it('generates route-bound Link props and push or replace authoring methods', () => {
    // Given
    const pages = catalog;

    // When
    const output = generateReactPageTypes(pages);

    // Then
    expect(output).toContain('export type ReactPageLinkProps = { readonly href: string; };');
    expect(output).toContain('export interface ReactPageNavigator {');
    expect(output).toContain('link: (): ReactPageLinkProps => ({ href: "/products" })');
    expect(output).toContain('push: (navigator: ReactPageNavigator): void => navigator.push("/products")');
    expect(output).toContain('replace: (navigator: ReactPageNavigator): void => navigator.replace("/products")');
    expect(output).toContain('link: <Actual extends ReactPageParamsById["GET /products/:productId ProductRouter show"]>');
    expect(output).toContain('push: <Actual extends ReactPageParamsById["GET /products/:productId ProductRouter show"]>');
    expect(output).toContain('replace: <Actual extends ReactPageParamsById["GET /products/:productId ProductRouter show"]>');
    expect(output).toContain('params: Actual & Record<Exclude<keyof Actual, keyof ReactPageParamsById["GET /products/:productId ProductRouter show"]>, never>');
  });

  it('keeps output deterministic when catalog registration order changes', () => {
    // Given
    const reversedPages = [...catalog].reverse();

    // When
    const first = generateReactPageTypes(catalog);
    const second = generateReactPageTypes(reversedPages);

    // Then
    expect(second).toBe(first);
  });

  it('orders canonically equivalent Unicode ids by code units regardless of registration order', () => {
    // Given
    const composedPage = {
      ...catalog[0],
      id: 'GET /caf\u00e9 CafeRouter show',
      path: '/caf\u00e9',
      router: 'CafeRouter',
    } satisfies ReactPageCatalogEntry;
    const decomposedPage = {
      ...catalog[0],
      id: 'GET /cafe\u0301 CafeRouter show',
      path: '/cafe\u0301',
      router: 'CafeRouter',
    } satisfies ReactPageCatalogEntry;

    // When
    const first = generateReactPageTypes([composedPage, decomposedPage]);
    const second = generateReactPageTypes([decomposedPage, composedPage]);

    // Then
    expect(second).toBe(first);
    expect(first.indexOf(JSON.stringify(decomposedPage.id))).toBeLessThan(first.indexOf(JSON.stringify(composedPage.id)));
  });

  it('rejects versioned pages instead of erasing non-path dispatch requirements', () => {
    // Given
    const versionedCatalog = [
      {
        ...catalog[0],
        id: 'GET /v2/products ProductRouter index',
        path: '/v2/products',
        version: '2',
      },
    ] satisfies readonly ReactPageCatalogEntry[];

    // When
    const action = () => generateReactPageTypes(versionedCatalog);

    // Then
    expect(action).toThrow(expect.objectContaining({
      code: 'react-page-typegen-versioned-route-unsupported',
      routeId: 'GET /v2/products ProductRouter index',
    }));
  });

  it('publishes typegen from a tooling subpath without widening the runtime-neutral root', async () => {
    // Given
    const packageManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    // When
    const root = await import('./index.js');
    const typegen = await import('./typegen.js');

    // Then
    expect(packageManifest).toContain('"./typegen"');
    expect(root).not.toHaveProperty('generateReactPageTypes');
    expect(typegen.generateReactPageTypes).toBe(generateReactPageTypes);
  });
});
