import { afterEach, expect, it, vi } from 'vitest';

import { createClientNavigationStore } from './client/store.js';
import { createClientFormStore } from './client/form-store.js';
import {
  createReactRouteSnapshot,
  loadReactInitialNavigationDestination as loadInitial,
  loadReactNavigationDestination as loadNavigation,
  type ReactNavigationModules,
  type ReactNavigationLoadResult,
} from './client.js';

const ORIGIN = 'https://example.test';
const MEDIA_TYPE = 'application/vnd.fluo.react-navigation+json;v=2';
const BUILD_ID = 'build-a';
const payload = {
  version: 2,
  buildId: BUILD_ID,
  url: '/products/sku-84?preview=false',
  params: { sku: 'sku-84' },
  destination: { module: './navigation-product.ts', props: { sku: 'sku-84' } },
};

const loadReactInitialNavigationDestination = (json: string, modules: ReactNavigationModules) =>
  loadInitial(json, modules, BUILD_ID);
const loadReactNavigationDestination = (
  href: string | URL,
  modules: ReactNavigationModules,
  options: Parameters<typeof loadNavigation>[2] = {},
) => loadNavigation(href, modules, { buildId: BUILD_ID, ...options });

it('rejects a B navigation before importing when its build differs from the hydrated A tab', async () => {
  // Given: A tab receives a valid HTTP-approved B payload for a mapped module.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ...payload, version: 2, buildId: 'build-b',
  }), { headers: { 'Content-Type': 'application/vnd.fluo.react-navigation+json;v=2' } })));

  // When: the A tab attempts soft navigation.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    buildId: 'build-a',
  });

  // Then: incompatible-build precedes module import.
  expect(result).toEqual({ ok: false, reason: 'incompatible-build' });
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('does not accept a v2 response with absent build identity', async () => {
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    version: 2, url: payload.url, params: payload.params, destination: payload.destination,
  }), {
    headers: { 'Content-Type': 'application/vnd.fluo.react-navigation+json;v=2' },
  })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    buildId: 'build-a',
  });

  expect(result).toEqual({ ok: false, reason: 'invalid-payload' });
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function grantedResponse(headers: Record<string, string> = {}, body: unknown = payload): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': MEDIA_TYPE,
      'X-Fluo-Navigation-Prefetch': 'public',
      'Cache-Control': 'public, max-age=15',
      Vary: 'Accept',
      ...headers,
    },
  });
}

it('uses fresh credentialed v2 approval after a form save instead of speculation admitted during the POST', async () => {
  // Given: a provider with a held POST and a valid public prefetch opportunity.
  let href = `${ORIGIN}/products/sku-42`;
  vi.stubGlobal('window', { location: { href } });
  let started = () => {};
  let acknowledge = (_response: Response) => {};
  const posted = new Promise<void>((resolve) => { started = resolve; });
  const acknowledgement = new Promise<Response>((resolve) => { acknowledge = resolve; });
  const metadata = { title: 'Fresh after save' };
  const fetchResult = vi.fn()
    .mockImplementationOnce(() => { started(); return acknowledgement; })
    .mockResolvedValueOnce(grantedResponse({}, {
      ...payload, destination: { ...payload.destination, props: { revision: 'speculative-old' } },
    }))
    .mockResolvedValueOnce(grantedResponse({}, {
      ...payload, metadata, destination: { ...payload.destination, props: { revision: 'confirmed-new' } },
    }));
  vi.stubGlobal('fetch', fetchResult);
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };
  const navigation = createClientNavigationStore(createReactRouteSnapshot({
    url: '/products/sku-42', params: { sku: 'sku-42' },
  }));
  const disconnect = navigation.connect({
    currentHref: () => href,
    assign: vi.fn(), back: vi.fn(), reload: vi.fn(), replace: vi.fn(),
    pushState: (next) => { href = next; }, replaceState: vi.fn(), subscribe: () => () => {},
    prefetchScope: 'form-test',
    load: (url, signal) => loadReactNavigationDestination(url, modules, { signal }),
    prefetch: (url, signal) => loadReactNavigationDestination(url, modules, { signal, prefetch: true }),
  });
  const form = createClientFormStore();
  navigation.forms.set('save', form);
  const operation = form.submit({
    action: `${ORIGIN}/save`,
    body: new URLSearchParams({ name: 'Changed' }),
  }, {
    invalidate: navigation.router.invalidate,
    allowDestination: () => true,
    rememberForms: () => {},
    approve: (url, followUp, signal) => navigation.approveForm(url, followUp, signal, form),
  });
  try {
    await posted;
    await navigation.prefetch(payload.url, {});

    // When: persistence is acknowledged after the speculative entry was admitted.
    acknowledge(new Response(JSON.stringify({
      version: 1, outcome: 'saved', destination: payload.url, followUp: 'navigate',
    }), { headers: { 'Content-Type': 'application/vnd.fluo.form+json;v=1' } }));
    await operation;

    // Then: only a fresh ordinary HTTP response supplies data and metadata.
    expect(fetchResult).toHaveBeenCalledTimes(3);
    expect(fetchResult.mock.calls[1]?.[1]).toMatchObject({ credentials: 'omit' });
    expect(fetchResult.mock.calls[2]?.[1]).toMatchObject({
      credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
    });
    expect(navigation.getDestination()).toMatchObject({ props: { revision: 'confirmed-new' } });
    expect(navigation.getSnapshot().metadata).toEqual(metadata);
    expect(form.getSnapshot().mutation?.status).toBe('saved');
    expect(form.getSnapshot().followUp).toEqual({ status: 'complete' });
  } finally {
    disconnect();
    acknowledge(new Response('', { status: 500 }));
    await operation;
  }
});

