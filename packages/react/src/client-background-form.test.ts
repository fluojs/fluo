// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createClientFormStore, type FormEnvironment } from './client/form-store.js';
import { submitHttpForm } from './client/form-transport.js';
import { createClientNavigationStore } from './client/store.js';
import { createReactRouteSnapshot } from './client/snapshot.js';
import type { ReactNavigationLoadResult } from './client/navigation-payload.js';

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Missing resolver'); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const submission = { action: 'http://localhost:3000/search', body: new URLSearchParams({ q: 'old' }) };
const environment = (): FormEnvironment => ({
  approve: vi.fn(async () => ({ status: 'complete' as const })),
  invalidate: vi.fn(), allowDestination: vi.fn(() => true), rememberForms: vi.fn(),
});
const saved = (revision: number) => new Response(JSON.stringify({
  version: 1, outcome: 'saved', destination: '/other', followUp: 'navigate', data: { revision },
}), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } });
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('supersedes only the same background operation before its abort-ignoring response settles', async () => {
  // Given: an older POST is held and another independent operation is idle.
  const held = deferred<Response>();
  const started = deferred<void>();
  const send = vi.fn().mockImplementationOnce(() => { started.resolve(); return held.promise; })
    .mockResolvedValueOnce(saved(2));
  vi.stubGlobal('fetch', send);
  const store = createClientFormStore('background');
  const other = createClientFormStore('background');
  const env = environment();
  const old = store.submit(submission, env);
  await started.promise;
  // When: a new explicit operation replaces the old one.
  await store.submit({ ...submission, body: new URLSearchParams({ q: 'new' }) }, env);
  // Then: two requests were dispatched without waiting for the old response.
  expect(send).toHaveBeenCalledTimes(2);
  await old;
  expect(store.getSnapshot().mutation).toMatchObject({ status: 'saved', data: { revision: 2 } });
  expect(other.getSnapshot().mutation).toBeNull();
  held.resolve(saved(1));
  expect(store.getSnapshot().mutation).toMatchObject({ data: { revision: 2 } });
});

it('reads plain JSON through GET without a POST body or mutation invalidation', async () => {
  // Given: an ordinary HTTP JSON read, not a navigation payload.
  const send = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ rows: ['new'] }));
  vi.stubGlobal('fetch', send);
  // When: successful controls select the background GET method.
  const result = await submitHttpForm({ ...submission, method: 'get' }, new AbortController().signal);
  // Then: the transport replaces the native query and exposes a read discriminator.
  expect(result).toEqual({ status: 'read', data: { rows: ['new'] } });
  expect(send).toHaveBeenCalledWith('http://localhost:3000/search?q=old', expect.objectContaining({
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
    headers: { Accept: 'application/json' },
  }));
  expect(send.mock.calls[0]?.[1]).not.toHaveProperty('body');
});

it.each(['missing', 'malformed'] as const)('does not grant a generated read type when its decoder is %s', async (decoder) => {
  // Given: ordinary untrusted JSON and a generated saved-data contract.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ revision: 'untrusted' })));
  const form = createClientFormStore('background');
  const env: FormEnvironment = { ...environment(), decodeSaved: (value) => value,
    ...(decoder === 'missing' ? {} : { decodeRead: () => { throw new TypeError('Invalid revision'); } }) };
  // When: a GET requests data through that contract.
  await form.submit({ ...submission, method: 'get' }, env);
  // Then: no unchecked Data projection or mutation invalidation is observable.
  expect(form.getSnapshot().mutation).toEqual({ status: 'error', reason: 'protocol' });
  expect(env.invalidate).not.toHaveBeenCalled();
});

it('does not execute a handler navigate follow-up from a background acknowledgement', async () => {
  // Given: the handler confirms persistence but requests another page.
  vi.stubGlobal('fetch', vi.fn(async () => saved(1)));
  const env = environment();
  const store = createClientFormStore('background');
  // When: the opt-in operation receives the acknowledgement.
  await store.submit(submission, env);
  // Then: a separate current-page refresh is requested, never the handler destination.
  expect(store.getSnapshot().mutation?.status).toBe('saved');
  expect(env.approve).toHaveBeenCalledWith(expect.any(String), 'refresh', expect.any(AbortSignal));
  expect(env.allowDestination).not.toHaveBeenCalled();
});

