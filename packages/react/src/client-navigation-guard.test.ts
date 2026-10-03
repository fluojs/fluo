import { afterEach, expect, it, vi } from 'vitest';
import { createReactRouteSnapshot } from './client/snapshot.js';
import { createClientNavigationStore } from './client/store.js';
import { createClientFormStore } from './client/form-store.js';
import type { ReactNavigationLoadResult } from './client/navigation-payload.js';

afterEach(() => { vi.unstubAllGlobals(); });

function fixture() {
  let href = 'https://example.test/edit';
  let index: number | null = null;
  const entries = new Map<number, string>([[0, href]]);
  let listener = (_type: 'hashchange' | 'popstate'): void => {};
  const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/edit', params: { page: 'edit' } }));
  const load = vi.fn(async (target: string, _signal: AbortSignal): Promise<ReactNavigationLoadResult> => ({
    ok: true, component: () => null,
    payload: { version: 2, buildId: 'guard-test', url: new URL(target).pathname,
      params: { page: new URL(target).pathname.slice(1) }, destination: { module: './page', props: {} } },
  }));
  const replaceState = vi.fn((target: string, position?: number) => {
    href = target; index = position ?? null;
    if (position !== undefined) entries.set(position, target);
  });
  const pushState = vi.fn((target: string, position?: number) => {
    href = target; index = position ?? null;
    if (position !== undefined) entries.set(position, target);
  });
  const go = vi.fn((delta: number) => {
    index = (index ?? 0) + delta;
    const target = entries.get(index);
    if (target === undefined) throw new Error('Missing managed history entry');
    href = target;
    listener('popstate');
  });
  const assign = vi.fn();
  const replace = vi.fn();
  const disconnect = store.connect({
    assign, replace, reload: vi.fn(), back: () => go(-1), go, historyIndex: () => index,
    currentHref: () => href, load, pushState, replaceState,
    subscribe(next) { listener = next; return () => {}; },
  });
  const committed = (url: string) => new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (store.getSnapshot().url !== url || store.getSnapshot().navigation.status !== 'complete') return;
      unsubscribe(); resolve();
    });
  });
  return { store, load, pushState, replaceState, go, assign, replace, committed, disconnect,
    href: () => href, index: () => index,
    untagged(target: string) { href = target; index = null; listener('popstate'); } };
}

it('allows explicit saved session navigation when the old guard unmounts during revocation', async () => {
  const app = fixture();
  const form = createClientFormStore();
  app.store.forms.set('login', form);
  const unregister = app.store.registerNavigationGuard(() => ({ when: false }));
  const unsubscribe = app.store.subscribe(() => {
    if (app.store.getSnapshot().session?.status !== 'pending') return;
    unsubscribe();
    unregister();
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    version: 1, outcome: 'saved', destination: '/signed-in', followUp: 'navigate',
    session: { epoch: 'signed-in', reason: 'login' },
  }), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } })));

  await form.submit({
    action: 'https://example.test/login', method: 'post', body: new URLSearchParams(),
  }, {
    lease: app.store.sessionLease,
    invalidate: app.store.router.invalidate,
    allowDestination: () => true,
    approve: (href, followUp, signal) => app.store.approveForm(href, followUp, signal, form),
    sessionChanged: (change) => app.store.applyFormSession(change, form),
    releaseSession: () => app.store.releaseFormSession(form),
    rememberForms: () => {},
  });

  expect(form.getSnapshot().mutation?.status).toBe('saved');
  expect(form.getSnapshot().followUp).toEqual({ status: 'complete' });
  expect(app.store.getSnapshot().url).toBe('/signed-in');
  expect(app.store.getSnapshot().session?.status).toBe('approved');
  expect(app.load).toHaveBeenCalledOnce();
  app.disconnect();
});