it('hydrates only the HTTP-approved initial module without an additional request', async () => {
  // Given: an inert script whose URL matches the browser document and a built importer.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}${payload.url}` } });
  const fetchResult = vi.fn();
  vi.stubGlobal('fetch', fetchResult);
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: hydration resolves the initial page using the same validator as soft navigation.
  const result = await loadReactInitialNavigationDestination(JSON.stringify(payload), modules);

  // Then: the selected component and server params are accepted without rematching or fetching.
  expect(result).toMatchObject({ ok: true, payload });
  expect(modules['./navigation-product.ts']).toHaveBeenCalledOnce();
  expect(fetchResult).not.toHaveBeenCalled();
});

it('rejects an initial document with a different build before importing', async () => {
  vi.stubGlobal('window', { location: { href: `${ORIGIN}${payload.url}` } });
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  const result = await loadReactInitialNavigationDestination(
    JSON.stringify({ ...payload, buildId: 'build-b' }),
    modules,
  );

  expect(result).toEqual({ ok: false, reason: 'incompatible-build' });
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('accepts a bounded page-owned stylesheet link in the approved navigation representation', async () => {
  // Given: HTTP approves a mapped destination and one same-origin stylesheet descriptor.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/admin/qr` } });
  const metadata = { links: [{ rel: 'stylesheet', href: '/assets/route-only.css' }] };
  vi.stubGlobal('fetch', vi.fn(async () => grantedResponse({}, { ...payload, metadata })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the browser validates the actual versioned media type before importing.
  const result = await loadReactNavigationDestination(payload.url, modules);

  // Then: the mapped destination and page-owned stylesheet are approved together.
  expect(result).toMatchObject({ ok: true, payload: { ...payload, metadata } });
  expect(modules['./navigation-product.ts']).toHaveBeenCalledOnce();
});

it.each([
  ['stale URL', { ...payload, url: '/products/sku-42' }],
  ['legacy v1', { ...payload, version: 1 }],
  ['unbuilt destination', { ...payload, destination: { module: './unbuilt.ts', props: {} } }],
  ['non-JSON props', { ...payload, destination: { module: './navigation-product.ts', props: 'secret' } }],
  ['oversized title', { ...payload, metadata: { title: 'x'.repeat(513) } }],
  ['unsafe link URL', { ...payload, metadata: { links: [{ rel: 'canonical', href: 'javascript:alert(1)' }] } }],
  ['backslash-host link URL', { ...payload, metadata: { links: [{ rel: 'canonical', href: '/\\elsewhere.test/path' }] } }],
  ['duplicate meta identity', { ...payload, metadata: {
    meta: [{ name: 'description', content: 'first' }, { name: 'description', content: 'second' }],
  } }],
  ['duplicate link identity', { ...payload, metadata: {
    links: [{ rel: 'canonical', href: '/products/sku-84' }, { rel: 'canonical', href: '/products/sku-84' }],
  } }],
] as const)('does not import an invalid initial %s', async (_kind, candidate) => {
  // Given: document data that has not been approved for the current built browser route.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}${payload.url}` } });
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the initial bootstrap validates the transferred document data.
  const result = await loadReactInitialNavigationDestination(JSON.stringify(candidate), modules);

  // Then: no unsupported page module can be imported or hydrated.
  expect(result.ok).toBe(false);
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it.each([
  [0, 15_000],
  [4, 11_000],
] as const)('prefetches anonymously with Age %i and reports remaining freshness', async (age, remainingMs) => {
  // Given: the public representation has spent a known number of seconds in an HTTP cache.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const fetchResult = vi.fn(async () => grantedResponse({ Age: String(age) }));
  vi.stubGlobal('fetch', fetchResult);
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the browser starts an anonymous prefetch.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    prefetch: true,
  });

  // Then: it uses an anonymous uncached request and subtracts server Age from reuse.
  expect(fetchResult).toHaveBeenCalledWith(`${ORIGIN}/products/sku-84?preview=false`, {
    cache: 'no-store',
    credentials: 'omit',
    headers: { Accept: MEDIA_TYPE },
    redirect: 'manual',
  });
  expect(result).toMatchObject({
    ok: true,
    payload,
    prefetchExpiresAt: Date.now() + remainingMs,
  });
  expect(modules['./navigation-product.ts']).toHaveBeenCalledOnce();
});

it.each([
  ['missing grant', { 'X-Fluo-Navigation-Prefetch': '' }],
  ['private cache policy', { 'Cache-Control': 'private, no-store' }],
  ['pre-existing public cache policy without grant', {
    'X-Fluo-Navigation-Prefetch': '',
    'Cache-Control': 'public, max-age=15',
  }],
  ['unsupported Vary', { Vary: 'Accept, Cookie' }],
  ['wildcard Vary', { Vary: '*' }],
  ['expired Age', { Age: '15' }],
  ['malformed Age', { Age: 'not-seconds' }],
  ['negative Age', { Age: '-1' }],
  ['missing cache freshness', { 'Cache-Control': 'public' }],
] as const)('does not import or reuse a prefetch with %s', async (_kind, headers) => {
  // Given: one unapproved response that would otherwise contain a valid destination.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => grantedResponse(headers)));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: anonymous prefetch examines the response.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    prefetch: true,
  });

  // Then: no unapproved representation is imported or offered for reuse.
  expect(result.ok).toBe(false);
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it.each([
  ['redirect', new Response(null, { status: 302, headers: { Location: '/sign-in' } })],
  ['authentication required', new Response('unauthorized', { status: 401 })],
  ['denied', new Response('forbidden', { status: 403 })],
  ['not found', new Response('not found', { status: 404 })],
  ['incorrect confirmed URL', grantedResponse({}, { ...payload, url: '/products/another-sku' })],
] as const)('never imports a prefetch from %s', async (_kind, response) => {
  // Given: HTTP either rejects the request or confirms a different pathname.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => response));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the browser tries to prefetch the requested destination.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    prefetch: true,
  });

  // Then: no invalid HTTP representation is imported or approved.
  expect(result.ok).toBe(false);
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('rejects an oversized prefetch response before importing its module', async () => {
  // Given: valid-shaped public navigation JSON larger than the 64 KiB entry limit.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => grantedResponse({}, {
    ...payload,
    destination: { ...payload.destination, props: { body: 'x'.repeat(65_536) } },
  })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: an anonymous prefetch reads the large JSON representation.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    prefetch: true,
  });

  // Then: the oversized body never produces a reusable or imported destination.
  expect(result.ok).toBe(false);
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('does not extend server freshness while the browser module imports', async () => {
  // Given: a validated public response whose module import takes the entire 15-second freshness.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => grantedResponse()));
  let releaseImport = (_module: { default: () => null }) => {};
  let importStarted = () => {};
  const importing = new Promise<void>((resolve) => { importStarted = resolve; });
  const modules = { './navigation-product.ts': () => new Promise<{ default: () => null }>((resolve) => {
    releaseImport = resolve;
    importStarted();
  }) };

  // When: import completes only after the original grant expires.
  const loading = loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    prefetch: true,
  });
  await importing;
  vi.setSystemTime(Date.now() + 15_000);
  releaseImport({ default: () => null });
  const result = await loading;

  // Then: import completion cannot restart the HTTP response's freshness budget.
  expect(result.ok && (result.prefetchExpiresAt ?? 0) > Date.now()).toBe(false);
});

