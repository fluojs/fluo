import { createElement } from 'react';
import { Link, useForm } from '@fluojs/react/client';

export type CatalogPageProps = {
  readonly products: readonly { readonly sku: string; readonly name: string }[];
  readonly selected?: string;
  readonly sessionDemo?: boolean;
  readonly sessionIdentity?: string;
};

export function CatalogForm({ id, action, name = '', label, deleting = false }: {
  readonly id: string; readonly action: string; readonly name?: string; readonly label: string; readonly deleting?: boolean;
}) {
  const form = useForm<{ name: string }>({
    id, action, fields: { name: 'display_name' },
    allowDestination: (destination) => {
      const url = new URL(destination);
      return url.origin === window.location.origin && (url.pathname === '/catalog' || /^\/catalog\/[a-zA-Z0-9-]+$/u.test(url.pathname));
    },
  });
  const mutation = form.state.mutation;
  return createElement('form', { ...form.formProps, 'aria-label': label, 'data-enhanced': String(form.connected) },
    createElement('input', { type: 'hidden', name: 'csrf', value: 'catalog-demo-token' }),
    deleting ? null : createElement('div', null,
      createElement('label', { htmlFor: `${id}-name` }, label),
      createElement('input', { ...form.fieldProps('name'), defaultValue: name, required: true, minLength: 3 }),
      createElement('p', { id: `${id}-name-errors` }, form.fieldErrors('name').join(' ')),
    ),
    createElement('button', { type: 'submit', name: 'intent', value: deleting ? 'delete' : 'save' }, label),
    createElement('output', { 'data-form-state': id, 'aria-live': 'polite' },
      form.state.pending ? 'pending'
        : mutation === null ? 'idle'
          : `${mutation.status}${'reason' in mutation ? `:${mutation.reason}` : ''}`,
      form.state.followUp === null ? '' : ` read:${form.state.followUp.status}`,
      ` skipped:${form.state.skipped}`,
    ),
    mutation?.status === 'validation' ? createElement('p', { role: 'alert' }, mutation.formErrors.join(' ')) : null,
    form.state.pending || form.state.followUp?.status === 'pending'
      ? createElement('button', { type: 'button', onClick: form.cancel }, 'Cancel waiting') : null,
    mutation?.status === 'uncertain'
      ? createElement('p', { role: 'alert' }, 'Persistence is uncertain. Check the catalog before explicitly submitting again; a new POST may duplicate a save.') : null,
    mutation?.status === 'saved' && form.state.followUp?.status !== 'complete'
      ? createElement('button', { type: 'button', onClick: () => { void form.retryRead(); } }, 'Retry read only') : null,
  );
}

export default function CatalogPage(props: Record<string, unknown>) {
  const products = Array.isArray(props.products) ? props.products.filter(
    (value): value is { sku: string; name: string } => typeof value === 'object' && value !== null
      && typeof value.sku === 'string' && typeof value.name === 'string',
  ) : [];
  const selected = typeof props.selected === 'string' ? props.selected : undefined;
  if (props.sessionDemo === true) {
    return createElement('section', { 'aria-label': 'Session page' },
      createElement('h1', null, typeof props.sessionIdentity === 'string' ? `Session ${props.sessionIdentity}` : 'Session sign in'),
      ...products.map((product) => createElement('p', { key: product.sku, 'data-product': product.sku }, product.name)),
      typeof props.sessionIdentity === 'string'
        ? createElement('input', { 'aria-label': 'Protected draft', defaultValue: `Private draft ${props.sessionIdentity}` }) : null,
    );
  }
  return createElement('section', { 'aria-label': 'Catalog CRUD' },
    createElement('h1', null, selected === undefined ? 'Catalog' : `Product ${selected}`),
    createElement('a', { href: '/catalog/login' }, 'Sign in as demo editor'),
    createElement(Link, { href: '/catalog' }, 'Product list'),
    ...products.map((product) => createElement('article', { key: product.sku },
      createElement('p', { 'data-product': product.sku }, product.name),
      createElement(Link, { href: `/catalog/${product.sku}`, prefetch: 'hover' }, `Read ${product.sku}`),
      selected === undefined ? null : createElement(CatalogForm, {
        id: `edit-${product.sku}`, action: `/catalog/${product.sku}/update`, name: product.name, label: 'Save product',
      }),
      selected === undefined ? null : createElement(CatalogForm, {
        id: `delete-${product.sku}`, action: `/catalog/${product.sku}/delete`, deleting: true, label: 'Delete product',
      }),
    )),
    createElement(CatalogForm, { id: 'create-product', action: '/catalog/create', label: 'Create product' }),
    createElement(CatalogForm, { id: 'independent-product', action: '/catalog/create', label: 'Independent product' }),
  );
}