function navigation(load: (href: string, signal: AbortSignal) => Promise<ReactNavigationLoadResult>) {
  let href = 'http://localhost:3000/catalog#queue';
  const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/catalog#queue', params: {} }));
  const push = vi.fn((next: string) => { href = next; });
  const disconnect = store.connect({
    currentHref: () => href, load, assign: vi.fn(), replace: vi.fn(), reload: vi.fn(), back: vi.fn(),
    pushState: push, replaceState: vi.fn(), subscribe: () => () => {},
  });
  return { store, push, disconnect };
}
const approved = (revision: number): ReactNavigationLoadResult => ({
  ok: true, component: () => null, payload: {
    version: 2, buildId: 'test', url: '/catalog', params: {},
    destination: { module: './catalog.ts', props: { revision } },
  },
});

it('coalesces two acknowledgements and lets one waiter cancel without cancelling the shared HTTP approval', async () => {
  // Given: fresh current-page HTTP approval is held.
  const started = deferred<void>();
  const response = deferred<ReactNavigationLoadResult>();
  const load = vi.fn(() => { started.resolve(); return response.promise; });
  const browser = navigation(load);
  const first = new AbortController();
  const second = new AbortController();
  const a = browser.store.approveBackground(first.signal, createClientFormStore('background'));
  const b = browser.store.approveBackground(second.signal, createClientFormStore('background'));
  await started.promise;
  // When: only one waiter is cancelled and the real loader approves.
  first.abort();
  expect(await a).toEqual({ status: 'cancelled' });
  response.resolve(approved(2));
  // Then: the second result commits without a history write.
  expect(await b).toEqual({ status: 'complete' });
  expect(load).toHaveBeenCalledOnce();
  expect(browser.push).not.toHaveBeenCalled();
  expect(browser.store.getSnapshot().url).toBe('/catalog#queue');
  expect(browser.store.getDestination()?.props).toMatchObject({ revision: 2 });
  browser.disconnect();
});

it('settles stale refresh before releasing its abort-ignoring response and approves only the latest revision', async () => {
  // Given: revision one is held in an uncooperative HTTP load.
  const started = deferred<void>();
  const stale = deferred<ReactNavigationLoadResult>();
  const load = vi.fn().mockImplementationOnce(() => { started.resolve(); return stale.promise; })
    .mockResolvedValueOnce(approved(2));
  const browser = navigation(load);
  const old = browser.store.approveBackground(new AbortController().signal, createClientFormStore('background'));
  await started.promise;
  // When: another write revokes that read and confirms a newer revision.
  browser.store.invalidateBackground();
  expect(await old).toEqual({ status: 'cancelled' });
  await browser.store.approveBackground(new AbortController().signal, createClientFormStore('background'));
  stale.resolve(approved(1));
  await stale.promise;
  // Then: only the newest HTTP-approved props survive.
  expect(browser.store.getDestination()?.props).toMatchObject({ revision: 2 });
  expect(load).toHaveBeenCalledTimes(2);
  browser.disconnect();
});

it.each([401, 403, 404, 422, 500])('does not promote an HTTP %s GET error body to read success', async (status) => {
  // Given: the HTTP handler rejects a request even though its body is valid JSON.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ rows: ['private'] }, { status })));
  // When: the ordinary GET transport receives it.
  const result = await submitHttpForm({ ...submission, method: 'get' }, new AbortController().signal);
  // Then: no typed read data can be consumed.
  expect(result.status).not.toBe('read');
  expect(result).not.toHaveProperty('data');
});

it('revokes a session-owned read before an abort listener can commit retained data', async () => {
  // Given: a provider-local session lease and a body that ignores abort.
  const response = deferred<Response>();
  const started = deferred<void>();
  vi.stubGlobal('fetch', vi.fn(() => { started.resolve(); return response.promise; }));
  const browser = navigation(async () => approved(1));
  const form = createClientFormStore('background');
  browser.store.forms.set('background\0search', form);
  const work = form.submit({ ...submission, method: 'get' }, {
    ...environment(), lease: browser.store.sessionLease,
  });
  await started.promise;
  // When: explicit logout closes every old provider lease.
  await browser.store.router.sessionChanged({ epoch: 'b', reason: 'logout' });
  await work;
  response.resolve(Response.json({ rows: ['obsolete'] }));
  // Then: no private old result remains and the map cannot reuse the old owner.
  expect(form.getSnapshot().mutation).toBeNull();
  expect(browser.store.forms.size).toBe(0);
  browser.disconnect();
});

