import { createElement, Fragment } from 'react';
import { Link, useForm, type ReactFormBinding } from '@fluojs/react/client';
import { reactFormRoutes, reactPageRoutes } from './generated/react-pages';

export type CatalogPageProps = {
  readonly products: readonly { readonly sku: string; readonly name: string }[];
  readonly selected?: string;
  readonly sessionDemo?: boolean;
  readonly sessionIdentity?: string;
};

const createRoute = reactFormRoutes['POST /catalog/create CatalogRouter create'];
const updateRoute = reactFormRoutes['POST /catalog/:sku/update CatalogRouter update'];
const deleteRoute = reactFormRoutes['POST /catalog/:sku/delete CatalogRouter delete'];

function allowCatalogDestination(destination: string): boolean {
  const url = new URL(destination);
  return url.origin === window.location.origin && (url.pathname === '/catalog' || /^\/catalog\/[a-zA-Z0-9-]+$/u.test(url.pathname));
}

function FormStatus({ id, form }: {
  readonly id: string;
  readonly form: Pick<ReactFormBinding<object>, 'state' | 'cancel' | 'retryRead'>;
}) {
  const mutation = form.state.mutation;
  return createElement(Fragment, null,
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

export function CatalogForm({ id, sku, name = '', label }: {
  readonly id: string; readonly sku?: string; readonly name?: string; readonly label: string;
}) {
  const form = useForm({
    id, action: sku === undefined ? createRoute.href() : updateRoute.href({ sku }),
    contract: sku === undefined ? createRoute.contract : updateRoute.contract,
    allowDestination: allowCatalogDestination,
  });
  return createElement('form', { ...form.formProps, 'aria-label': label, 'data-enhanced': String(form.connected) },
    createElement('input', { ...form.fieldProps('csrf'), type: 'hidden', value: 'catalog-demo-token' }),
    createElement('label', { htmlFor: `${id}-name` }, label),
    createElement('input', { ...form.fieldProps('name'), defaultValue: name, required: true, minLength: 3 }),
    createElement('p', { id: `${id}-name-errors` }, form.fieldErrors('name').join(' ')),
    createElement('button', { ...form.fieldProps('intent'), type: 'submit', value: 'save' }, label),
    createElement(FormStatus, { id, form }),
  );
}

function DeleteCatalogForm({ id, sku, label }: {
  readonly id: string; readonly sku: string; readonly label: string;
}) {
  const form = useForm({
    id, action: deleteRoute.href({ sku }), contract: deleteRoute.contract,
    allowDestination: allowCatalogDestination,
  });
  return createElement('form', { ...form.formProps, 'aria-label': label, 'data-enhanced': String(form.connected) },
    createElement('input', { ...form.fieldProps('csrf'), type: 'hidden', value: 'catalog-demo-token' }),
    createElement('button', { ...form.fieldProps('intent'), type: 'submit', value: 'delete' }, label),
    createElement(FormStatus, { id, form }),
  );
}

export default function CatalogPage({ products, selected, sessionDemo, sessionIdentity }: CatalogPageProps) {
  if (sessionDemo === true) {
    return createElement('section', { 'aria-label': 'Session page' },
      createElement('h1', null, typeof sessionIdentity === 'string' ? `Session ${sessionIdentity}` : 'Session sign in'),
      ...products.map((product) => createElement('p', { key: product.sku, 'data-product': product.sku }, product.name)),
      typeof sessionIdentity === 'string'
        ? createElement('input', { 'aria-label': 'Protected draft', defaultValue: `Private draft ${sessionIdentity}` }) : null,
    );
  }
  return createElement('section', { 'aria-label': 'Catalog CRUD' },
    createElement('h1', null, selected === undefined ? 'Catalog' : `Product ${selected}`),
    createElement('a', { href: '/catalog/login' }, 'Sign in as demo editor'),
    createElement(Link, reactPageRoutes['GET /catalog CatalogRouter list'].link(), 'Product list'),
    ...products.map((product) => createElement('article', { key: product.sku },
      createElement('p', { 'data-product': product.sku }, product.name),
      createElement(Link, {
        ...reactPageRoutes['GET /catalog/:sku CatalogRouter detail'].link({ sku: product.sku }), prefetch: 'hover',
      }, `Read ${product.sku}`),
      selected === undefined ? null : createElement(CatalogForm, {
        id: `edit-${product.sku}`, sku: product.sku, name: product.name, label: 'Save product',
      }),
      selected === undefined ? null : createElement(DeleteCatalogForm, {
        id: `delete-${product.sku}`, sku: product.sku, label: 'Delete product',
      }),
    )),
    createElement(CatalogForm, { id: 'create-product', label: 'Create product' }),
    createElement(CatalogForm, { id: 'independent-product', label: 'Independent product' }),
  );
}
