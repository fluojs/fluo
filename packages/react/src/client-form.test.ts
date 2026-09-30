// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createClientFormStore, type FormEnvironment } from './client/form-store.js';
import { captureFormSubmission, submitHttpForm } from './client/form-transport.js';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as Client from './client.js';
import { createReactRouteSnapshot } from './client/snapshot.js';
import { createClientNavigationStore } from './client/store.js';
import type { ReactNavigationLoadResult } from './client/navigation-payload.js';

const media = 'application/vnd.fluo.form+json;v=1';
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
function saved() {
  return new Response(JSON.stringify({
    version: 1, outcome: 'saved', destination: '/products/one', followUp: 'refresh',
  }), { headers: { 'Content-Type': media } });
}
function environment(): FormEnvironment {
  return {
    approve: vi.fn(async () => ({ status: 'complete' as const })),
    invalidate: vi.fn(),
    allowDestination: () => true,
    rememberForms: vi.fn(),
  };
}
const submission = { action: 'http://localhost:3000/products/one', body: new URLSearchParams({ name: 'One' }) };
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('uses a compatible copy through the same provider and isolates separate provider forms', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/forms');
  vi.resetModules();
  const compatible = await import('./client.js');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    version: 1, outcome: 'validation', fieldErrors: { name: ['Safe'] }, formErrors: [],
  }), { status: 400, headers: { 'Content-Type': media } })));
  function Form({ id }: { id: string }) {
    const binding = compatible.useForm<{ name: string }>({
      id, action: '/save', fields: { name: 'name' }, allowDestination: () => true,
    });
    return createElement('form', binding.formProps,
      createElement('input', { ...binding.fieldProps('name'), defaultValue: id }),
      createElement('button', { type: 'submit' }, id),
      createElement('output', { 'data-outcome': id }, binding.state.mutation?.status ?? 'idle'),
    );
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const initialSnapshot = createReactRouteSnapshot({ url: '/forms', params: {} });
  try {
    await act(async () => root.render(createElement('div', null,
      createElement(Client.ReactClientRouterProvider, { initialSnapshot }, createElement(Form, { id: 'first-copy' })),
      createElement(Client.ReactClientRouterProvider, { initialSnapshot }, createElement(Form, { id: 'second-provider' })),
    )));
    const first = container.querySelector('form');
    if (!(first instanceof HTMLFormElement)) throw new Error('Missing form');
    let release = () => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const transitioned = new Promise<void>((resolve, reject) => {
      release = resolve;
      timeout = setTimeout(() => reject(new Error('Form state transition did not arrive')), 5_000);
    });
    const observer = new MutationObserver(() => {
      if (container.querySelector('[data-outcome="first-copy"]')?.textContent === 'validation') release();
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    try {
      await act(async () => first.requestSubmit(first.querySelector('button')));
      await transitioned;
      expect(container.querySelector('[data-outcome="first-copy"]')?.textContent).toBe('validation');
      expect(container.querySelector('[data-outcome="second-provider"]')?.textContent).toBe('idle');
    } finally {
      observer.disconnect();
      clearTimeout(timeout);
    }
  } finally {
    await act(async () => root.unmount());
  }
});

it('skips busy activation without queuing while a second form remains independent', async () => {
  // Given: the first POST is held at a response barrier.
  const response = deferred<Response>();
  const started = deferred<void>();
  const send = vi.fn(async () => { started.resolve(); return response.promise; });
  vi.stubGlobal('fetch', send);
  const first = createClientFormStore();
  const second = createClientFormStore();
  const env = environment();
  const outstanding = first.submit(submission, env);
  await started.promise;
  // When: duplicate explicit activations occur before settlement and another form submits.
  await first.submit(submission, env);
  await first.submit(submission, env);
  send.mockImplementationOnce(async () => new Response(JSON.stringify({
    version: 1, outcome: 'validation', fieldErrors: { name: ['Correct the name.'] }, formErrors: [],
  }), { status: 400, headers: { 'Content-Type': media } }));
  await second.submit(submission, env);
  response.resolve(saved());
  await outstanding;
  // Then: exactly two POSTs ran, and only the first form is confirmed saved.
  expect(send).toHaveBeenCalledTimes(2);
  expect(first.getSnapshot().skipped).toBe(2);
  expect(first.getSnapshot().mutation?.status).toBe('saved');
  expect(second.getSnapshot().mutation?.status).toBe('validation');
  expect(env.invalidate).toHaveBeenCalledTimes(3);
});

it('keeps a confirmed save when its read fails and retries only GET approval', async () => {
  const send = vi.fn(async () => saved());
  vi.stubGlobal('fetch', send);
  const store = createClientFormStore();
  const read = vi.fn<FormEnvironment['approve']>()
    .mockResolvedValueOnce({ status: 'error', failure: { reason: 'server-error', destination: '/products/one', type: 'refresh' } })
    .mockResolvedValueOnce({ status: 'complete' });
  const env = { ...environment(), approve: read };
  await store.submit(submission, env);
  expect(store.getSnapshot().mutation?.status).toBe('saved');
  expect(store.getSnapshot().followUp?.status).toBe('error');
  await store.retryRead();
  expect(read).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledOnce();
  expect(store.getSnapshot().followUp).toEqual({ status: 'complete' });
});

it('keeps confirmed persistence when the application rejects a destination and rechecks policy without another POST', async () => {
  const send = vi.fn(async () => saved());
  vi.stubGlobal('fetch', send);
  const store = createClientFormStore();
  const allowDestination = vi.fn<FormEnvironment['allowDestination']>()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const env = { ...environment(), allowDestination };
  await store.submit(submission, env);
  expect(store.getSnapshot().mutation?.status).toBe('saved');
  expect(store.getSnapshot().followUp).toEqual({
    status: 'rejected', reason: 'unsupported-destination',
  });
  expect(env.approve).not.toHaveBeenCalled();
  await store.retryRead();
  expect(allowDestination).toHaveBeenCalledTimes(2);
  expect(env.approve).toHaveBeenCalledOnce();
  expect(store.getSnapshot().followUp).toEqual({ status: 'complete' });
  expect(send).toHaveBeenCalledOnce();
});

it('settles cancellation before an uncooperative late body and preserves a newer attempt', async () => {
  const body = deferred<string>();
  const reading = deferred<void>();
  const response = saved();
  vi.spyOn(response, 'text').mockImplementation(() => { reading.resolve(); return body.promise; });
  const send = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(saved());
  vi.stubGlobal('fetch', send);
  const store = createClientFormStore();
  const env = environment();
  const old = store.submit(submission, env);
  await reading.promise;
  store.cancel();
  await old;
  expect(store.getSnapshot().mutation).toEqual({ status: 'uncertain', reason: 'cancelled' });
  await store.submit({ ...submission, body: new URLSearchParams({ name: 'New' }) }, env);
  body.resolve(JSON.stringify({ version: 1, outcome: 'validation', fieldErrors: { name: ['Old'] }, formErrors: [] }));
  await response.text();
  expect(store.getSnapshot().mutation?.status).toBe('saved');
  expect(env.approve).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(2);
});

it('cancels a late asynchronous destination policy without initiating stale reads', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => saved()));
  const decision = deferred<boolean>();
  const policyEntered = deferred<void>();
  const env = { ...environment(), allowDestination: () => { policyEntered.resolve(); return decision.promise; } };
  const store = createClientFormStore();
  const work = store.submit(submission, env);
  await policyEntered.promise;
  store.cancel();
  decision.resolve(true);
  await work;
  expect(store.getSnapshot().mutation?.status).toBe('saved');
  expect(store.getSnapshot().followUp).toEqual({ status: 'cancelled' });
  expect(env.approve).not.toHaveBeenCalled();
});

