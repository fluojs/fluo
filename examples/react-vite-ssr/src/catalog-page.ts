import { createElement, Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useForm, useNavigationGuard, type ReactFormBinding } from '@fluojs/react/client';
import { reactFormRoutes, reactPageRoutes } from './generated/react-pages';

export type CatalogPageProps = {
  readonly products: readonly { readonly sku: string; readonly name: string }[];
  readonly selected?: string;
  readonly searchQuery?: string;
  readonly sessionDemo?: boolean;
  readonly sessionIdentity?: string;
  readonly authenticatedCrud?: boolean;
  readonly backgroundDemo?: boolean;
  readonly queued?: readonly string[];
  readonly revision?: number;
};

export function BackgroundSearch({ id, query = '' }: { readonly id: string; readonly query?: string }) {
  const form = useForm<{ q: string }>({
    id, action: '/catalog/background/search', fields: { q: 'q' },
    mode: 'background', method: 'get', allowDestination: () => false,
  });
  const data = form.state.mutation?.status === 'read' ? form.state.mutation.data : undefined;
  const rows: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'rows') : undefined;
  return createElement('form', { ...form.formProps, 'aria-label': id, 'data-enhanced': String(form.connected) },
    createElement('label', { htmlFor: `${id}-q` }, id),
    createElement('input', { ...form.fieldProps('q'), defaultValue: query }),
    createElement('button', { type: 'submit' }, 'Search songs'),
    createElement('output', { 'data-form-state': id, 'aria-live': 'polite' },
      form.state.pending ? 'pending' : form.state.mutation?.status ?? 'idle'),
    createElement('output', { 'data-search-result': id },
      Array.isArray(rows) ? rows.flatMap((row: unknown) => typeof row === 'object' && row !== null
        && typeof Reflect.get(row, 'name') === 'string' ? [Reflect.get(row, 'name')] : []).join(', ') : ''),
    form.state.pending ? createElement('button', { type: 'button', onClick: form.cancel }, 'Cancel search') : null,
  );
}
function QueueForm({ sku, queued }: { readonly sku: string; readonly queued: boolean }) {
  const id = `queue-${sku}`;
  const route = reactFormRoutes['POST /catalog/background/queue/:sku CatalogRouter queueWrite'];
  const form = useForm({
    id, action: route.href({ sku }), contract: route.contract,
    mode: 'background', allowDestination: () => false,
  });
  const result = form.state.mutation;
  return createElement('form', { ...form.formProps, 'aria-label': id, 'data-enhanced': String(form.connected) },
    createElement('input', { ...form.fieldProps('csrf'), type: 'hidden', value: 'catalog-demo-token' }),
    createElement('button', { ...form.fieldProps('intent'), type: 'submit', value: queued ? 'remove' : 'add' },
      queued ? 'Remove song' : 'Add song'),
    createElement('output', { 'data-form-state': id, 'aria-live': 'polite' },
      form.state.pending ? 'pending' : `${result?.status ?? 'idle'} read:${form.state.followUp?.status ?? 'idle'}`),
    createElement('output', { 'data-operation-ack': id }, result?.status === 'saved' ? JSON.stringify(result.data) : ''),
    form.state.pending ? createElement('button', { type: 'button', onClick: form.cancel }, 'Cancel waiting') : null,
    result?.status === 'saved' && form.state.followUp?.status !== 'complete'
      ? createElement('button', { type: 'button', onClick: () => { void form.retryRead(); } }, 'Retry read only') : null,
  );
}

const createRoute = reactFormRoutes['POST /catalog/create CatalogRouter create'];
const updateRoute = reactFormRoutes['POST /catalog/:sku/update CatalogRouter update'];
const deleteRoute = reactFormRoutes['POST /catalog/:sku/delete CatalogRouter delete'];

function allowCatalogDestination(destination: string): boolean {
  const url = new URL(destination);
  return url.origin === window.location.origin && (url.pathname === '/catalog' || /^\/catalog\/[a-zA-Z0-9-]+$/u.test(url.pathname));
}
function allowAuthenticatedDestination(destination: string): boolean {
  const url = new URL(destination);
  return url.origin === window.location.origin
    && (url.pathname === '/catalog/session/products' || /^\/catalog\/session\/products\/[a-zA-Z0-9-]+$/u.test(url.pathname));
}

