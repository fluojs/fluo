/// <reference types="vite/client" />
import { createElement, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { loadReactInitialNavigationDestination, type ReactNavigationModules } from '@fluojs/react/client';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { ProductDocument } from './page';
import { reactPageModules } from './generated/react-pages';
import './styles.css';

const stylesheets = [...document.querySelectorAll<HTMLLinkElement>('link[data-vite-style]')]
  .map((link) => link.getAttribute('href'))
  .filter((href): href is string => href !== null);
const navigationModules: ReactNavigationModules = import.meta.glob<{
  readonly default: (props: Record<string, unknown>) => ReactNode;
}>('./navigation-*.ts');
const activeModules = import.meta.env.MODE === 'reliability'
  ? (await import('../tests/import-control')).controlledImports(navigationModules)
  : navigationModules;
const adminPage = document.documentElement.dataset.adminPage;
const isAdminPage = adminPage === 'qr' || adminPage === 'songs';
const initialJson = document.getElementById('fluo-initial-page')?.textContent;
const buildId = document.documentElement.dataset.buildId;
if (initialJson === undefined || initialJson === null || buildId === undefined) {
  throw new Error('The HTTP document has no compatible initial navigation transfer.');
}
const initial = await loadReactInitialNavigationDestination(initialJson, activeModules, buildId, reactPageModules);
if (!initial.ok) {
  throw new Error(`The HTTP document destination is unavailable: ${initial.reason}`);
}

hydrateRoot(
  document,
  createElement(ProductDocument, {
    ...(initial.payload.destination.module !== './navigation-catalog.ts' ? {} : {
      catalog: reactPageModules['./navigation-catalog.ts'].decodeProps(initial.payload.destination.props),
    }),
    adminPage: isAdminPage ? adminPage : undefined,
    preview: document.documentElement.dataset.preview === 'true',
    productName: document.documentElement.dataset.productName ?? '',
    navigationModules: activeModules,
    navigationBuildId: buildId,
    initialPage: { json: initialJson, payload: initial.payload },
    routeMetadata: initial.payload.metadata,
    routeParams: initial.payload.params,
    routeUrl: `${window.location.pathname}${window.location.search}`,
    saved: document.documentElement.dataset.saved === 'true',
    sku: document.documentElement.dataset.sku ?? '',
    stylesheets,
  }),
  { identifierPrefix: REACT_IDENTIFIER_PREFIX },
);
