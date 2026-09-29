import { Inject, Module, Scope } from '@fluojs/core';
import {
  type CallHandler,
  ForbiddenException,
  type FrameworkRequest,
  type FrameworkResponse,
  FromPath,
  type GuardContext,
  type InterceptorContext,
  type MiddlewareContext,
  type Next,
  type RequestContext,
  RequestDto,
  UseGuards,
  UseInterceptors,
  Version,
} from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { createElement } from 'react';
import { expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { ReactNavigationPage } from './navigation-payload.js';
import { PageMetadata } from './page-metadata.js';
import { createReactServerEntry } from './server-entry.js';

function request(signal?: AbortSignal): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: { accept: 'application/vnd.fluo.react-navigation+json;v=1' },
    method: 'GET',
    params: {},
    path: '/destination',
    query: {},
    raw: {},
    ...(signal ? { signal } : {}),
    url: '/destination',
  };
}

function response(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

it('grants reuse only for an explicitly public navigation page', async () => {
  // Given: an identity-independent page explicitly declares public prefetch eligibility.
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Public'), {
        module: './destination.ts',
        props: {},
      }, { prefetch: 'public' });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP finalizes the anonymous negotiated navigation response.
    const result = response();
    await app.dispatch(request(), result);

    // Then: the completed representation carries the explicit public grant and freshness.
    expect(result.statusCode).toBe(200);
    expect(result.headers['X-Fluo-Navigation-Prefetch']).toBe('public');
    expect(result.headers['Cache-Control']).toBe('public, max-age=15');
    expect(result.headers.Vary).toBe('Accept');
  } finally {
    await app.close();
  }
});

it.each([
  ['Cookie', { cookie: 'session=secret' }, {}],
  ['Authorization', { authorization: 'Bearer secret' }, {}],
  ['Set-Cookie', {}, { 'Set-Cookie': 'session=updated; HttpOnly' }],
  ['pre-existing public Cache-Control', {}, { 'Cache-Control': 'public, max-age=15' }],
  ['pre-existing private Cache-Control', {}, { 'Cache-Control': 'private, no-store' }],
  ['pre-existing no-store Cache-Control', {}, { 'Cache-Control': 'no-store' }],
  ['Vary Cookie', {}, { Vary: 'Cookie' }],
  ['Vary wildcard', {}, { Vary: '*' }],
] as const)('does not grant public prefetch for %s', async (_kind, requestHeaders, rendererHeaders) => {
  // Given: a public page whose request or existing response policy prevents reuse.
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Public'), {
        module: './destination.ts',
        props: {},
      }, { prefetch: 'public' });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page, { headers: rendererHeaders }),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP finalizes the negotiated response under the restrictive input.
    const result = response();
    await app.dispatch({ ...request(), headers: { ...request().headers, ...requestHeaders } }, result);

    // Then: the existing policy survives and no public grant can be consumed by a browser.
    expect(result.statusCode).toBe(200);
    expect(result.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
    expect(result.headers['Cache-Control']).toContain('private, no-store');
    for (const [key, value] of Object.entries(rendererHeaders)) {
      expect(result.headers[key]).toContain(value);
    }
  } finally {
    await app.close();
  }
});

it('does not start an HTML stream for a negotiated destination', async () => {
  // Given: a matched page with a renderer that returns entry metadata without opening a stream.
  let renderCalls = 0;
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Destination'), {
        module: './destination.ts',
        props: { name: 'Destination' },
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage(page) {
        renderCalls++;
        return createReactServerEntry(page);
      },
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP selects the navigation representation.
    const result = response();
    await app.dispatch(request(), result);

    // Then: JSON is committed without opening a React stream or rendering HTML.
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ version: 1, destination: { module: './destination.ts' } });
    expect(renderCalls).toBe(1);
  } finally {
    await app.close();
  }
});

