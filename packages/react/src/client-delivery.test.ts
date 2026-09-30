// @vitest-environment happy-dom

import { act, createElement, Profiler, useEffect } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { useClientNavigationStore } from './client/provider.js';
import {
  createReactRouteSnapshot,
  Link,
  ReactClientRouterProvider,
  type ReactClientRouterProviderProps,
  type ReactRouter,
  type ReactRouteSnapshot,
  useNavigation,
  useParams,
  usePathname,
  useRouter,
  useRouterState,
  useSearchParams,
} from './client.js';

const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('connects an ordinary Link without rendering its unchanged anchor again', async () => {
  // Given: a native anchor whose content does not depend on connection state.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/products');
  const container = document.createElement('div');
  document.body.append(container);
  const renderer = createRoot(container);
  roots.push(renderer);
  const phases: string[] = [];
  const view = createElement(ReactClientRouterProvider, {
    initialSnapshot: createReactRouteSnapshot({ url: '/products' }),
  }, createElement(Profiler, {
    id: 'ordinary-link',
    onRender: (_id, phase) => { phases.push(phase); },
  }, createElement(Link, { href: '/products/sku-42' }, 'Product')));

  // When: mounting also connects the provider to the browser.
  await act(async () => { renderer.render(view); });

  // Then: connection changes no anchor output and requires no second render.
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/products/sku-42');
  expect(phases).toEqual(['mount']);
});

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred value is not initialized.'); };
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function approved(url: string) {
  return new Response(JSON.stringify({
    version: 2,
    buildId: 'delivery-build',
    url,
    params: { sku: url.includes('84') ? 'sku-84' : 'sku-42' },
    destination: { module: './page.ts', props: { url } },
  }), { headers: { 'content-type': 'application/vnd.fluo.react-navigation+json;v=2' } });
}

function fixture() {
  const snapshots: ReactRouteSnapshot[] = [];
  const durations: number[] = [];
  const notifications: string[] = [];
  let router: ReactRouter | undefined;
  let shellRenders = 0;
  let stop = () => {};
  function Hooks() {
    router = useRouter();
    const state = useRouterState();
    const pathname = usePathname();
    const params = useParams();
    const navigation = useNavigation();
    const search = useSearchParams();
    const store = useClientNavigationStore();
    snapshots.push(state);
    useEffect(() => {
      notifications.push(store.getSnapshot().navigation.status);
      stop = store.subscribe(() => notifications.push(store.getSnapshot().navigation.status));
      return stop;
    }, [store]);
    return createElement('output', null,
      `${pathname}|${params.sku}|${search.get('q')}|${navigation.status}|${state.hash}`);
  }
  const snapshot = createReactRouteSnapshot({ url: '/products/sku-42?q=initial', params: { sku: 'sku-42' } });
  const modules = { './page.ts': async () => ({ default: () => createElement('h1', null, 'Approved') }) };
  const props: ReactClientRouterProviderProps = {
    initialSnapshot: snapshot,
    navigationModules: modules,
    navigationBuildId: 'delivery-build',
    failurePolicy: (): 'preserve' => 'preserve',
    children: () => {
      shellRenders++;
      return createElement(Profiler, {
        id: 'delivery-hooks',
        onRender: (_id, _phase, duration) => durations.push(duration),
      }, createElement(Hooks));
    },
  };
  const app = createElement(ReactClientRouterProvider, props);
  return {
    app, snapshot, snapshots, notifications, durations,
    router: () => {
      if (!router) throw new Error('Provider hooks have not rendered.');
      return router;
    },
    shellRenders: () => shellRenders,
    stop: () => stop(),
  };
}