it('does not load a destination while an opted-in dirty owner awaits permission', () => {
  // Given: the existing store has a connected browser and an opted-in dirty owner.
  const store = createClientNavigationStore(createReactRouteSnapshot({ url: '/edit' }));
  const load = vi.fn(() => new Promise<never>(() => {}));
  store.connect({
    assign: vi.fn(),
    back: vi.fn(),
    currentHref: () => 'https://example.test/edit',
    load,
    pushState: vi.fn(),
    reload: vi.fn(),
    replace: vi.fn(),
    replaceState: vi.fn(),
    subscribe: () => () => {},
  });
  store.registerNavigationGuard(() => ({ when: true }));

  // When: the dirty owner receives an ordinary router push intent.
  store.router.push('/next');

  // Then: permission must precede destination HTTP, not merely destination commit.
  expect(load).not.toHaveBeenCalled();
  expect(store.getSnapshot().url).toBe('/edit');
});

it.each(['push', 'replace'] as const)('stays without cancelling current forms or invoking fallback for %s', (type) => {
  const app = fixture();
  const form = createClientFormStore();
  const cancel = vi.spyOn(form, 'cancel');
  app.store.forms.set('current', form);
  app.store.registerNavigationGuard(() => ({ when: true }));
  app.store.router[type]('/next');
  const decision = app.store.getNavigationDecision();
  expect(decision?.intent).toEqual({ destination: '/next', type });
  expect(cancel).not.toHaveBeenCalled();
  decision?.stay();
  expect(app.load).not.toHaveBeenCalled();
  expect(app.pushState).not.toHaveBeenCalled();
  expect(app.href()).toBe('https://example.test/edit');
  expect(app.store.getSnapshot().params).toEqual({ page: 'edit' });
  expect(app.assign).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(app.store.getNavigationDecision()).toBeNull();
});

it('deduplicates an intent and allows only the final captured decision to load', async () => {
  const app = fixture();
  app.store.registerNavigationGuard(() => ({ when: true }));
  app.store.router.push('/a');
  const a = app.store.getNavigationDecision();
  app.store.router.push('/a');
  expect(app.store.getNavigationDecision()).toBe(a);
  app.store.router.push('/b');
  const b = app.store.getNavigationDecision();
  app.store.router.replace('/c');
  expect(a?.signal.aborted).toBe(true);
  expect(b?.signal.aborted).toBe(true);
  a?.proceed(); b?.stay();
  expect(app.load).not.toHaveBeenCalled();
  const committed = app.committed('/c');
  app.store.getNavigationDecision()?.proceed();
  await committed;
  expect(app.load).toHaveBeenCalledExactlyOnceWith('https://example.test/c', expect.any(AbortSignal));
  expect(app.replaceState).toHaveBeenLastCalledWith('https://example.test/c', 0);
});

it('protects guard-only tagged back and forward without duplicate entries or HTTP before permission', async () => {
  const app = fixture();
  let dirty = false;
  app.store.registerNavigationGuard(() => ({ when: dirty }));
  const next = app.committed('/next');
  app.store.router.push('/next');
  await next;
  expect(app.index()).toBe(1);
  dirty = true;
  app.store.router.back();
  expect(app.href()).toBe('https://example.test/next');
  expect(app.store.getNavigationDecision()?.intent).toEqual({ destination: '/edit', type: 'back' });
  app.store.getNavigationDecision()?.stay();
  expect(app.load).toHaveBeenCalledTimes(1);
  const back = app.committed('/edit');
  app.store.router.back();
  app.store.getNavigationDecision()?.proceed();
  await back;
  expect(app.index()).toBe(0);
  app.go(1);
  app.store.getNavigationDecision()?.stay();
  expect(app.href()).toBe('https://example.test/edit');
  const forward = app.committed('/next');
  app.go(1);
  app.store.getNavigationDecision()?.proceed();
  await forward;
  expect(app.index()).toBe(1);
  expect(app.pushState).toHaveBeenCalledTimes(1);
  expect(app.load).toHaveBeenCalledTimes(3);
  expect(app.assign).not.toHaveBeenCalled();
});