it.each([
  [401, 'auth'], [403, 'auth'], [500, 'uncertain'], [400, 'rejected'], [422, 'rejected'],
])('classifies status %s without parsing authentication from body prose', async (status, outcome) => {
  const send = vi.fn(async () => new Response('not a negotiated outcome', { status }));
  vi.stubGlobal('fetch', send);
  expect((await submitHttpForm(submission, new AbortController().signal)).status).toBe(outcome);
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(submission.action, expect.objectContaining({
    credentials: 'same-origin', cache: 'no-store', redirect: 'manual', method: 'POST',
  }));
});

it('does not infer save success from opaque redirects or malformed negotiated responses', async () => {
  const opaque = new Response();
  Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(opaque).mockResolvedValueOnce(
    new Response('{', { headers: { 'Content-Type': media } }),
  ));
  expect(await submitHttpForm(submission, new AbortController().signal)).toEqual({ status: 'uncertain', reason: 'redirect' });
  expect(await submitHttpForm(submission, new AbortController().signal)).toEqual({ status: 'uncertain', reason: 'protocol' });
});

it('captures native successful controls and submitter overrides before intercepting', () => {
  window.history.replaceState(null, '', '/products/one');
  const form = document.createElement('form');
  form.action = '/products/one'; form.method = 'post';
  form.innerHTML = '<input name="name" value="One"><input name="tag" value="a"><input name="tag" value="b"><input name="csrf" type="hidden" value="token"><input name="ignored" disabled value="secret"><button name="intent" value="save" formaction="/products/two">Save</button>';
  document.body.append(form);
  const button = form.querySelector('button');
  const result = captureFormSubmission(form, button, ['/products/one', '/products/two']);
  expect(result?.action).toBe(new URL('/products/two', window.location.href).href);
  expect(result?.body.getAll('tag')).toEqual(['a', 'b']);
  expect(result?.body.get('csrf')).toBe('token');
  expect(result?.body.has('ignored')).toBe(false);
  expect(result?.body.get('intent')).toBe('save');
  button?.setAttribute('formmethod', 'get');
  expect(captureFormSubmission(form, button, ['/products/two'])).toBeUndefined();
  button?.setAttribute('formmethod', 'post');
  button?.setAttribute('formtarget', '_blank');
  expect(captureFormSubmission(form, button, ['/products/two'])).toBeUndefined();
  button?.removeAttribute('formtarget');
  button?.setAttribute('formenctype', 'multipart/form-data');
  expect(captureFormSubmission(form, button, ['/products/two'])).toBeUndefined();
});

