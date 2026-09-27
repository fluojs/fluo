/// <reference types="vite/client" />
import { createElement, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import type { ReactNavigationModules } from '@fluojs/react/client';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { ProductDocument } from './page';
import './styles.css';

const stylesheets = [...document.querySelectorAll<HTMLLinkElement>('link[data-vite-style]')]
  .map((link) => link.getAttribute('href'))
  .filter((href): href is string => href !== null);
const navigationModules: ReactNavigationModules = import.meta.glob<{
  readonly default: (props: Record<string, unknown>) => ReactNode;
}>('./navigation-*.ts');
const adminPage = document.documentElement.dataset.adminPage;
const isAdminPage = adminPage === 'qr' || adminPage === 'songs';

hydrateRoot(
  document,
  createElement(ProductDocument, {
    adminPage: isAdminPage ? adminPage : undefined,
    preview: document.documentElement.dataset.preview === 'true',
    productName: document.documentElement.dataset.productName ?? '',
    navigationModules,
    routeParams: isAdminPage ? {} : { sku: document.documentElement.dataset.sku ?? '' },
    routeUrl: `${window.location.pathname}${window.location.search}`,
    saved: document.documentElement.dataset.saved === 'true',
    sku: document.documentElement.dataset.sku ?? '',
    stylesheets,
  }),
  { identifierPrefix: REACT_IDENTIFIER_PREFIX },
);