it('does not grant a late asynchronous confirm authority after explicit logout', async () => {
  const app = fixture();
  let dirty = true;
  let complete: (result: boolean) => void = () => {};
  const entered = new Promise<void>((resolve) => {
    app.store.registerNavigationGuard(() => ({ when: dirty, confirm: () => {
      resolve(); return new Promise<boolean>((done) => { complete = done; });
    } }));
  });
  app.store.router.push('/private');
  await entered;
  const stale = app.store.getNavigationDecision();
  const abortObserved = vi.fn(() => {
    expect(app.store.getNavigationDecision()).toBeNull();
    stale?.proceed();
  });
  stale?.signal.addEventListener('abort', abortObserved);
  expect(await app.store.router.sessionChanged({ epoch: 'signed-out', reason: 'logout' })).toEqual({ status: 'complete' });
  expect(abortObserved).toHaveBeenCalledOnce();
  expect(app.load).not.toHaveBeenCalled();
  expect(app.store.getSnapshot().session?.status).toBe('signed-out');
  const committed = app.committed('/public');
  complete(true);
  dirty = false;
  app.store.router.push('/public');
  await committed;
  expect(app.load).toHaveBeenCalledExactlyOnceWith('https://example.test/public', expect.any(AbortSignal));
  expect(app.store.getSnapshot().url).toBe('/public');
});

it('settles saved follow-up permission on supersession without waiting for an ignored signal', async () => {
  const app = fixture();
  app.store.registerNavigationGuard(() => ({ when: true }));
  const saved = createClientFormStore();
  const followUp = app.store.approveForm('/saved', 'navigate', new AbortController().signal, saved);
  const old = app.store.getNavigationDecision();
  app.store.router.push('/latest');
  expect(await followUp).toEqual({ status: 'cancelled' });
  old?.proceed();
  expect(app.load).not.toHaveBeenCalled();
  expect(app.store.getNavigationDecision()?.intent.destination).toBe('/latest');
});

it('uses an honest document boundary for untagged traversal rather than inventing a delta', () => {
  const app = fixture();
  app.store.registerNavigationGuard(() => ({ when: true }));
  app.untagged('https://example.test/native');
  expect(app.replace).toHaveBeenCalledExactlyOnceWith('https://example.test/native');
  expect(app.go).not.toHaveBeenCalled();
  expect(app.load).not.toHaveBeenCalled();
  expect(app.store.getNavigationDecision()).toBeNull();
});

it('revokes decision controls on owner removal and provider disconnect', () => {
  const app = fixture();
  const remove = app.store.registerNavigationGuard(() => ({ when: true }));
  app.store.router.push('/a');
  const old = app.store.getNavigationDecision();
  remove();
  old?.proceed();
  expect(app.load).not.toHaveBeenCalled();
  app.store.registerNavigationGuard(() => ({ when: true }));
  app.store.router.push('/b');
  const second = app.store.getNavigationDecision();
  app.disconnect();
  second?.proceed();
  expect(app.load).not.toHaveBeenCalled();
});

it.each(['acknowledgement', 'destination-policy'] as const)(
  'keeps the latest intent authoritative over a late saved %s without cancelling the POST',
  async (stage) => {
    // Given: a real form owns a POST and its existing session/navigation lease.
    const app = fixture();
    const form = createClientFormStore();
    app.store.forms.set('editor', form);
    app.store.registerNavigationGuard(() => ({ when: true }));
    const cancel = vi.spyOn(form, 'cancel');
    let acknowledge = (_response: Response) => {};
    const response = new Promise<Response>((resolve) => { acknowledge = resolve; });
    let allow = (_allowed: boolean) => {};
    const policy = new Promise<boolean>((resolve) => { allow = resolve; });
    let started = () => {};
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const saved = new Response(JSON.stringify({
      version: 1, outcome: 'saved', destination: '/saved', followUp: 'navigate',
    }), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } });
    vi.stubGlobal('fetch', vi.fn(() => {
      if (stage === 'acknowledgement') started();
      return stage === 'acknowledgement' ? response : Promise.resolve(saved);
    }));
    const submission = form.submit({
      action: 'https://example.test/edit', method: 'post', body: new URLSearchParams({ name: 'Saved' }),
    }, {
      lease: app.store.sessionLease,
      invalidate: app.store.router.invalidate,
      allowDestination: () => {
        if (stage === 'destination-policy') { started(); return policy; }
        return true;
      },
      approve: (href, followUp, signal) => app.store.approveForm(href, followUp, signal, form),
      rememberForms: () => {},
    });
    await entered;

    // When: a newer user intent is cancelled before the older continuation settles.
    app.store.router.push('/latest');
    const latest = app.store.getNavigationDecision();
    latest?.stay();
    expect(cancel).not.toHaveBeenCalled();
    acknowledge(saved);
    allow(true);
    await submission;

    // Then: confirmed persistence survives, but the old save has no leave authority.
    expect(form.getSnapshot().mutation?.status).toBe('saved');
    expect(form.getSnapshot().followUp).toEqual({ status: 'cancelled' });
    expect(app.store.getNavigationDecision()).toBeNull();
    expect(app.store.getSnapshot().url).toBe('/edit');
    expect(app.load).not.toHaveBeenCalled();
    expect(app.assign).not.toHaveBeenCalled();
    app.disconnect();
  },
);