it('cancels an oversized pending prefetch body without importing a module', async () => {
  // Given: a streaming public response exceeds the 64 KiB cap before the body ends.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(65_537)));
    },
    cancel: cancelled,
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
    headers: {
      'Content-Type': MEDIA_TYPE,
      'X-Fluo-Navigation-Prefetch': 'public',
      'Cache-Control': 'public, max-age=15',
      Vary: 'Accept',
    },
  })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the browser reads beyond the admitted prefetch body limit.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, {
    prefetch: true,
  });

  // Then: the stream is cancelled without waiting for its remaining bytes.
  expect(result.ok).toBe(false);
  expect(cancelled).toHaveBeenCalledOnce();
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('loads a built destination with credentials without reusing a private response', async () => {
  // Given: a server result whose module exists in the browser's build-produced import map.
  const fetchResult = vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': MEDIA_TYPE,
      'Cache-Control': 'private, no-store',
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

it('refreshes an approved current page through a new credentialed HTTP load', async () => {
  // Given: HTTP can deliver a changed private representation of the current URL.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}${payload.url}#details` } });
  const fetchResult = vi.fn(async () => new Response(JSON.stringify({
    ...payload, destination: { ...payload.destination, props: { sku: 'changed' } },
  }), { headers: { 'Content-Type': MEDIA_TYPE } }));
  vi.stubGlobal('fetch', fetchResult);
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };
  const store = createClientNavigationStore(createReactRouteSnapshot({ url: `${payload.url}#details` }));
  const reload = vi.fn();
  const pushState = vi.fn();
  store.connect({
    assign: vi.fn(), back: vi.fn(), currentHref: () => `${ORIGIN}${payload.url}#details`,
    load: (href, signal) => loadReactNavigationDestination(href, modules, { signal }),
    pushState, reload, replace: vi.fn(), replaceState: vi.fn(), subscribe: () => () => {},
  });

  // When: the page itself requests fresh HTTP approval.
  const result = await store.router.refresh();

  // Then: the approved new props commit without consuming a prefetch or changing history.
  expect(result).toEqual({ status: 'complete' });
  expect(store.getDestination()?.props).toEqual({ sku: 'changed' });
  expect(fetchResult).toHaveBeenCalledWith(`${ORIGIN}${payload.url}#details`, {
    cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: MEDIA_TYPE }, redirect: 'manual', signal: expect.any(AbortSignal),
  });
  expect(pushState).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('accepts the HTTP adapter-normalized version parameter and charset', async () => {
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/vnd.fluo.react-navigation+json; v="2"; charset=utf-8' },
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
  ['transient server error', new Response('unavailable', { status: 503 })],
  ['validation failure', new Response('invalid input', { status: 400 })],
  ['non-HTML result', new Response('{}', { headers: { 'Content-Type': 'application/json' } })],
  ['malformed payload', new Response('{', { headers: { 'Content-Type': MEDIA_TYPE } })],
  ['unsupported version', new Response(JSON.stringify({ ...payload, version: 1 }), { headers: { 'Content-Type': MEDIA_TYPE } })],
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

it.each([
  ['network', () => { throw new TypeError('fetch failed with private details'); }, 'network'],
  ['server', () => new Response('private server trace', { status: 503 }), 'server-error'],
  ['unauthorized', () => new Response('private session', { status: 401 }), 'unauthorized'],
  ['forbidden', () => new Response('private denial', { status: 403 }), 'forbidden'],
  ['redirect', () => new Response(null, { status: 302, headers: { Location: '/login' } }), 'redirect'],
  ['not found', () => new Response('missing', { status: 404 }), 'not-found'],
  ['DTO rejection', () => new Response('private DTO fields', { status: 400 }), 'dto-rejected'],
  ['malformed', () => new Response('{', { headers: { 'Content-Type': MEDIA_TYPE } }), 'invalid-payload'],
  ['unsupported module', () => grantedResponse({}, {
    ...payload, destination: { module: './missing.ts', props: {} },
  }), 'unsupported-module'],
  ['inherited module key', () => grantedResponse({}, {
    ...payload, destination: { module: '__proto__', props: {} },
  }), 'unsupported-module'],
] as const)('classifies %s without exposing response details', async (_scenario, response, reason) => {
  // Given: one negotiated HTTP response with distinct failure semantics.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => response()));

  // When: the existing loader requests the destination.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', {
    './navigation-product.ts': vi.fn(async () => ({ default: () => null })),
  });

  // Then: only a safe public reason crosses the browser navigation boundary.
  expect(result).toEqual({ ok: false, reason });
});

it('preserves the approved shell on a post-header body stream failure', async () => {
  // Given: HTTP has approved the media type, but the body stream fails while being read.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  const fetchResult = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError('private network stream details'));
    },
  }), {
    headers: {
      'Content-Type': MEDIA_TYPE,
      'X-Fluo-Navigation-Prefetch': 'public',
      'Cache-Control': 'public, max-age=15',
      Vary: 'Accept',
    },
  }));
  vi.stubGlobal('fetch', fetchResult);
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };
  const store = createClientNavigationStore(createReactRouteSnapshot({
    url: '/products/sku-42', params: { sku: 'sku-42' },
  }));
  const assign = vi.fn();
  let reportLoad = (_result: ReactNavigationLoadResult) => {};
  const loaded = new Promise<ReactNavigationLoadResult>((resolve) => { reportLoad = resolve; });
  store.connect({
    assign,
    back: vi.fn(),
    currentHref: () => `${ORIGIN}/products/sku-42`,
    failurePolicy: ({ reason }) => reason === 'network' ? 'preserve' : 'document',
    load: async (href, signal) => {
      const result = await loadReactNavigationDestination(href, modules, { signal });
      reportLoad(result);
      return result;
    },
    pushState: vi.fn(),
    reload: vi.fn(),
    replace: vi.fn(),
    replaceState: vi.fn(),
    subscribe: () => () => {},
  });
  const failure = new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (store.getSnapshot().navigation.status === 'error') {
        unsubscribe();
        resolve();
      }
    });
  });

  // When: a soft navigation reads the failing response body.
  store.router.push('/products/sku-84?preview=false');
  const result = await loaded;

  // Then: the real loader reports network failure and keeps the approved shell and URL.
  expect(result).toEqual({ ok: false, reason: 'network' });
  await failure;
  expect(store.getSnapshot()).toMatchObject({
    url: '/products/sku-42', params: { sku: 'sku-42' },
    navigation: { status: 'error', failure: { reason: 'network' } },
  });
  expect(assign).not.toHaveBeenCalled();
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
  expect(fetchResult).toHaveBeenCalledOnce();
});