it('preserves a transferred form lease and cancels only the actual final owner', async () => {
  const form = document.createElement('form');
  form.innerHTML = '<input name="display_name" value="x">';
  document.body.append(form);
  const oldOwner = {};
  const newOwner = {};
  const store = createClientFormStore();
  store.attach(form, oldOwner);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    version: 1, outcome: 'validation', fieldErrors: { name: ['Safe error'] }, formErrors: [],
  }), { status: 400, headers: { 'Content-Type': media } })));
  await store.submit({
    ...submission, body: new URLSearchParams({ display_name: 'x' }),
  }, environment());
  const replacement = document.createElement('form');
  replacement.innerHTML = '<input name="display_name" value="server default">';
  document.body.append(replacement);
  store.attach(replacement, newOwner);
  store.attach(null, oldOwner);
  expect(store.release(oldOwner)).toBe(false);
  expect(store.getSnapshot().mutation?.status).toBe('validation');
  expect(replacement.querySelector('input')?.value).toBe('x');
  expect(store.unchanged('display_name')).toBe(true);
  expect(store.release(newOwner)).toBe(true);
});

it.each([
  { selected: [] },
  { selected: [''] },
  { selected: ['a', 'b'] },
  { selected: ['a', 'a', 'b'] },
])('retains every selected value when an unrelated form is replaced: $selected', ({ selected }) => {
  // Given: a supported multiple select has two successful values.
  const store = createClientFormStore();
  const original = document.createElement('form');
  const options = '<option value="">Empty</option><option value="a">A</option><option value="a">Another A</option><option value="b">B</option><option value="c" selected>C</option>';
  original.innerHTML = `<select name="tag" multiple>${options}</select>`;
  const remaining = [...selected];
  for (const option of original.querySelectorAll('option')) {
    const index = remaining.indexOf(option.value);
    option.selected = index !== -1;
    if (index !== -1) remaining.splice(index, 1);
  }
  document.body.append(original);
  store.attach(original);
  store.remember();
  const replacement = document.createElement('form');
  replacement.innerHTML = `<select name="tag" multiple>${options}</select>`;
  document.body.append(replacement);

  // When: the provider transfers retained input to the replacement form.
  store.attach(replacement);

  // Then: both selections and their submitted values survive.
  expect(Array.from(replacement.querySelectorAll('option'))
    .filter((option) => option.selected).map((option) => option.value)).toEqual(selected);
  // Native successful-control serialization is asserted unchanged in form-retention.spec.ts;
  // happy-dom's FormData SELECT branch only appends control.value.
});

