import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactClientRouterProvider, useRouterState } from './client.js';
import { createReactRouteSnapshot } from './client/snapshot.js';
import { createClientNavigationStore } from './client/store.js';
import { createClientFormStore } from './client/form-store.js';
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

it('preserves the safe document exit for a legacy provider without session configuration', async () => {
  const browser = fixture();
  const operation = browser.store.router.refresh();
  await browser.started.promise;
  browser.response.resolve({ ok: false, reason: 'unauthorized' });
  expect(await operation).toEqual({ status: 'document' });
  expect(browser.assign).toHaveBeenCalledWith('https://example.test/protected');
});

it('consumes a fresh auth policy refresh decision with GET approval', async () => {
  const browser = fixture({ epoch: 'a', policy: () => 'refresh' });
  const retryStarted = gate<void>();
  browser.load.mockImplementationOnce(async () => ({ ok: false, reason: 'unauthorized' }));
  browser.load.mockImplementationOnce(async () => {
    retryStarted.resolve();
    return {
      ok: true, component: () => null,
      payload: { version: 2, buildId: 'test', url: '/protected',
        params: { identity: 'b' }, destination: { module: './protected', props: { identity: 'b' } },
      },
    };
  });
  const committed = gate<void>();
  const unsubscribe = browser.store.subscribe(() => {
    if (browser.store.getSnapshot().params.identity === 'b') committed.resolve();
  });
  try {
    const operation = browser.store.router.refresh();
    await retryStarted.promise;
    await committed.promise;
    await operation;
    expect(browser.load).toHaveBeenCalledTimes(2);
    expect(browser.assign).not.toHaveBeenCalled();
    expect(browser.store.getSnapshot().session?.status).toBe('approved');
  } finally {
    unsubscribe();
  }
}, 5_000);

it('keeps legacy document exits until an explicit session activation', async () => {
  const browser = fixture();
  browser.load.mockImplementation(async () => ({ ok: false, reason: 'unauthorized' }));
  expect(await browser.store.router.refresh()).toEqual({ status: 'document' });
  expect(await browser.store.router.refresh()).toEqual({ status: 'document' });
  await browser.store.router.sessionChanged({ epoch: 'activated', reason: 'logout' });
  expect((await browser.store.router.refresh()).status).toBe('error');
  expect(browser.assign).toHaveBeenCalledTimes(2);
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

it.each(['settlement', 'document'] as const)('cancels the coupled saved-login policy without retaining %s authority', async (check) => {
  const entered = gate<void>();
  const release = gate<{ readonly document: string }>();
  const browser = fixture({ epoch: 'a', policy: () => { entered.resolve(); return release.promise; } });
  const form = createClientFormStore();
  browser.store.forms.set('/protected\0login', form);
  const post = vi.fn(async () => new Response(JSON.stringify({
    version: 1, outcome: 'saved', destination: '/protected', followUp: 'refresh',
    session: { epoch: 'b', reason: 'login' },
  }), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } }));
  vi.stubGlobal('fetch', post);
  const work = form.submit({ action: 'https://example.test/login', body: new URLSearchParams() }, {
    invalidate: browser.store.router.invalidate, allowDestination: () => true, rememberForms: () => {},
    sessionChanged: (change) => browser.store.applyFormSession(change, form),
    releaseSession: () => browser.store.releaseFormSession(form),
    approve: (href, followUp, signal) => browser.store.approveForm(href, followUp, signal, form),
  });
  try {
    await entered.promise;
    form.cancel();
    if (check === 'document') release.resolve({ document: '/exit' });
    // Cancellation must settle before the abort-ignoring application policy is released.
    await work;
    expect(form.getSnapshot().mutation?.status).toBe('saved');
    expect(post).toHaveBeenCalledOnce();
  } finally {
    release.resolve({ document: '/exit' });
    await work;
    vi.unstubAllGlobals();
  }
  expect(browser.assign).not.toHaveBeenCalled();
  expect(browser.load).not.toHaveBeenCalled();
}, 5_000);