it('preserves renderer-owned status and headers for document and negotiated page results', async () => {
  // Given: a matched page whose renderer selects a not-found status and a refreshed session cookie.
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Unavailable'), {
        module: './destination.ts',
        props: {},
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page, {
        status: 404,
        headers: { 'Set-Cookie': 'session=renewed; HttpOnly', 'X-Page': 'unavailable' },
      }),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: the same route receives ordinary and explicitly negotiated GETs.
    const document = response();
    const navigation = response();
    await app.dispatch({ ...request(), headers: { accept: 'text/html' } }, document);
    await app.dispatch(request(), navigation);

    // Then: both retain the renderer's response metadata, with distinct body representations.
    expect(document.statusCode).toBe(404);
    expect(navigation.statusCode).toBe(404);
    for (const result of [document, navigation]) {
      expect(result.headers['Set-Cookie']).toBe('session=renewed; HttpOnly');
      expect(result.headers['X-Page']).toBe('unavailable');
    }
    expect(document.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(navigation.headers['Content-Type']).toBe('application/vnd.fluo.react-navigation+json;v=1');
    expect(navigation.body).toMatchObject({ version: 1, destination: { module: './destination.ts' } });
  } finally {
    await app.close();
  }
});

it('does not commit a navigation result after request cancellation', async () => {
  // Given: the handler cancels the request before response finalization.
  const abort = new AbortController();
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      abort.abort();
      return ReactNavigationPage.create(createElement('main', null, 'Destination'), {
        module: './destination.ts',
        props: {},
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: the request runs through the real dispatcher.
    const result = response();
    await app.dispatch(request(abort.signal), result);

    // Then: neither a navigation body nor fallback HTML is committed.
    expect(result.committed).toBe(false);
    expect(result.body).toBeUndefined();
  } finally {
    await app.close();
  }
});

it('uses URI version matching and the complete HTTP pipeline for navigation responses', async () => {
  // Given: a request-scoped versioned page with DTO binding, middleware, guard, and interceptor.
  const events: string[] = [];
  class PageRequest {
    @FromPath('sku')
    sku = '';
  }
  @Scope('request')
  class RequestMarker {
    private static next = 0;
    readonly id = ++RequestMarker.next;
  }
  class PageMiddleware {
    async handle(context: MiddlewareContext, next: Next) {
      events.push('middleware');
      context.response.setHeader('Vary', 'Cookie');
      context.response.setHeader('Cache-Control', 'private, max-age=0');
      await next();
    }
  }
  class PageGuard {
    canActivate(context: GuardContext) {
      events.push('guard');
      if (context.requestContext.request.headers['x-deny'] === 'true') {
        throw new ForbiddenException('Denied');
      }
      return true;
    }
  }
  class PageInterceptor {
    async intercept(context: InterceptorContext, next: CallHandler) {
      events.push('interceptor');
      context.requestContext.response.setHeader('Set-Cookie', 'session=renewed; HttpOnly');
      return next.handle();
    }
  }
  @Inject(RequestMarker)
  @Scope('request')
  @Version('2')
  @UseGuards(PageGuard)
  @UseInterceptors(PageInterceptor)
  @Router('/products')
  class ProductRouter {
    constructor(private readonly marker: RequestMarker) {}

    @Path('/:sku')
    @RequestDto(PageRequest)
    show(input: PageRequest) {
      events.push('handler');
      return ReactNavigationPage.create(createElement('main', null, input.sku), {
        module: './destination.ts',
        props: { requestId: this.marker.id, sku: input.sku },
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [ProductRouter],
      middleware: [PageMiddleware],
      providers: [RequestMarker, PageGuard, PageInterceptor],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP receives two negotiated page requests and invalid destinations.
    const first = response();
    const second = response();
    const denied = response();
    const missing = response();
    const target = (sku: string, headers = request().headers): FrameworkRequest => ({
      ...request(),
      headers,
      path: `/v2/products/${sku}`,
      url: `/v2/products/${sku}?preview=true`,
    });
    await app.dispatch(target('sku-42'), first);
    await app.dispatch(target('sku-84'), second);
    await app.dispatch(target('sku-42', { ...request().headers, 'x-deny': 'true' }), denied);
    await app.dispatch({ ...target('sku-42'), path: '/v1/products/sku-42', url: '/v1/products/sku-42' }, missing);

    // Then: matched params, URL, per-request state, and HTTP-owned errors cannot be forged by React.
    expect(first.body).toEqual({
      version: 1,
      url: '/v2/products/sku-42?preview=true',
      params: { sku: 'sku-42' },
      destination: { module: './destination.ts', props: { requestId: 1, sku: 'sku-42' } },
    });
    expect(second.body).toMatchObject({ destination: { props: { requestId: 2, sku: 'sku-84' } } });
    expect(first.headers.Vary).toBe('Cookie, Accept');
    expect(first.headers['Set-Cookie']).toBe('session=renewed; HttpOnly');
    expect(first.headers['Cache-Control']).toContain('private, no-store');
    expect(events.slice(0, 4)).toEqual(['middleware', 'guard', 'interceptor', 'handler']);
    expect(denied.statusCode).toBe(403);
    expect(missing.statusCode).toBe(404);
    expect([denied, missing].every((result) => result.headers['Content-Type'] !==
      'application/vnd.fluo.react-navigation+json;v=1')).toBe(true);
  } finally {
    await app.close();
  }
});

it('preserves HTTP redirects and non-page values under navigation negotiation', async () => {
  // Given: an HTTP-matched React router with outcomes that are not renderable pages.
  @Router('/destination')
  class DestinationRouter {
    @Path('/leave')
    leave(_input: undefined, context: RequestContext) {
      context.response.redirect(302, '/sign-in');
    }

    @Path('/data')
    data() {
      return { kind: 'plain-data' };
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: the same explicit media type reaches each ordinary HTTP outcome.
    const redirected = response();
    const nonPage = response();
    await app.dispatch({ ...request(), path: '/destination/leave', url: '/destination/leave' }, redirected);
    await app.dispatch({ ...request(), path: '/destination/data', url: '/destination/data' }, nonPage);

    // Then: neither an HTTP redirect nor a plain JSON value becomes a page payload.
    expect(redirected.statusCode).toBe(302);
    expect(redirected.headers.Location).toBe('/sign-in');
    expect(nonPage.body).toEqual({ kind: 'plain-data' });
    expect(nonPage.headers['Content-Type']).not.toBe('application/vnd.fluo.react-navigation+json;v=1');
  } finally {
    await app.close();
  }
});

it('keeps an unserializable destination on the HTTP pre-commit error path', async () => {
  // Given: application props that cannot cross the JSON response boundary.
  const props: Record<string, unknown> = {};
  props.self = props;
  @Router('/destination')
  class BrokenRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Broken'), {
        module: './destination.ts',
        props,
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [BrokenRouter],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP tries to finalize the explicitly negotiated representation.
    const result = response();
    await app.dispatch(request(), result);

    // Then: the standard HTTP error response commits once instead of partial navigation JSON.
    expect(result.statusCode).toBe(500);
    expect(result.headers['Content-Type']).not.toBe('application/vnd.fluo.react-navigation+json;v=1');
    expect(result.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR' } });
  } finally {
    await app.close();
  }
});

it('passes one bounded escaped HTTP-approved destination to the document renderer', async () => {
  // Given: a matched page with HTML-breaking data and a document renderer that embeds its transfer.
  const hostile = '</script><img src=x onerror=alert(1)>&\u2028\u2029';
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, hostile), {
        module: './page.tsx',
        props: { label: hostile },
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (_page, _context, _policies, initialPage) =>
        createReactServerEntry(createElement('html', null,
          createElement('body', null,
            createElement('script', {
              id: 'fluo-initial-page',
              type: 'application/json',
            }, initialPage?.json ?? ''),
          ),
        )),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: the same HTTP handler serves an ordinary document and a negotiated navigation request.
    const document = response();
    const navigation = response();
    await app.dispatch({ ...request(), headers: { accept: 'text/html' } }, document);
    await app.dispatch(request(), navigation);

    // Then: the inert script cannot break out and describes exactly the negotiated page.
    const html = new TextDecoder().decode(document.body as Uint8Array);
    const transferred = /<script id="fluo-initial-page" type="application\/json">([^<]*)<\/script>/u.exec(html);
    expect(document.statusCode).toBe(200);
    expect(transferred).not.toBeNull();
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(JSON.parse(transferred?.[1] ?? '')).toEqual(navigation.body);
  } finally {
    await app.close();
  }
});

it('carries the matched page metadata in both HTTP-approved representations', async () => {
  // Given: the matched page declares request-specific head descriptors.
  @Router('/destination')
  class DestinationRouter {
    @PageMetadata(({ request }) => ({
      links: [{ href: `/canonical${request.url}`, rel: 'canonical' }],
      meta: [{ content: request.url, name: 'description' }],
      title: `Destination ${request.url}`,
    }))
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Destination'), {
        module: './page.tsx', props: {},
      });
    }
  }
  let initialMetadata: unknown;
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page, _context, _policies, initialPage) => {
        if (initialPage !== undefined) {
          initialMetadata = initialPage.payload.metadata;
        }
        return createReactServerEntry(page);
      },
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP serves the ordinary document and its negotiated destination.
    const document = response();
    const navigation = response();
    await app.dispatch({ ...request(), headers: { accept: 'text/html' } }, document);
    await app.dispatch(request(), navigation);

    // Then: the one matched page defines exactly the same bounded head on both paths.
    const expected = {
      title: 'Destination /destination',
      meta: [{ name: 'description', content: '/destination' }],
      links: [{ rel: 'canonical', href: '/canonical/destination' }],
    };
    expect(document.statusCode).toBe(200);
    expect(navigation.statusCode).toBe(200);
    expect(initialMetadata).toEqual(expected);
    expect(navigation.body).toMatchObject({ metadata: expected });
  } finally {
    await app.close();
  }
});

