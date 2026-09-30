import { Link } from '@fluojs/react/client';
import { createElement } from 'react';
import type { PageData } from './document';

type DestinationProps = {
  readonly data: Extract<PageData, { readonly kind: 'catalog' | 'admin' | 'login' }>;
  readonly editor: boolean;
};

export default function CatalogDestination({ data, editor }: DestinationProps) {
  if (data.kind === 'login') {
    return createElement('section', null,
      createElement('h1', null, 'Editor login'),
      createElement('form', { action: '/login', method: 'post' },
        createElement('label', { htmlFor: 'username' }, 'Username'),
        createElement('input', { id: 'username', name: 'username', required: true }),
        createElement('label', { htmlFor: 'password' }, 'Password'),
        createElement('input', { id: 'password', name: 'password', required: true, type: 'password' }),
        createElement('button', { type: 'submit' }, 'Log in')));
  }

  if (data.kind === 'admin') {
    return createElement('section', null,
      createElement('h1', null, 'Manage products'),
      createElement('ul', { className: 'product-list' },
        ...data.products.map((product) => createElement('li', { key: product.sku },
          createElement(Link, { href: `/products/${encodeURIComponent(product.sku)}` }, product.name))),
      ),
      createElement('form', { action: '/products', method: 'post' },
        createElement('label', { htmlFor: 'new-name' }, 'New product name'),
        createElement('input', { id: 'new-name', minLength: 3, name: 'name', required: true }),
        createElement('button', { type: 'submit' }, 'Create product')));
  }

  if (data.kind === 'catalog') {
    return createElement(
      'section',
      null,
      createElement('h1', null, data.title),
      createElement('ul', { className: 'product-list' },
        ...data.products.map((product) => createElement('li', { key: product.sku },
          createElement(Link, { href: `/products/${encodeURIComponent(product.sku)}` }, product.name),
          createElement('small', null, product.sku),
        )),
      ),
      editor
        ? createElement('form', { action: '/products', method: 'post' },
          createElement('label', { htmlFor: 'new-name' }, 'New product name'),
          createElement('input', { id: 'new-name', minLength: 3, name: 'name', required: true }),
          createElement('button', { type: 'submit' }, 'Create product'),
        )
        : createElement('form', { action: '/login', method: 'post' },
          createElement('label', { htmlFor: 'username' }, 'Username'),
          createElement('input', { id: 'username', name: 'username', required: true }),
          createElement('label', { htmlFor: 'password' }, 'Password'),
          createElement('input', { id: 'password', name: 'password', required: true, type: 'password' }),
          createElement('button', { type: 'submit' }, 'Log in'),
        ),
    );
  }
}
