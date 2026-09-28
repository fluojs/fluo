/// <reference types="vite/client" />
import type { ReactNavigationModules } from '@fluojs/react/client';
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

hydrateRoot(document, createElement(BenchmarkDocument, {
  ...state,
  navigationModules,
  routeParams: window.location.pathname.startsWith('/products/')
    ? { sku: decodeURIComponent(window.location.pathname.slice('/products/'.length)) }
    : {},
  routeUrl: `${window.location.pathname}${window.location.search}`,
  stylesheets,
}), { identifierPrefix: 'benchmark-fluo-' });