function FormStatus({ id, form, onProtection }: {
  readonly id: string;
  readonly form: Pick<ReactFormBinding<object>, 'state' | 'cancel' | 'retryRead'>;
  readonly onProtection?: (id: string, protectedWork: boolean) => void;
}) {
  const mutation = form.state.mutation;
  useEffect(() => {
    onProtection?.(id, form.state.dirty || form.state.pending);
  }, [id, onProtection, form.state.dirty, form.state.pending]);
  useEffect(() => () => onProtection?.(id, false), [id, onProtection]);
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

export function CatalogForm({ id, sku, name = '', label, authenticated = false, onProtection }: {
  readonly id: string; readonly sku?: string; readonly name?: string; readonly label: string;
  readonly authenticated?: boolean;
  readonly onProtection?: (id: string, protectedWork: boolean) => void;
}) {
  const create = authenticated ? reactFormRoutes['POST /catalog/session/products/create CatalogRouter authenticatedCreate'] : createRoute;
  const update = authenticated ? reactFormRoutes['POST /catalog/session/products/:sku/update CatalogRouter authenticatedUpdate'] : updateRoute;
  const form = useForm({
    id, action: sku === undefined ? create.href() : update.href({ sku }),
    contract: sku === undefined ? create.contract : update.contract,
    allowDestination: authenticated ? allowAuthenticatedDestination : allowCatalogDestination,
  });
  return createElement('form', { ...form.formProps, 'aria-label': label, 'data-enhanced': String(form.connected) },
    createElement('input', { ...form.fieldProps('csrf'), type: 'hidden', value: 'catalog-demo-token' }),
    createElement('label', { htmlFor: `${id}-name` }, label),
    createElement('input', { ...form.fieldProps('name'), defaultValue: name, required: true, minLength: 3,
      'aria-describedby': `${id}-name-errors`, 'aria-invalid': form.fieldErrors('name').length > 0 }),
    createElement('p', { id: `${id}-name-errors` }, form.fieldErrors('name').join(' ')),
    createElement('button', { ...form.fieldProps('intent'), type: 'submit', value: 'save',
      onClick(event) { if (authenticated) event.currentTarget.focus(); } }, label),
    createElement(FormStatus, { id, form, ...(onProtection === undefined ? {} : { onProtection }) }),
  );
}

function DeleteCatalogForm({ id, sku, label, authenticated = false, onProtection }: {
  readonly id: string; readonly sku: string; readonly label: string;
  readonly authenticated?: boolean;
  readonly onProtection?: (id: string, protectedWork: boolean) => void;
}) {
  const route = authenticated ? reactFormRoutes['POST /catalog/session/products/:sku/delete CatalogRouter authenticatedDelete'] : deleteRoute;
  const form = useForm({
    id, action: route.href({ sku }), contract: route.contract,
    allowDestination: authenticated ? allowAuthenticatedDestination : allowCatalogDestination,
  });
  return createElement('form', { ...form.formProps, 'aria-label': label, 'data-enhanced': String(form.connected) },
    createElement('input', { ...form.fieldProps('csrf'), type: 'hidden', value: 'catalog-demo-token' }),
    createElement('button', { ...form.fieldProps('intent'), type: 'submit', value: 'delete' }, label),
    createElement(FormStatus, { id, form, ...(onProtection === undefined ? {} : { onProtection }) }),
  );
}

export default function CatalogPage({
  products, selected, sessionDemo, sessionIdentity, authenticatedCrud = false, backgroundDemo, queued = [], searchQuery, revision,
}: CatalogPageProps) {
  const [protect, setProtect] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [work, setWork] = useState<Readonly<Record<string, boolean>>>({});
  const onProtection = useCallback((id: string, active: boolean) => {
    setWork((current) => current[id] === active ? current : { ...current, [id]: active });
  }, []);
  const decision = useNavigationGuard({ when: protect && (draftDirty || Object.values(work).some(Boolean)), beforeUnload: true });
  const controls = createElement('aside', {
    'aria-label': 'Navigation protection',
    'data-protected': String(protect && (draftDirty || Object.values(work).some(Boolean))),
  },
    createElement('label', null,
      createElement('input', { type: 'checkbox', checked: protect, onChange: () => setProtect((current) => !current) }),
      'Protect edits'),
    decision === null ? null : createElement('section', { role: 'dialog', 'aria-label': 'Unsaved navigation' },
      createElement('p', null, `Leave for ${decision.intent.destination}? Pending writes may still persist.`),
      createElement('button', { type: 'button', onClick: decision.stay }, 'Stay here'),
      createElement('button', { type: 'button', onClick: decision.proceed }, 'Proceed with navigation')),
  );
  if (backgroundDemo === true) {
    return createElement('section', { 'aria-label': 'Background jukebox', 'data-revision': revision },
      createElement('h1', null, 'Background catalog and jukebox'),
      createElement('a', { href: '/catalog/login' }, 'Sign in as demo editor'),
      createElement(Link, reactPageRoutes['GET /catalog CatalogRouter list'].link(), 'Product list'),
      createElement(BackgroundSearch, { id: 'song-search', ...(searchQuery === undefined ? {} : { query: searchQuery }) }),
      ...products.map((song) => createElement('article', { key: song.sku, 'data-song': song.sku },
        createElement('p', null, song.name),
        createElement('output', { 'data-queued': song.sku }, String(queued.includes(song.sku))),
        createElement(QueueForm, { sku: song.sku, queued: queued.includes(song.sku) }),
      )),
    );
  }
  if (sessionDemo === true) {
    return createElement('section', { 'aria-label': 'Session page' },
      controls,
      createElement('h1', null, typeof sessionIdentity === 'string' ? `Session ${sessionIdentity}` : 'Session sign in'),
      ...products.map((product) => createElement('p', { key: product.sku, 'data-product': product.sku }, product.name)),
      typeof sessionIdentity === 'string'
        ? createElement('input', { 'aria-label': 'Protected draft', defaultValue: `Private draft ${sessionIdentity}`,
          onInput: () => setDraftDirty(true) }) : null,
      typeof sessionIdentity === 'string'
        ? createElement(Link, reactPageRoutes['GET /catalog/session/products CatalogRouter authenticatedList'].link(), 'Authenticated products') : null,
    );
  }
  return createElement('section', { 'aria-label': authenticatedCrud ? 'Authenticated catalog CRUD' : 'Catalog CRUD' },
    controls,
    createElement('h1', null, searchQuery !== undefined ? `Catalog search: ${searchQuery}` : selected === undefined
      ? authenticatedCrud ? 'Authenticated products' : 'Catalog' : `Product ${selected}`),
    authenticatedCrud ? createElement('p', null, `Demo session ${sessionIdentity}; process-local products, not durable storage.`)
      : createElement('a', { href: '/catalog/login' }, 'Sign in as demo editor'),
    createElement(Link, authenticatedCrud
      ? reactPageRoutes['GET /catalog/session/products CatalogRouter authenticatedList'].link()
      : reactPageRoutes['GET /catalog CatalogRouter list'].link(), 'Product list'),
    authenticatedCrud ? createElement('form', { method: 'get', action: '/catalog/session/products', 'aria-label': 'Product search' },
      createElement('label', { htmlFor: 'product-query' }, 'Search products'),
      createElement('input', { id: 'product-query', name: 'q', defaultValue: searchQuery ?? '' }),
      createElement('button', { type: 'submit' }, 'Search products'))
      : createElement(Link, { href: '/catalog/search?q=draft' }, 'Search catalog'),
    ...products.map((product) => createElement('article', { key: product.sku },
      createElement('p', { 'data-product': product.sku }, product.name),
      createElement(Link, {
        ...(authenticatedCrud
          ? reactPageRoutes['GET /catalog/session/products/:sku CatalogRouter authenticatedDetail'].link({ sku: product.sku })
          : { ...reactPageRoutes['GET /catalog/:sku CatalogRouter detail'].link({ sku: product.sku }), prefetch: 'hover' as const }),
      }, `Read ${product.sku}`),
      selected === undefined ? null : createElement(CatalogForm, {
        id: `edit-${product.sku}`, sku: product.sku, name: product.name, label: 'Save product', authenticated: authenticatedCrud, onProtection,
      }),
      selected === undefined ? null : createElement(DeleteCatalogForm, {
        id: `delete-${product.sku}`, sku: product.sku, label: 'Delete product', authenticated: authenticatedCrud, onProtection,
      }),
    )),
    createElement(CatalogForm, { id: 'create-product', label: 'Create product', authenticated: authenticatedCrud, onProtection }),
    createElement(CatalogForm, { id: 'independent-product', label: 'Independent product', authenticated: authenticatedCrud, onProtection }),
  );
}