it('keeps a newer form navigation authoritative over an older outstanding POST', async () => {
  // Given: two actual form stores share the real navigation store.
  const oldResponse = deferred<Response>();
  const oldAcknowledgement = new Response(JSON.stringify({
    version: 1, outcome: 'saved', destination: '/forms', followUp: 'refresh',
  }), { headers: { 'Content-Type': media } });
  const oldStarted = deferred<void>();
  const newRead = deferred<ReactNavigationLoadResult>();
  const newReadStarted = deferred<void>();
  const navigation = createClientNavigationStore(createReactRouteSnapshot({ url: '/forms' }));
  const first = createClientFormStore();
  const second = createClientFormStore();
  navigation.forms.set('first', first);
  navigation.forms.set('second', second);
  let href = 'http://localhost:3000/forms';
  let newSignal: AbortSignal | undefined;
  const approved = (url: string): ReactNavigationLoadResult => ({
    ok: true,
    component: () => createElement('h1', null, 'Approved'),
    payload: {
      version: 2, buildId: 'form-test', url, params: {},
      destination: { module: './page.ts', props: {} },
    },
  });
  const load = vi.fn(async (destination: string, signal: AbortSignal) => {
    if (new URL(destination).pathname === '/new-target') {
      newSignal = signal;
      newReadStarted.resolve();
      return newRead.promise;
    }
    return approved('/forms');
  });
  const disconnect = navigation.connect({
    currentHref: () => href, load,
    assign: vi.fn(), back: vi.fn(), reload: vi.fn(), replace: vi.fn(),
    pushState: (url) => { href = url; },
    replaceState: (url) => { href = url; },
    subscribe: () => () => {},
  });
  const forForm = (origin: ReturnType<typeof createClientFormStore>): FormEnvironment => ({
    approve: (destination, followUp, signal) =>
      navigation.approveForm(destination, followUp, signal, origin),
    invalidate: navigation.router.invalidate,
    allowDestination: () => true,
    rememberForms: () => {},
  });
  const send = vi.fn()
    .mockImplementationOnce(() => { oldStarted.resolve(); return oldResponse.promise; })
    .mockResolvedValueOnce(new Response(JSON.stringify({
      version: 1, outcome: 'saved', destination: '/new-target', followUp: 'navigate',
    }), { headers: { 'Content-Type': media } }));
  vi.stubGlobal('fetch', send);
  const oldWork = first.submit(submission, forForm(first));
  let newWork: Promise<void> | undefined;
  try {
    await oldStarted.promise;
    newWork = second.submit(submission, forForm(second));
    await newReadStarted.promise;

    // When: the older POST returns after the newer destination GET has begun.
    oldResponse.resolve(oldAcknowledgement);
    await oldWork;

    // Then: stale acknowledgement cannot cancel or replace the new GET.
    expect(first.getSnapshot().mutation).toEqual({ status: 'uncertain', reason: 'cancelled' });
    expect(newSignal?.aborted).toBe(false);
    newRead.resolve(approved('/new-target'));
    await newWork;
    expect(second.getSnapshot().mutation?.status).toBe('saved');
    expect(second.getSnapshot().followUp).toEqual({ status: 'complete' });
    expect(navigation.getSnapshot().url).toBe('/new-target');
    expect(load).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    oldResponse.resolve(oldAcknowledgement);
    newRead.resolve(approved('/new-target'));
    disconnect();
    await Promise.all([oldWork, newWork]);
  }
});

it('keeps later edits dirty and does not refocus errors for an earlier input revision', async () => {
  const response = deferred<Response>();
  const started = deferred<void>();
  vi.stubGlobal('fetch', vi.fn(async () => { started.resolve(); return response.promise; }));
  const store = createClientFormStore();
  const form = document.createElement('form');
  form.innerHTML = '<input name="name" value="Submitted">';
  document.body.append(form);
  store.attach(form);
  const operation = store.submit({ ...submission, body: new URLSearchParams({ name: 'Submitted' }) }, environment());
  await started.promise;
  const control = form.querySelector('input');
  if (control === null) throw new Error('Missing input');
  control.value = 'Later edit';
  store.changed();
  response.resolve(new Response(JSON.stringify({
    version: 1, outcome: 'validation', fieldErrors: { name: ['Earlier input error'] }, formErrors: [],
  }), { status: 400, headers: { 'Content-Type': media } }));
  await operation;
  expect(store.canFocus()).toBe(false);
  expect(store.unchanged('name')).toBe(false);
  expect(store.getSnapshot().dirty).toBe(true);
  expect(control.value).toBe('Later edit');
});
