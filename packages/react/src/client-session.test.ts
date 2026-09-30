import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactClientRouterProvider, useRouterState } from './client.js';
import { createReactRouteSnapshot } from './client/snapshot.js';
import { createClientNavigationStore } from './client/store.js';
import type { ReactNavigationLoadResult } from './client/navigation-payload.js';
import type { ReactSessionOptions } from './client/types.js';

function gate<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized gate'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function fixture(options?: ReactSessionOptions) {
  let href = 'https://example.test/protected';
  const started = gate<void>();
  const response = gate<ReactNavigationLoadResult>();
  let signal: AbortSignal | undefined;
  const load = vi.fn((_href: string, nextSignal: AbortSignal) => {
    signal = nextSignal;
    started.resolve();
    return response.promise;
  });
  const assign = vi.fn();
  const replace = vi.fn();
  const store = createClientNavigationStore(createReactRouteSnapshot({
    url: '/protected', params: { identity: 'a' }, metadata: { title: 'Protected A' },
  }), options);
  store.connect({
    currentHref: () => href, load, assign, replace, back: vi.fn(), reload: vi.fn(),
    pushState: (next) => { href = next; }, replaceState: (next) => { href = next; },
    subscribe: () => () => {},
  });
  return { store, started, response, load, assign, replace, href: () => href, signal: () => signal };
}

it('provides one explicit session notification on the existing router', () => {
  // Given: a connected provider store, not a second notifier/provider.
  const { store } = fixture();
  // When/Then: the public router exposes its canonical session boundary.
  expect(typeof Reflect.get(store.router, 'sessionChanged')).toBe('function');
});

it('includes the configured initial approval epoch in the actual provider SSR output', () => {
  // Given: the actual existing provider with an application-issued initial epoch.
  const Probe = () => createElement('script', { type: 'application/json' }, JSON.stringify(useRouterState().session));
  // When: React renders this provider through the real server renderer.
  const html = renderToStaticMarkup(createElement(ReactClientRouterProvider, {
    initialSnapshot: createReactRouteSnapshot({ url: '/protected', params: {} }),
    session: { epoch: 'initial-a' },
  }, createElement(Probe)));
  // Then: machine-consumed SSR session fields agree with hydration's initial approval.
  expect(JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))))
    .toEqual({ epoch: 'initial-a', generation: 0, status: 'approved' });
});

it('advances repeated epoch labels and cancels only the notifying provider leases', async () => {
  // Given: independent provider-local session ownership.
  const first = fixture({ epoch: 'a' });
  const other = fixture({ epoch: 'a' });
  const old = first.store.sessionLease();
  const isolated = other.store.sessionLease();
  // When: the same nonsecret epoch is notified more than once.
  await first.store.router.sessionChanged({ epoch: 'a', reason: 'logout' });
  const generation = first.store.getSnapshot().session?.generation;
  const newer = first.store.sessionLease();
  await first.store.router.sessionChanged({ epoch: 'a', reason: 'logout' });
  // Then: labels are not used as operation ownership, and other providers remain unaffected.
  expect(old.current()).toBe(false);
  expect(newer.current()).toBe(false);
  expect(isolated.current()).toBe(true);
  expect(first.store.getSnapshot().session?.generation).toBe((generation ?? 0) + 1);
  expect(other.store.getSnapshot().session?.status).toBe('approved');
  isolated.release();
});

it('closes page approval before abort-listener reentrancy can start a read or fallback', async () => {
  // Given: an old load whose abort listener reenters the router.
  const browser = fixture();
  const operation = browser.store.router.refresh();
  await browser.started.promise;
  const signal = browser.signal();
  if (signal === undefined) throw new Error('Missing request signal');
  let approval: string | undefined;
  signal.addEventListener('abort', () => {
    approval = browser.store.getSnapshot().session?.status;
    browser.store.router.push('/other');
    void browser.store.router.refresh();
  }, { once: true });
  // When: explicit sign-out revokes approval before aborting that load.
  await browser.store.router.sessionChanged({ epoch: 'b', reason: 'logout' });
  // Then: no reentrant operation escapes the barrier.
  expect(approval).toBe('signed-out');
  expect(await operation).toEqual({ status: 'cancelled' });
  expect(browser.load).toHaveBeenCalledOnce();
  expect(browser.assign).not.toHaveBeenCalled();
  expect(browser.store.getDestination()).toBeNull();
});