it('combines already-dispatched sibling write settlement into one latest fresh page GET', async () => {
  // Given: two independent POSTs are held and a provider supplies real approval authority.
  const a = deferred<Response>();
  const b = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
  const load = vi.fn(async () => approved(2));
  const browser = navigation(load);
  const first = createClientFormStore('background');
  const second = createClientFormStore('background');
  browser.store.forms.set('background\0first', first);
  browser.store.forms.set('background\0second', second);
  const env = (origin: typeof first): FormEnvironment => ({
    ...environment(), invalidate: browser.store.invalidateBackground,
    approve: (_href, _followUp, signal) => browser.store.approveBackground(signal, origin),
  });
  const ack = deferred<void>();
  const unsubscribe = first.subscribe(() => { if (first.getSnapshot().mutation?.status === 'saved') ack.resolve(); });
  const one = first.submit(submission, env(first));
  const two = second.submit(submission, env(second));
  // When: acknowledgements arrive separately while both writes were already dispatched.
  a.resolve(saved(1));
  await ack.promise;
  expect(load).not.toHaveBeenCalled();
  b.resolve(saved(2));
  await Promise.all([one, two]);
  // Then: both saved outcomes share a single newest HTTP-approved read.
  expect(load).toHaveBeenCalledOnce();
  expect(first.getSnapshot().followUp).toEqual({ status: 'complete' });
  expect(second.getSnapshot().followUp).toEqual({ status: 'complete' });
  unsubscribe();
  browser.disconnect();
});

it.each(['push', 'replace', 'back', 'refresh'] as const)('retains a live shell background read across %s intent', async (intent) => {
  // Given: the live shell owns a held GET, independently of the navigation store's pending.
  const response = deferred<Response>();
  const started = deferred<void>();
  vi.stubGlobal('fetch', vi.fn(() => { started.resolve(); return response.promise; }));
  const browser = navigation(async () => approved(1));
  const form = createClientFormStore('background');
  browser.store.forms.set('background\0shell', form);
  const work = form.submit({ ...submission, method: 'get' }, environment());
  await started.promise;
  // When: user navigation occurs but the actual shell owner has not unmounted.
  if (intent === 'push' || intent === 'replace') browser.store.router[intent]('/catalog?next=1');
  else if (intent === 'back') browser.store.router.back();
  else await browser.store.router.refresh();
  // Then: no blanket navigation cancellation consumes that background lease.
  expect(form.getSnapshot().pending).toBe(true);
  response.resolve(Response.json({ rows: ['shell-result'] }));
  await work;
  expect(form.getSnapshot().mutation).toEqual({ status: 'read', data: { rows: ['shell-result'] } });
  browser.disconnect();
});

it('rejects duplicate live row ids and settles only the actual departing owner before reuse', async () => {
  // Given: a stable row store with one live owner and an abort-ignoring read.
  const owner = {};
  const form = document.createElement('form');
  const duplicate = document.createElement('form');
  document.body.append(form, duplicate);
  const store = createClientFormStore('background');
  store.attach(form, owner);
  expect(() => store.attach(duplicate, {})).toThrow(/unique/u);
  const response = deferred<Response>();
  const started = deferred<void>();
  vi.stubGlobal('fetch', vi.fn(() => { started.resolve(); return response.promise; }));
  const work = store.submit({ ...submission, method: 'get' }, environment());
  await started.promise;
  // When: a different owner attempts release, then the actual owner leaves.
  expect(store.release({})).toBe(false);
  expect(store.getSnapshot().pending).toBe(true);
  expect(store.release(owner)).toBe(true);
  await work;
  // Then: cleanup settles immediately, without waiting for server completion.
  expect(store.getSnapshot().mutation).toEqual({ status: 'error', reason: 'cancelled' });
  response.resolve(Response.json({ rows: ['late'] }));
});