it('revokes saved-origin policy authority before another form abort listener reenters cancellation', async () => {
  const policy = vi.fn(() => ({ document: '/exit' }));
  const browser = fixture({ epoch: 'a', policy });
  const login = createClientFormStore();
  const other = createClientFormStore();
  browser.store.forms.set('/protected\0other', other);
  browser.store.forms.set('/protected\0login', login);
  const entered = gate<void>();
  const release = gate<boolean>();
  vi.stubGlobal('fetch', vi.fn(async (action: string) => new Response(JSON.stringify({
    version: 1, outcome: 'saved', destination: '/protected', followUp: 'refresh',
    ...(action.endsWith('/login') ? { session: { epoch: 'b', reason: 'login' } } : {}),
  }), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } })));
  const old = other.submit({ action: 'https://example.test/other', body: new URLSearchParams() }, {
    invalidate: () => {}, rememberForms: () => {},
    allowDestination: (_destination, signal) => {
      signal.addEventListener('abort', () => login.cancel(), { once: true });
      entered.resolve();
      return release.promise;
    },
    approve: (href, followUp, signal) => browser.store.approveForm(href, followUp, signal, other),
  });
  try {
    await entered.promise;
    await login.submit({ action: 'https://example.test/login', body: new URLSearchParams() }, {
      invalidate: () => {}, allowDestination: () => true, rememberForms: () => {},
      sessionChanged: (change) => browser.store.applyFormSession(change, login),
      releaseSession: () => browser.store.releaseFormSession(login),
      approve: (href, followUp, signal) => browser.store.approveForm(href, followUp, signal, login),
    });
    await old;
    expect(browser.assign).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
    expect(login.getSnapshot().mutation?.status).toBe('saved');
  } finally {
    release.resolve(false);
    vi.unstubAllGlobals();
  }
}, 5_000);

it.each([401, 403])('consumes POST %s auth refresh policy with GET only', async (status) => {
  const browser = fixture({ epoch: 'a', policy: () => 'refresh' });
  const readStarted = gate<void>();
  browser.load.mockImplementationOnce(async () => {
    readStarted.resolve();
    return { ok: true, component: () => null, payload: {
      version: 2, buildId: 'test', url: '/protected',
      params: { identity: 'b' }, destination: { module: './protected', props: { identity: 'b' } },
    } };
  });
  const post = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal('fetch', post);
  const form = createClientFormStore();
  browser.store.forms.set('/protected\0login', form);
  const work = form.submit({ action: 'https://example.test/login', body: new URLSearchParams() }, {
    invalidate: browser.store.router.invalidate, allowDestination: () => true, rememberForms: () => {},
    authRejected: (reason) => browser.store.rejectFormAuth(reason, form),
    releaseSession: () => browser.store.releaseFormSession(form),
    approve: (href, followUp, signal) => browser.store.approveForm(href, followUp, signal, form),
  });
  try {
    await readStarted.promise;
    await work;
    expect(post).toHaveBeenCalledOnce();
    expect(browser.load).toHaveBeenCalledOnce();
    expect(browser.store.getSnapshot().session?.status).toBe('approved');
    expect(browser.store.getSnapshot().params.identity).toBe('b');
  } finally {
    vi.unstubAllGlobals();
  }
}, 5_000);

it('cancels saved-origin fresh approval after its follow-up auth policy selected refresh', async () => {
  const entered = gate<void>();
  const release = gate<'refresh'>();
  const browser = fixture({ epoch: 'a', policy: (context) => {
    if (context.reason === 'login') return 'refresh';
    entered.resolve();
    return release.promise;
  } });
  browser.load.mockImplementationOnce(async () => ({ ok: false, reason: 'unauthorized' }));
  const post = vi.fn(async () => new Response(JSON.stringify({
    version: 1, outcome: 'saved', destination: '/protected', followUp: 'refresh',
    session: { epoch: 'b', reason: 'login' },
  }), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } }));
  vi.stubGlobal('fetch', post);
  const form = createClientFormStore();
  browser.store.forms.set('/protected\0login', form);
  const work = form.submit({ action: 'https://example.test/login', body: new URLSearchParams() }, {
    invalidate: browser.store.router.invalidate, allowDestination: () => true, rememberForms: () => {},
    sessionChanged: (change) => browser.store.applyFormSession(change, form),
    releaseSession: () => browser.store.releaseFormSession(form),
    approve: (href, followUp, signal) => browser.store.approveForm(href, followUp, signal, form),
  });
  try {
    await entered.promise;
    release.resolve('refresh');
    await browser.started.promise;
    form.cancel();
    await work;
    expect(browser.signal()?.aborted).toBe(true);
    expect(form.getSnapshot().mutation?.status).toBe('saved');
    expect(post).toHaveBeenCalledOnce();
    expect(browser.assign).not.toHaveBeenCalled();
    expect(browser.store.getSnapshot().params).toEqual({});
  } finally {
    browser.response.resolve({ ok: false, reason: 'cancelled' });
    vi.unstubAllGlobals();
  }
}, 5_000);

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
  // Given: the configured session UI, not the legacy document-exit composition.
  const { store, started, response, assign } = fixture({ epoch: 'a' });
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
