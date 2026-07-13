import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { ProductDocument } from './page';
import './styles.css';

const stylesheets = [...document.querySelectorAll<HTMLLinkElement>('link[data-vite-style]')]
  .map((link) => link.getAttribute('href'))
  .filter((href): href is string => href !== null);

hydrateRoot(
  document,
  createElement(ProductDocument, {
    preview: document.documentElement.dataset.preview === 'true',
    sku: document.documentElement.dataset.sku ?? '',
    stylesheets,
  }),
);