it('rejects unbounded matched page metadata before either HTTP representation commits', async () => {
  // Given: the matched page's metadata exceeds the public navigation title bound.
  @Router('/destination')
  class DestinationRouter {
    @PageMetadata(() => ({ title: 'x'.repeat(513) }))
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Destination'), {
        module: './page.tsx', props: {},
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: HTTP negotiates either a document or a page payload.
    const document = response();
    const navigation = response();
    await app.dispatch({ ...request(), headers: { accept: 'text/html' } }, document);
    await app.dispatch(request(), navigation);

    // Then: both follow HTTP's error path instead of emitting a successful page.
    for (const result of [document, navigation]) {
      expect(result.statusCode).toBe(500);
      expect(result.headers['Content-Type']).not.toBe('application/vnd.fluo.react-navigation+json;v=1');
      expect(result.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR' } });
    }
  } finally {
    await app.close();
  }
});

it('rejects oversized initial page props before committing HTML', async () => {
  // Given: the selected destination exceeds the initial-document transfer ceiling.
  @Router('/destination')
  class DestinationRouter {
    @Path('/')
    show() {
      return ReactNavigationPage.create(createElement('main', null, 'Large'), {
        module: './page.tsx',
        props: { value: 'x'.repeat(65_536) },
      });
    }
  }
  @Module({
    imports: [ReactModule.forRoot({
      controllers: [DestinationRouter],
      renderPage: (page) => createReactServerEntry(page),
    })],
  })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  try {
    // When: an ordinary document GET reaches the real dispatcher.
    const result = response();
    await app.dispatch({ ...request(), headers: { accept: 'text/html' } }, result);

    // Then: no partial page shell is committed and HTTP owns the canonical error.
    expect(result.statusCode).toBe(500);
    expect(result.headers['Content-Type']).not.toBe('text/html; charset=utf-8');
    expect(result.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR' } });
  } finally {
    await app.close();
  }
});
