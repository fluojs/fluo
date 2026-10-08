import { Link } from '@fluojs/react/client';
import { createElement } from 'react';
import type { PageData } from './document';

type DestinationProps = {
  readonly data: Extract<PageData, { readonly kind: 'product' }>;
  readonly editor: boolean;
};

export default function ProductDestination({ data, editor }: DestinationProps) {
  const { product } = data;
  return createElement(
    'section',
    null,
    createElement('p', null, createElement(Link, { href: '/' }, 'All products')),
    createElement('h1', null, product.name),
    createElement('p', null, `SKU ${product.sku}`),
    editor ? createElement('div', null,
      createElement('form', { action: `/products/${encodeURIComponent(product.sku)}`, method: 'post' },
        createElement('label', { htmlFor: 'edit-name' }, 'Product name'),
        createElement('input', {
          defaultValue: product.name,
          id: 'edit-name',
          minLength: 3,
          name: 'name',
          required: true,
        }),
        createElement('button', { type: 'submit' }, 'Save product'),
      ),
      createElement('form', { action: `/products/${encodeURIComponent(product.sku)}/delete`, method: 'post' },
        createElement('button', { type: 'submit' }, 'Delete product'),
      ),
    ) : null,
  );
}
