import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { ProductDocument } from './page';
import './styles.css';

const stylesheets = [...document.querySelectorAll<HTMLLinkElement>('link[data-vite-style]')]
  .map((link) => link.getAttribute('href'))
  .filter((href): href is string => href !== null);

hydrateRoot(
  document,
  createElement(ProductDocument, {
    preview: document.documentElement.dataset.preview === 'true',
    routeParams: { sku: document.documentElement.dataset.sku ?? '' },
    routeUrl: `${window.location.pathname}${window.location.search}`,
    sku: document.documentElement.dataset.sku ?? '',
    stylesheets,
  }),
  { identifierPrefix: REACT_IDENTIFIER_PREFIX },
);