it('detaches an older destination load before a newer dirty decision can stay', async () => {
  // Given: an older approved intent has an outstanding abort-ignoring loader.
  const app = fixture();
  let dirty = false;
  app.store.registerNavigationGuard(() => ({ when: dirty }));
  let finish = (_result: ReactNavigationLoadResult) => {};
  const oldResult = new Promise<ReactNavigationLoadResult>((resolve) => { finish = resolve; });
  let oldSignal: AbortSignal | undefined;
  app.load.mockImplementationOnce((_href, signal: AbortSignal) => { oldSignal = signal; return oldResult; });
  app.store.router.push('/old');
  if (oldSignal === undefined) throw new Error('The older loader did not start');
  const signal = oldSignal;
  const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));

  // When: a newer protected intent supersedes that load but stays.
  dirty = true;
  app.store.router.push('/latest');
  await aborted;
  app.store.getNavigationDecision()?.stay();
  expect(app.store.getSnapshot()).toMatchObject({ url: '/edit', navigation: { status: 'idle' } });
  expect(app.pushState).not.toHaveBeenCalled();

  // Then: late completion cannot commit before or over the next explicit permission.
  const committed = app.committed('/final');
  finish({ ok: true, component: () => null, payload: {
    version: 2, buildId: 'guard-test', url: '/old', params: {},
    destination: { module: './page', props: {} },
  } });
  app.store.router.push('/final');
  app.store.getNavigationDecision()?.proceed();
  await committed;
  expect(app.store.getSnapshot().url).toBe('/final');
  expect(app.pushState).toHaveBeenCalledExactlyOnceWith('https://example.test/final', 1);
});

it('restores an already traversed tagged entry before a newer guarded push can stay', async () => {
  // Given: guard-only history has two entries and an older unapproved traversal.
  const app = fixture();
  let dirty = false;
  app.store.registerNavigationGuard(() => ({ when: dirty }));
  const home = app.committed('/home');
  app.store.router.push('/home');
  await home;
  app.load.mockImplementationOnce(() => new Promise<never>(() => {}));
  app.store.router.back();
  expect(app.href()).toBe('https://example.test/edit');

  // When: a newer push requests permission while that back load is outstanding.
  dirty = true;
  app.store.router.push('/edit');
  expect(app.store.getNavigationDecision()?.intent).toEqual({ destination: '/edit', type: 'push' });
  app.store.getNavigationDecision()?.stay();

  // Then: approved location, params and entry order remain coherent without a new load.
  expect(app.href()).toBe('https://example.test/home');
  expect(app.index()).toBe(1);
  expect(app.store.getSnapshot()).toMatchObject({ url: '/home', params: { page: 'home' } });
  expect(app.load).toHaveBeenCalledTimes(2);
  expect(app.pushState).toHaveBeenCalledOnce();
  expect(app.assign).not.toHaveBeenCalled();
  app.disconnect();
});
