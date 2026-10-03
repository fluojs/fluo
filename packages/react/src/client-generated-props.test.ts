// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { ReactClientRouterProvider, createReactRouteSnapshot, useNavigation, useRouter } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('validates generated props through the actual provider before destination import', async () => {
  // Given: a provider receives the same generated decoder used by initial transfer.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/origin');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    version: 2, buildId: 'contracts-test', url: '/target', params: {},
    destination: { module: './page.ts', props: { sku: 42 } },
  }), { headers: { 'Content-Type': 'application/vnd.fluo.react-navigation+json;v=2' } })));
  const importer = vi.fn(async () => ({ default: () => createElement('h1', null, 'Wrong props') }));
  const decodeProps = vi.fn((value: unknown) => {
    if (typeof value !== 'object' || value === null || !('sku' in value) || typeof value.sku !== 'string') {
      throw new TypeError('Invalid generated props.');
    }
    return { sku: value.sku };
  });
  const props = {
    initialSnapshot: createReactRouteSnapshot({ url: '/origin' }),
    navigationModules: { './page.ts': importer },
    navigationBuildId: 'contracts-test',
    navigationContracts: { './page.ts': { decodeProps } },
    failurePolicy: () => 'preserve' as const,
  };
  function Probe() {
    const router = useRouter();
    const navigation = useNavigation();
    return createElement('div', null,
      createElement('button', { type: 'button', onClick: () => router.push('/target') }, 'Move'),
      createElement('output', null, `${navigation.status}:${navigation.failure?.reason ?? ''}`));
  }
  const target = document.createElement('div');
  document.body.append(target);
  const root = createRoot(target);
  let observer: MutationObserver | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await act(async () => root.render(createElement(ReactClientRouterProvider, props, createElement(Probe))));
    // When: subscribe to the exact terminal state before triggering the move.
    const settled = new Promise<void>((resolve, reject) => {
      observer = new MutationObserver(() => {
        if (/^(?:complete|error):/u.test(target.querySelector('output')?.textContent ?? '')) resolve();
      });
      observer.observe(target, { subtree: true, childList: true, characterData: true });
      deadline = setTimeout(() => reject(new Error('Navigation did not settle')), 5000);
    });
    await act(async () => {
      target.querySelector('button')?.click();
    });
    await settled;
    // Then: invalid props cannot import, commit history or render an approved destination.
    expect(target.querySelector('output')?.textContent).toBe('error:invalid-payload');
    expect(decodeProps).toHaveBeenCalledOnce();
    expect(importer).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/origin');
  } finally {
    observer?.disconnect();
    clearTimeout(deadline);
    await act(async () => root.unmount());
  }
});
