/// <reference types="vite/client" />
import { loadReactInitialNavigationDestination, type ReactNavigationModules } from '@fluojs/react/client';
import { createElement, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { BenchmarkDocument, type PageData } from './document';
import './styles.css';

const state: { readonly data: PageData; readonly editor: boolean } =
  JSON.parse(document.documentElement.dataset.benchmarkPage ?? '');
const stylesheets = [...document.querySelectorAll<HTMLLinkElement>('link[data-vite-style]')]
  .map((link) => link.getAttribute('href'))
  .filter((href): href is string => href !== null);
const navigationModules: ReactNavigationModules = import.meta.glob<{
  readonly default: (props: Record<string, unknown>) => ReactNode;
}>('./navigation-*.ts');
const initialJson = document.getElementById('fluo-initial-page')?.textContent;
const navigationBuildId = document.documentElement.dataset.buildId;
if (initialJson === undefined || initialJson === null || navigationBuildId === undefined) {
  throw new Error('The HTTP document has no compatible initial navigation transfer.');
}
const initial = await loadReactInitialNavigationDestination(initialJson, navigationModules, navigationBuildId);
if (!initial.ok) {
  throw new Error(`The HTTP document destination is unavailable: ${initial.reason}`);
}

hydrateRoot(document, createElement(BenchmarkDocument, {
  ...state,
  initialElement: createElement(initial.component, initial.payload.destination.props),
  initialPage: { json: initialJson, payload: initial.payload },
  navigationModules,
  navigationBuildId,
  routeParams: initial.payload.params,
  routeUrl: initial.payload.url,
  stylesheets,
}), { identifierPrefix: 'benchmark-fluo-' });
