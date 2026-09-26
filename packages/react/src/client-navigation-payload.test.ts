import { afterEach, expect, it, vi } from 'vitest';

import { loadReactNavigationDestination } from './client.js';

const ORIGIN = 'https://example.test';
const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=1';
const payload = {
  version: 1,
  url: '/products/sku-84?preview=false',
  params: { sku: 'sku-84' },
  destination: { module: './navigation-product.ts', props: { sku: 'sku-84' } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it('loads a built destination with credentials without reusing a private response', async () => {
  // Given: a server result whose module exists in the browser's build-produced import map.
  const fetchResult = vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': MEDIA_TYPE,
      'Cache-Control': 'private, no-store',
      'Set-Cookie': 'session=updated',
      Vary: 'Accept, Cookie',
    },
  }));
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', fetchResult);
  const component = () => 'destination';
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: component })) };

  // When: the same destination is loaded twice.
  const first = await loadReactNavigationDestination('/products/sku-84?preview=false', modules);
  const second = await loadReactNavigationDestination('/products/sku-84?preview=false', modules);

  // Then: every request reaches HTTP, carries cookies, and resolves only its mapped build module.
  expect(first).toMatchObject({ ok: true, payload });
  expect(second).toMatchObject({ ok: true, payload });
  expect(fetchResult).toHaveBeenCalledTimes(2);
  expect(fetchResult).toHaveBeenCalledWith(`${ORIGIN}/products/sku-84?preview=false`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: MEDIA_TYPE },
    redirect: 'manual',
  });
  expect(modules['./navigation-product.ts']).toHaveBeenCalledTimes(2);
});

it('accepts the HTTP adapter-normalized version parameter and charset', async () => {
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/vnd.fluo.react-navigation+json; v="1"; charset=utf-8' },
  })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules);

  expect(result.ok).toBe(true);
  expect(modules['./navigation-product.ts']).toHaveBeenCalledOnce();
});

it.each([
  ['redirect', new Response(null, { status: 302, headers: { Location: '/sign-in' } })],
  ['authentication required', new Response('unauthorized', { status: 401 })],
  ['denied', new Response('unauthorized', { status: 403 })],
  ['not found', new Response('not found', { status: 404 })],
  ['validation failure', new Response('invalid input', { status: 400 })],
  ['non-HTML result', new Response('{}', { headers: { 'Content-Type': 'application/json' } })],
  ['malformed payload', new Response('{', { headers: { 'Content-Type': MEDIA_TYPE } })],
  ['unsupported version', new Response(JSON.stringify({ ...payload, version: 2 }), { headers: { 'Content-Type': MEDIA_TYPE } })],
  ['incorrect confirmed URL', new Response(JSON.stringify({
    ...payload,
    url: '/products/another-sku',
  }), { headers: { 'Content-Type': MEDIA_TYPE } })],
  ['invalid params', new Response(JSON.stringify({
    ...payload,
    params: { sku: 42 },
  }), { headers: { 'Content-Type': MEDIA_TYPE } })],
  ['unmapped module', new Response(JSON.stringify({
    ...payload,
    destination: { module: './unknown.ts', props: {} },
  }), { headers: { 'Content-Type': MEDIA_TYPE } })],
] as const)('falls back without rendering for %s', async (_kind, response) => {
  // Given: a response that does not describe a supported, matched browser page.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => response));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the destination loader consumes the HTTP result.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules);

  // Then: no code from an untrusted or failed response is imported.
  expect(result.ok).toBe(false);
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('rejects an external URL before issuing a request', async () => {
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const request = vi.fn();
  vi.stubGlobal('fetch', request);

  const result = await loadReactNavigationDestination('https://outside.test/products/sku-84', {});

  expect(result.ok).toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it('does not import or render a destination after cancellation', async () => {
  // Given: a pending request whose exact abort event settles the network response.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const controller = new AbortController();
  const requested = new Promise<void>((resolve) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      resolve();
      return new Promise<Response>((settle) => {
        controller.signal.addEventListener('abort', () =>
          settle(new Response(JSON.stringify(payload), { headers: { 'Content-Type': MEDIA_TYPE } })), { once: true });
      });
    }));
  });
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: cancellation occurs after the request is in flight.
  const loading = loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    signal: controller.signal,
  });
  await requested;
  controller.abort();
  const result = await loading;

  // Then: no browser module is imported from the cancelled response.
  expect(result).toEqual({ ok: false, reason: 'cancelled' });
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('does not import a destination when cancellation settles a pending JSON body read', async () => {
  // Given: a successful response whose body read resolves on the exact abort event.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const controller = new AbortController();
  let bodyReadStarted = () => {};
  const readingBody = new Promise<void>((resolve) => { bodyReadStarted = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    redirected: false,
    headers: new Headers({ 'Content-Type': MEDIA_TYPE }),
    json: () => {
      bodyReadStarted();
      return new Promise((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(payload), { once: true });
      });
    },
  })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: cancellation happens after response acceptance, while JSON is pending.
  const loading = loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    signal: controller.signal,
  });
  await readingBody;
  controller.abort();
  const result = await loading;

  // Then: no import starts after the cancelled read settles.
  expect(result).toEqual({ ok: false, reason: 'cancelled' });
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('falls back when a mapped module has no usable default component', async () => {
  // Given: a build-mapped module that loads but cannot be rendered as a component.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': MEDIA_TYPE },
  })));
  const module = { default: () => null };
  Object.defineProperty(module, 'default', { value: undefined });
  const modules = { './navigation-product.ts': vi.fn(async () => module) };

  // When: the browser loads the mapped module.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules);

  // Then: it reports fallback instead of treating an unrenderable module as success.
  expect(result).toEqual({ ok: false, reason: 'invalid-payload' });
  expect(modules['./navigation-product.ts']).toHaveBeenCalledOnce();
});