it('keeps the immutable HTTP snapshot through real provider hydration without an initial GET', async () => {
  // Given: server-rendered hook values and the same initial request snapshot.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/products/sku-42?q=initial');
  const request = vi.spyOn(globalThis, 'fetch');
  const diagnostics = vi.spyOn(console, 'error');
  const view = fixture();
  const container = document.createElement('div');
  container.innerHTML = renderToString(view.app);
  document.body.append(container);

  // When: the real provider hydrates that document.
  await act(async () => { roots.push(hydrateRoot(container, view.app)); });

  // Then: every public hook agrees with HTTP, snapshots are stable/frozen and hydration adds no GET.
  expect(container.textContent).toBe('/products/sku-42|sku-42|initial|idle|');
  expect(view.snapshots.every((snapshot) => Object.isFrozen(snapshot) && Object.isFrozen(snapshot.params))).toBe(true);
  expect(view.snapshots.every((snapshot) => snapshot === view.snapshot)).toBe(true);
  expect(request).not.toHaveBeenCalled();
  expect(diagnostics).not.toHaveBeenCalled();
  view.stop();
});

it('observes pending, cancellation, fresh approval and refresh without mutating old hook snapshots', async () => {
  // Given: a real provider with a deferred HTTP response and subscribed public hooks.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/products/sku-42?q=initial');
  const response = deferred<Response>();
  const request = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => response.promise);
  const view = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(view.app));
  const router = view.router();
  const before = view.snapshot;
  const shellBefore = view.shellRenders();
  await act(async () => router.push('/products/sku-84?q=next'));
  expect(container.textContent).toBe('/products/sku-42|sku-42|initial|navigating|');
  expect(view.shellRenders()).toBe(shellBefore);
  expect(view.notifications).toContain('navigating');
  await act(async () => router.invalidate());
  expect(container.textContent).toBe('/products/sku-42|sku-42|initial|idle|');
  await act(async () => response.resolve(approved('/products/sku-84?q=next')));
  expect(window.location.pathname).toBe('/products/sku-42');
  request.mockImplementationOnce(async () => approved('/products/sku-84?q=next'));

  // When: a new activation and same-page refresh each receive fresh approval.
  await act(async () => router.push('/products/sku-84?q=next'));
  const historyLength = window.history.length;
  request.mockImplementationOnce(async () => approved('/products/sku-84?q=next'));
  await act(async () => { expect(await router.refresh()).toEqual({ status: 'complete' }); });

  // Then: hooks change together, old snapshots stay immutable and shell/router identity survives.
  expect(container.textContent).toBe('/products/sku-84|sku-84|next|complete|');
  expect(before.url).toBe('/products/sku-42?q=initial');
  expect(before.navigation.status).toBe('idle');
  expect(view.router()).toBe(router);
  expect(window.history.length).toBe(historyLength);
  expect(request).toHaveBeenCalledTimes(3);
  expect(view.notifications).toEqual(expect.arrayContaining(['navigating', 'idle', 'complete', 'refreshing']));
  expect(view.durations.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
  console.log(JSON.stringify({
    observation: 'real-provider-hooks',
    renders: view.snapshots.length,
    shellRenders: view.shellRenders(),
    notifications: view.notifications,
    commitDurationsMs: view.durations,
    limit: 'correctness profiling, not representative performance evidence',
  }));
  view.stop();
});

it('isolates separate provider hook state during a preserved HTTP failure and fresh retry', async () => {
  // Given: independent outer and inner providers with a failed inner approval.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/products/sku-42?q=initial');
  const outer = fixture();
  const inner = fixture();
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement('div', null, outer.app, inner.app)));
  const outerRouter = outer.router();

  // When: only the inner provider fails then retries with a fresh response.
  await act(async () => inner.router().push('/products/sku-84?q=next'));
  expect(inner.snapshots.at(-1)?.navigation.failure?.reason).toBe('server-error');
  expect(outer.snapshots.at(-1)?.navigation.status).toBe('idle');
  request.mockResolvedValueOnce(approved('/products/sku-84?q=next'));
  await act(async () => inner.router().retry());

  // Then: one provider cannot mutate another provider's snapshots or operations.
  expect(inner.snapshots.at(-1)?.pathname).toBe('/products/sku-84');
  expect(outer.snapshots.at(-1)).toBe(outer.snapshot);
  expect(outer.router()).toBe(outerRouter);
  expect(inner.router()).not.toBe(outerRouter);
  expect(request).toHaveBeenCalledTimes(2);
  outer.stop();
  inner.stop();
});
