import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  Head,
  Header,
  type MiddlewareContext,
  type Next,
  Produces,
  Redirect,
} from '../index.js';
import {
  registerFrameworkResponseValueFinalizer,
  registerFrameworkResponseWriter,
} from '../internal.js';

type CustomResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly response: FrameworkResponse;
};

function createResponse(): FrameworkResponse & { body?: unknown } {
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
    statusCode: undefined,
    statusSet: false,
  };
}

function createRequest(
  path: string,
  headers: FrameworkRequest['headers'] = {},
  method: FrameworkRequest['method'] = 'GET',
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('dispatch response policy', () => {
  const navigationMediaType = 'application/vnd.fluo.react-navigation+json;v=1';
  const navigationBody = { version: 1, url: '/navigation-cache', params: {}, destination: { module: './page.ts', props: {} } };

  async function dispatchNavigation(
    options: {
      readonly prefetch?: 'public';
      readonly requestHeaders?: FrameworkRequest['headers'];
      readonly responseHeaders?: Readonly<Record<string, string>>;
      readonly status?: number;
      readonly abort?: AbortController;
    } = {},
  ) {
    const page = { html: '<main>Navigation page</main>' };
    registerFrameworkResponseWriter(page, ({ applySuccessResponseMetadata, response }) => {
      applySuccessResponseMetadata();
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return response.send(page.html);
    });
    Object.defineProperty(page, Symbol.for('fluo.http.responseRepresentation'), {
      value: {
        mediaType: navigationMediaType,
        prefetch: options.prefetch,
        body: ({ applySuccessResponseMetadata, response }: CustomResponseWriterContext) => {
          applySuccessResponseMetadata();
          for (const [name, value] of Object.entries(options.responseHeaders ?? {})) {
            response.setHeader(name, value);
          }
          if (options.status !== undefined) {
            response.setStatus(options.status);
          }
          options.abort?.abort();
          return navigationBody;
        },
      },
    });

    @Controller('/navigation-cache')
    class NavigationCacheController {
      @Header('X-Route', 'preserved')
      @Get('/')
      getValue() {
        return page;
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return { exists: true, validators: { etag: { opaqueValue: 'navigation-v1', strength: 'strong' } } };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: NavigationCacheController }]),
      rootContainer: new Container().register(NavigationCacheController),
    });
    const response = createResponse();
    const request = createRequest('/navigation-cache', {
      accept: navigationMediaType,
      ...options.requestHeaders,
    });
    if (options.abort) {
      request.signal = options.abort.signal;
    }

    await dispatcher.dispatch(request, response);
    return response;
  }

  it('grants only explicitly public navigation JSON after final metadata and validators', async () => {
    // Given: a public page and an otherwise anonymous negotiated GET.
    // When: HTTP finalizes the response after renderer metadata.
    const response = await dispatchNavigation({ prefetch: 'public', responseHeaders: { Vary: 'accept' } });

    // Then: the grant has compatible cache companions without losing response metadata.
    expect(response.statusCode).toBe(200);
    expect(response.headers['X-Fluo-Navigation-Prefetch']).toBe('public');
    expect(response.headers['Cache-Control']).toBe('public, max-age=15');
    expect(response.headers.Vary).toBe('accept');
    expect(response.headers['X-Route']).toBe('preserved');
    expect(response.headers.ETag).toBe('"navigation-v1"');
    expect(response.headers['Content-Type']).toBe(navigationMediaType);
    expect(response.body).toEqual(navigationBody);
  });

  const deniedNavigationCases: ReadonlyArray<readonly [string, NonNullable<Parameters<typeof dispatchNavigation>[0]>]> = [
    ['default page', {}],
    ['Cookie', { prefetch: 'public', requestHeaders: { cOoKiE: 'session=abc' } }],
    ['Authorization', { prefetch: 'public', requestHeaders: { AUTHORIZATION: 'Bearer abc' } }],
    ['Set-Cookie', { prefetch: 'public', responseHeaders: { 'set-cookie': 'session=renewed' } }],
    ['Vary Cookie', { prefetch: 'public', responseHeaders: { Vary: 'Accept, Cookie' } }],
    ['Vary wildcard', { prefetch: 'public', responseHeaders: { Vary: '*' } }],
    ['status 201', { prefetch: 'public', status: 201 }],
    ['status 302', { prefetch: 'public', status: 302 }],
    ['status 401', { prefetch: 'public', status: 401 }],
    ['status 403', { prefetch: 'public', status: 403 }],
    ['status 404', { prefetch: 'public', status: 404 }],
  ];

  it.each(deniedNavigationCases)('denies reuse for %s without changing the successful response', async (_reason, options) => {
    // Given: one disqualifying request or final-response condition.
    // When: HTTP finalizes the negotiated page.
    const response = await dispatchNavigation(options);

    // Then: it keeps the ordinary private policy and never grants reusable JSON.
    expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
    expect(response.headers['Cache-Control']).toBe('private, no-store');
    expect(response.headers.Vary).toBe(options.responseHeaders?.Vary === '*'
      ? '*'
      : options.responseHeaders?.Vary ?? 'Accept');
    expect(response.statusCode).toBe(options.status ?? 200);
    expect(response.body).toEqual(navigationBody);
  });

  it.each(['public, max-age=3600', 'private, max-age=0', 'no-store'])(
    'retains existing Cache-Control %s while prohibiting denied reuse',
    async (cacheControl) => {
      // Given: application-owned cache restrictions, including apparently public policy.
      // When: HTTP finalizes an explicitly marked page.
      const response = await dispatchNavigation({
        prefetch: 'public',
        responseHeaders: { 'cache-control': cacheControl },
      });

      // Then: prior directives remain while the final response is explicitly non-reusable.
      expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
      expect(response.headers['cache-control']).toBe(`${cacheControl}, private, no-store`);
      expect(response.headers['Cache-Control']).toBeUndefined();
      expect(response.headers.Vary).toBe('Accept');
    },
  );

  it('keeps public opt-in HTML on its original streaming writer and private policy off the document', async () => {
    // Given: the same public page requested as HTML instead of navigation JSON.
    // When: the dispatcher chooses the integration-owned HTML writer.
    const response = await dispatchNavigation({
      prefetch: 'public',
      requestHeaders: { accept: 'text/html' },
    });

    // Then: the document is never granted JSON prefetch reuse.
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
    expect(response.headers['Cache-Control']).toBeUndefined();
    expect(response.headers.Vary).toBe('Accept');
    expect(response.body).toBe('<main>Navigation page</main>');
  });

  it('does not expose an application-provided grant header for a denied navigation response', async () => {
    // Given: middleware or a renderer sets the HTTP-owned grant despite a session cookie.
    // When: HTTP finalizes the public page with an identity-bearing request.
    const response = await dispatchNavigation({
      prefetch: 'public',
      requestHeaders: { Cookie: 'session=abc' },
      responseHeaders: { 'x-fluo-navigation-prefetch': 'public' },
    });

    // Then: the final wire headers cannot falsely authorize reuse.
    expect(Object.entries(response.headers).some(
      ([name]) => name.toLowerCase() === 'x-fluo-navigation-prefetch',
    )).toBe(false);
    expect(response.headers['Cache-Control']).toBe('private, no-store');
  });

  it('does not grant or commit a page aborted during representation creation', async () => {
    // Given: a public page whose renderer cancels the request.
    // When: HTTP awaits its negotiated body.
    const response = await dispatchNavigation({ prefetch: 'public', abort: new AbortController() });

    // Then: no final response or grant is written.
    expect(response.committed).toBe(false);
    expect(response.body).toBeUndefined();
    expect(response.headers['X-Fluo-Navigation-Prefetch']).toBeUndefined();
  });

  it('lets custom response writers bypass formatter negotiation before HTML streaming', async () => {
    const htmlEntry = { html: '<main>React SSR</main>' };

    Object.defineProperty(htmlEntry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value(context: CustomResponseWriterContext) {
        context.applySuccessResponseMetadata();
        context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
        return context.response.send(htmlEntry.html);
      },
    });

    @Controller('/custom-writer-negotiation')
    class CustomWriterNegotiationController {
      @Header('x-react-route', 'html')
      @Get('/html')
      getValue() {
        return htmlEntry;
      }
    }

    const root = new Container().register(CustomWriterNegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: CustomWriterNegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/custom-writer-negotiation/html', { accept: 'text/plain' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-react-route']).toBe('html');
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>React SSR</main>');
  });

  it('preserves application-owned custom response writer behavior for HEAD', async () => {
    const htmlEntry = { html: '<main>Application-owned HEAD body</main>' };

    Object.defineProperty(htmlEntry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value(context: CustomResponseWriterContext) {
        context.applySuccessResponseMetadata();
        context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
        return context.response.send(htmlEntry.html);
      },
    });

    @Controller('/custom-writer-head')
    class CustomWriterHeadController {
      @Head('/')
      head() {
        return htmlEntry;
      }
    }

    const root = new Container().register(CustomWriterHeadController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: CustomWriterHeadController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/custom-writer-head', {}, 'HEAD'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>Application-owned HEAD body</main>');
  });

  it('finalizes an integration-owned handler value before selecting its response writer', async () => {
    const pageValue = { kind: 'page' };
    const htmlEntry = { html: '<main>Finalized page</main>' };

    Object.defineProperty(htmlEntry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value(context: CustomResponseWriterContext) {
        context.applySuccessResponseMetadata();
        context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
        return context.response.send(htmlEntry.html);
      },
    });

    @Controller('/response-finalizer')
    class ResponseFinalizerController {
      @Get('/page')
      getValue() {
        return pageValue;
      }
    }

    const root = new Container().register(ResponseFinalizerController);
    const dispatcher = createDispatcher({
      appMiddleware: [{
        async handle(context: MiddlewareContext, next: Next) {
          context.requestContext.metadata[Symbol.for('fluo.http.responseValueFinalizer')] = ({ value }: { value: unknown }) => (
            value === pageValue ? htmlEntry : value
          );
          await next();
        },
      }],
      handlerMapping: createHandlerMapping([{ controllerToken: ResponseFinalizerController }]),
      rootContainer: root,
    });
    const response = createResponse();

    // Given: an integration installs a request-local result finalizer through middleware metadata.
    // When: the controller result reaches the shared success-response policy.
    await dispatcher.dispatch(createRequest('/response-finalizer/page'), response);

    // Then: the finalized value uses its custom writer instead of ordinary object serialization.
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>Finalized page</main>');
  });

  it('awaits ordered integration finalizers before selecting the response writer', async () => {
    const pageValue = { kind: 'page' };
    const firstFinalizedValue = { kind: 'first-finalized-page' };
    const htmlEntry = { html: '<main>Composed finalized page</main>' };
    const finalizerValues: unknown[] = [];

    registerFrameworkResponseWriter(htmlEntry, (context) => {
      context.applySuccessResponseMetadata();
      context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return context.response.send(htmlEntry.html);
    });

    @Controller('/composed-response-finalizer')
    class ComposedResponseFinalizerController {
      @Get('/page')
      getValue() {
        return pageValue;
      }
    }

    const root = new Container().register(ComposedResponseFinalizerController);
    const dispatcher = createDispatcher({
      appMiddleware: [{
        async handle(context: MiddlewareContext, next: Next) {
          registerFrameworkResponseValueFinalizer(context.requestContext, ({ value }) => {
            finalizerValues.push(value);
            return value === pageValue ? firstFinalizedValue : value;
          });
          registerFrameworkResponseValueFinalizer(context.requestContext, async ({ value }) => {
            finalizerValues.push(value);
            return value === firstFinalizedValue ? htmlEntry : value;
          });
          await next();
        },
      }],
      handlerMapping: createHandlerMapping([{ controllerToken: ComposedResponseFinalizerController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/composed-response-finalizer/page'), response);

    expect(finalizerValues).toEqual([pageValue, firstFinalizedValue]);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<main>Composed finalized page</main>');
  });

  it('routes asynchronous finalizer rejections through the dispatcher error policy', async () => {
    @Controller('/rejected-response-finalizer')
    class RejectedResponseFinalizerController {
      @Get('/page')
      getValue() {
        return { kind: 'page' };
      }
    }

    const root = new Container().register(RejectedResponseFinalizerController);
    const dispatcher = createDispatcher({
      appMiddleware: [{
        async handle(context: MiddlewareContext, next: Next) {
          registerFrameworkResponseValueFinalizer(context.requestContext, async () => {
            throw new Error('finalizer rejected');
          });
          await next();
        },
      }],
      handlerMapping: createHandlerMapping([{ controllerToken: RejectedResponseFinalizerController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/rejected-response-finalizer/page'), response);

    expect(response.committed).toBe(true);
    expect(response.statusCode).toBe(500);
  });

  it('retains resolved validators when a custom response writer commits the response', async () => {
    const htmlEntry = { html: '<main>Validator writer</main>' };

    registerFrameworkResponseWriter(htmlEntry, (context) => {
      context.applySuccessResponseMetadata();
      context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return context.response.send(htmlEntry.html);
    });

    @Controller('/validator-writer')
    class ValidatorWriterController {
      @Get('/')
      getValue() {
        return htmlEntry;
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'writer-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorWriterController }]),
      rootContainer: new Container().register(ValidatorWriterController),
    });
    const response = createResponse();

    // Given: a custom response writer commits the selected representation.
    // When: the dispatcher writes the successful response.
    await dispatcher.dispatch(createRequest('/validator-writer'), response);

    // Then: its body and the dispatcher-owned validators are both present.
    expect(response.body).toBe('<main>Validator writer</main>');
    expect(response.headers.ETag).toBe('"writer-v1"');
    expect(response.headers['Last-Modified']).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it('retains resolved validators when a redirect commits the response', async () => {
    @Controller('/validator-redirect')
    class ValidatorRedirectController {
      @Get('/')
      @Redirect('/destination', 302)
      getValue() {
        return { redirected: true };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'redirect-v1', strength: 'weak' },
              lastModified: new Date('2026-01-01T00:00:00Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorRedirectController }]),
      rootContainer: new Container().register(ValidatorRedirectController),
    });
    const response = createResponse();

    // Given: a route commits a redirect response.
    // When: the dispatcher writes the successful response.
    await dispatcher.dispatch(createRequest('/validator-redirect'), response);

    // Then: redirect metadata and the selected validators remain visible.
    expect(response.statusCode).toBe(302);
    expect(response.headers.Location).toBe('/destination');
    expect(response.headers.ETag).toBe('W/"redirect-v1"');
    expect(response.headers['Last-Modified']).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it.each([
    ['GET'],
    ['HEAD'],
  ])('retains route cache metadata on negotiated matching %s validators', async (method) => {
    let handlerCalls = 0;

    @Controller('/conditional-route-headers')
    class ConditionalRouteHeadersController {
      @Get('/')
      @Produces('application/json')
      @Header('Vary', 'Origin, origin, ORIGIN')
      @Header('Cache-Control', 'public, max-age=3600')
      @Header('Expires', 'Thu, 01 Jan 2026 01:00:00 GMT')
      getValue() {
        handlerCalls += 1;
        return { ok: true };
      }

      @Head('/')
      @Produces('application/json')
      @Header('Vary', 'Origin, origin, ORIGIN')
      @Header('Cache-Control', 'public, max-age=3600')
      @Header('Expires', 'Thu, 01 Jan 2026 01:00:00 GMT')
      headValue() {
        handlerCalls += 1;
        return { ok: true };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'route-cache-v1', strength: 'strong' },
            },
          };
        },
      },
      contentNegotiation: {
        formatters: [{
          format(body) {
            return JSON.stringify(body);
          },
          mediaType: 'application/json',
        }],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ConditionalRouteHeadersController }]),
      rootContainer: new Container().register(ConditionalRouteHeadersController),
    });
    const response = createResponse();

    // Given: negotiated route metadata and a matching current representation validator.
    // When: a GET or HEAD request carries If-None-Match for that representation.
    await dispatcher.dispatch(createRequest(
      '/conditional-route-headers',
      { accept: 'application/json', 'if-none-match': '"route-cache-v1"' },
      method,
    ), response);

    // Then: the bodyless 304 preserves static cache metadata and canonicalizes Vary.
    expect(response.statusCode).toBe(304);
    expect(response.body).toBeUndefined();
    expect(response.headers.Vary).toBe('Origin, Accept');
    expect(response.headers['Cache-Control']).toBe('public, max-age=3600');
    expect(response.headers.Expires).toBe('Thu, 01 Jan 2026 01:00:00 GMT');
    expect(handlerCalls).toBe(0);
  });

  it.each([
    ['GET'],
    ['HEAD'],
  ])('keeps %s redirects unconditional when a matching condition cannot negotiate a formatter', async (method) => {
    let handlerCalls = 0;

    @Controller('/conditional-redirect-bypass')
    class ConditionalRedirectBypassController {
      @Get('/')
      @Redirect('/destination', 302)
      getValue() {
        handlerCalls += 1;
        return { redirected: true };
      }

      @Head('/')
      @Redirect('/destination', 302)
      headValue() {
        handlerCalls += 1;
        return { redirected: true };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'redirect-v1', strength: 'strong' },
            },
          };
        },
      },
      contentNegotiation: {
        formatters: [{
          format(body) {
            return JSON.stringify(body);
          },
          mediaType: 'application/json',
        }],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ConditionalRedirectBypassController }]),
      rootContainer: new Container().register(ConditionalRedirectBypassController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest(
      '/conditional-redirect-bypass',
      { accept: 'text/plain', 'if-none-match': '"redirect-v1"' },
      method,
    ), response);

    expect(response.statusCode).toBe(302);
    expect(response.headers.Location).toBe('/destination');
    expect(response.headers.ETag).toBe('"redirect-v1"');
    expect(response.headers.Vary).toBeUndefined();
    expect(handlerCalls).toBe(1);
  });

  it.each([
    ['GET'],
    ['HEAD'],
  ])('keeps %s custom writers unconditional when a matching condition cannot negotiate a formatter', async (method) => {
    const htmlEntry = { html: '<main>Conditional writer</main>' };
    let handlerCalls = 0;

    registerFrameworkResponseWriter(htmlEntry, (context) => {
      context.applySuccessResponseMetadata();
      context.response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return context.response.send(htmlEntry.html);
    });

    @Controller('/conditional-writer-bypass')
    class ConditionalWriterBypassController {
      @Get('/')
      getValue() {
        handlerCalls += 1;
        return htmlEntry;
      }

      @Head('/')
      headValue() {
        handlerCalls += 1;
        return htmlEntry;
      }
    }

    const dispatcher = createDispatcher({
      appMiddleware: [{
        async handle(context: MiddlewareContext, next: Next) {
          registerFrameworkResponseValueFinalizer(context.requestContext, ({ value }) => value);
          await next();
        },
      }],
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'writer-v1', strength: 'strong' },
            },
          };
        },
      },
      contentNegotiation: {
        formatters: [{
          format(body) {
            return JSON.stringify(body);
          },
          mediaType: 'application/json',
        }],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ConditionalWriterBypassController }]),
      rootContainer: new Container().register(ConditionalWriterBypassController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest(
      '/conditional-writer-bypass',
      { accept: 'text/plain', 'if-none-match': '"writer-v1"' },
      method,
    ), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers.ETag).toBe('"writer-v1"');
    expect(response.headers.Vary).toBeUndefined();
    expect(response.body).toBe('<main>Conditional writer</main>');
    expect(handlerCalls).toBe(1);
  });
});
