// @vitest-environment happy-dom

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import { ReactClientRouterProvider, ReactNavigationExperience, createReactRouteSnapshot } from './client.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('includes a bounded page-owned stylesheet in the server composition', () => {
  // Given: the matched HTTP page supplies a same-origin stylesheet link.
  const app = createElement(ReactClientRouterProvider, {
    initialSnapshot: createReactRouteSnapshot({
      url: '/admin/songs',
      metadata: { links: [{ rel: 'stylesheet', href: '/assets/route-only.css' }] },
    }),
  }, createElement('main', null,
    createElement(ReactNavigationExperience, {
      destination: null,
      page: createElement('h1', null, 'Admin songs'),
    }),
  ));

  // When: React renders the official document before hydration.
  const html = renderToString(app);

  // Then: both the approved page content and its page-owned link are present.
  expect(html).toContain('Admin songs');
  expect(html).toContain('href="/assets/route-only.css"');
});

it('resets only the approved page render after a throw without a new HTTP request', async () => {
  // Given: the official composition contains a persistent interactive shell and a throwing page.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/products/sku-42');
  const request = vi.spyOn(globalThis, 'fetch');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let throws = true;
  function Page() {
    if (throws) throw new Error('Destination render broke');
    return createElement('h1', null, 'Product 42');
  }
  function Shell() {
    const [count, setCount] = useState(0);
    return createElement('main', { tabIndex: -1 },
      createElement('button', { onClick: () => setCount(count + 1), type: 'button' }, `Shell ${count}`),
      createElement(ReactNavigationExperience, {
        destination: null,
        page: createElement(Page),
      }),
    );
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(createElement(ReactClientRouterProvider, {
      initialSnapshot: createReactRouteSnapshot({ url: '/products/sku-42' }),
    }, createElement(Shell)));
  });
  expect(container.querySelector('[aria-label="Page rendering failed"]')).not.toBeNull();
  const shell = container.querySelector('main > button');
  await act(async () => { shell?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

  // When: the user resets the page boundary after the component can render again.
  throws = false;
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="Page rendering failed"] button')?.click();
  });

  // Then: route, document and interactive shell survive, without another approval.
  expect(container.querySelector('h1')?.textContent).toBe('Product 42');
  expect(container.querySelector('main > button')?.textContent).toBe('Shell 1');
  expect(window.location.pathname).toBe('/products/sku-42');
  expect(request).not.toHaveBeenCalled();
  expect(consoleError).toHaveBeenCalled();
  await act(async () => { root.unmount(); });
});

it('keeps the shell usable when the page error view itself throws', async () => {
  // Given: an approved page and its application-provided error view both throw.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function BrokenPage(): never {
    throw new Error('Broken page');
  }
  await act(async () => {
    root.render(createElement(ReactClientRouterProvider, {
      initialSnapshot: createReactRouteSnapshot({ url: '/products/sku-42' }),
    }, createElement('main', null,
      createElement('button', { type: 'button' }, 'Usable shell'),
      createElement(ReactNavigationExperience, {
        destination: null,
        page: createElement(BrokenPage),
        renderError: () => { throw new Error('Broken fallback'); },
      }),
    )));
  });

  // When: React transfers the failing error view to the outer diagnostic boundary.
  // Then: a document-exit link and the shell remain interactive, not a blank root.
  expect(container.querySelector('[aria-label="Page error view failed"] a')?.getAttribute('href')).toBe(window.location.href);
  expect(container.querySelector('main button')?.textContent).toBe('Usable shell');
  expect(consoleError).toHaveBeenCalledWith('React destination error view failed', expect.any(Error));
  await act(async () => { root.unmount(); });
});