it('settles superseded session policy before an abort-ignoring policy is released', async () => {
  // Given: a held login policy, subscribed before notification.
  const entered = gate<void>();
  const release = gate<'refresh'>();
  const browser = fixture({ epoch: 'a', policy: (context) => {
    if (context.reason !== 'login') return 'signed-out';
    entered.resolve();
    return release.promise;
  } });
  const old = browser.store.router.sessionChanged({ epoch: 'b', reason: 'login' });
  await entered.promise;
  // When: a later logout owns the session.
  await browser.store.router.sessionChanged({ epoch: 'c', reason: 'logout' });
  // Then: the old public notification cancels before its policy completes.
  expect(await old).toEqual({ status: 'cancelled' });
  expect(browser.store.getSnapshot().session?.epoch).toBe('c');
  expect(browser.load).not.toHaveBeenCalled();
  release.resolve('refresh');
});

it('settles anonymous speculation on logout without waiting for its abort-ignoring response', async () => {
  // Given: one held anonymous public read.
  const browser = fixture();
  const entered = gate<void>();
  const release = gate<ReactNavigationLoadResult>();
  const prefetch = vi.fn(() => { entered.resolve(); return release.promise; });
  browser.store.connect({
    currentHref: browser.href, assign: browser.assign, replace: browser.replace, back: vi.fn(), reload: vi.fn(),
    prefetchScope: 'public-a', prefetch, load: browser.load, pushState: vi.fn(), replaceState: vi.fn(),
    subscribe: () => () => {},
  });
  const work = browser.store.prefetch('/public', {});
  await entered.promise;
  // When: the provider session changes.
  await browser.store.router.sessionChanged({ epoch: 'b', reason: 'logout' });
  // Then: public cancellation settles without releasing the old HTTP body.
  await work;
  expect(browser.store.getSnapshot().session?.status).toBe('signed-out');
  release.resolve({ ok: false, reason: 'unauthorized' });
  expect(browser.assign).not.toHaveBeenCalled();
});

it('keeps credentialed session identity when anonymous speculation alone is unauthorized', async () => {
  // Given: an approved credentialed provider and an anonymous speculative denial.
  const browser = fixture({ epoch: 'credentialed-a' });
  browser.store.connect({
    currentHref: browser.href, assign: browser.assign, replace: browser.replace, back: vi.fn(), reload: vi.fn(),
    prefetchScope: 'public-a', prefetch: async () => ({ ok: false, reason: 'unauthorized' }),
    load: browser.load, pushState: vi.fn(), replaceState: vi.fn(), subscribe: () => () => {},
  });
  // When: only speculation encounters 401.
  await browser.store.prefetch('/public', {});
  // Then: it cannot log out the credentialed user or revoke their page.
  expect(browser.store.getSnapshot().session?.epoch).toBe('credentialed-a');
  expect(browser.store.getSnapshot().session?.status).toBe('approved');
  expect(browser.store.getSnapshot().params).toEqual({ identity: 'a' });
});

it('settles a revoked refresh before releasing an abort-ignoring old session load', async () => {
  // Given: old-session HTTP approval remains held.
  const { store, started, response, assign, replace } = fixture();
  const old = store.router.refresh();
  await started.promise;
  // When: the application explicitly signs out before that HTTP response completes.
  const notify: unknown = Reflect.get(store.router, 'sessionChanged');
  expect(typeof notify).toBe('function');
  if (typeof notify !== 'function') throw new TypeError('Missing canonical session boundary');
  await notify({ epoch: 'b', reason: 'logout' });
  // Then: public cancellation and content revocation settle before releasing old work.
  expect(await old).toEqual({ status: 'cancelled' });
  expect(store.getSnapshot().metadata).toBeUndefined();
  expect(store.getSnapshot().params).toEqual({});
  response.resolve({
    ok: true, component: () => null,
    payload: { version: 2, buildId: 'test', url: '/protected',
      params: { identity: 'a' }, destination: { module: './protected', props: { identity: 'a' } },
      metadata: { title: 'Protected A' } },
  });
  expect(assign).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});

it.each(['unauthorized', 'forbidden'] as const)('revokes old approval on fresh %s independently of failure preservation', async (reason) => {
  // Given: a fresh credentialed current-page read is held.
  const { store, started, response, assign } = fixture();
  const operation = store.router.refresh();
  await started.promise;
  // When: HTTP rejects approval, not anonymous speculation.
  response.resolve({ ok: false, reason });
  await operation;
  // Then: no protected params/head survive and no rejected soft destination is committed.
  expect(store.getSnapshot().metadata).toBeUndefined();
  expect(store.getSnapshot().params).toEqual({});
  expect(assign).not.toHaveBeenCalled();
});