it('classifies a failed streamed prefetch body as network rather than invalid payload', async () => {
  // Given: the prefetch grant headers arrive before the network body stream fails.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError('private network stream details'));
    },
  }), {
    headers: {
      'Content-Type': MEDIA_TYPE,
      'X-Fluo-Navigation-Prefetch': 'public',
      'Cache-Control': 'public, max-age=15',
      Vary: 'Accept',
    },
  })));
  const modules = { './navigation-product.ts': vi.fn(async () => ({ default: () => null })) };

  // When: the bounded prefetch reader consumes the failing stream.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', modules, { prefetch: true });

  // Then: no destination is imported, and network remains distinct from malformed JSON.
  expect(result).toEqual({ ok: false, reason: 'network' });
  expect(modules['./navigation-product.ts']).not.toHaveBeenCalled();
});

it('distinguishes a rejected build-mapped module import from an unsupported module', async () => {
  // Given: HTTP approved a module present in the build map, but loading its chunk fails.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => grantedResponse()));

  // When: the approved import rejects.
  const result = await loadReactNavigationDestination('/products/sku-84?preview=false', {
    './navigation-product.ts': async () => { throw new TypeError('private chunk path'); },
  });

  // Then: the consumer may explicitly distinguish recovery from an absent build module.
  expect(result).toEqual({ ok: false, reason: 'import-failure' });
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

it('discards a module that completes after the navigation request is cancelled', async () => {
  // Given: HTTP approved the destination while its build-produced module is still loading.
  vi.stubGlobal('window', { location: { href: `${ORIGIN}/products/sku-42` } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': MEDIA_TYPE },
  })));
  const controller = new AbortController();
  let completeImport = (_module: { default: () => null }) => {};
  let importStarted = () => {};
  const importing = new Promise<void>((resolve) => { importStarted = resolve; });
  const modules = {
    './navigation-product.ts': () => new Promise<{ default: () => null }>((settle) => {
      completeImport = settle;
      importStarted();
    }),
  };
  const loading: Promise<ReactNavigationLoadResult> = loadReactNavigationDestination(
    '/products/sku-84?preview=false',
    modules,
    { signal: controller.signal },
  );

  // When: cancellation occurs after HTTP acceptance but before the import resolves.
  await importing;
  controller.abort();
  completeImport({ default: () => null });

  // Then: the helper cannot report a destination from the cancelled request.
  expect(await loading).toEqual({ ok: false, reason: 'cancelled' });
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
