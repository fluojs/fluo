import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  getDispatcherFastPathStats,
  Header,
  type MiddlewareContext,
  type Next,
  Produces,
} from '../index.js';

type TestResponse = FrameworkResponse & { body?: unknown };

function createRequest(
  path: string,
  accept?: string,
  headers?: FrameworkRequest['headers'],
): FrameworkRequest {
  return {
    cookies: {},
    headers: headers ?? (accept === undefined ? {} : { accept }),
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestResponse {
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

@Controller('/representations')
class RepresentationController {
  @Produces('application/json', 'application/problem+json', 'text/plain', 'application/json;note="a,b=c\\"d\\\\e"', 'application/json;profile=v2')
  @Get('/all')
  all() {
    return { ok: true };
  }

  @Produces('application/json', 'text/plain')
  @Get('/without-suffix')
  withoutSuffix() {
    return { ok: true };
  }

  @Produces('application/json;note="a,b=c\\"d\\\\e"')
  @Get('/parameterized')
  parameterized() {
    return { ok: true };
  }

  @Produces('application/json;a="x;b=y"')
  @Get('/structural-quoted')
  structuralQuoted() {
    return { ok: true };
  }

  @Header('Vary', 'Accept-Encoding, accept')
  @Produces('application/json', 'text/plain')
  @Get('/existing-vary')
  existingVary() {
    return { ok: true };
  }
}

const formatters = [
  {
    format() {
      return 'json';
    },
    mediaType: 'application/json',
  },
  {
    format() {
      return 'problem';
    },
    mediaType: 'application/problem+json',
  },
  {
    format() {
      return 'plain';
    },
    mediaType: 'text/plain',
  },
  {
    format() {
      return 'json-note';
    },
    mediaType: 'application/json;note="a,b=c\\"d\\\\e"',
  },
  {
    format() {
      return 'json-profile';
    },
    mediaType: 'application/json;profile=v2',
  },
  {
    format() {
      return 'json-a-x-b-y';
    },
    mediaType: 'application/json;a=x;b=y',
  },
  {
    format() {
      return 'json-a-x-semicolon-b-y';
    },
    mediaType: 'application/json;a="x;b=y"',
  },
];

function createNegotiatingDispatchers() {
  const root = new Container().register(RepresentationController);
  const handlerMapping = createHandlerMapping([{ controllerToken: RepresentationController }]);
  const nativeDispatcher = createDispatcher({
    contentNegotiation: {
      defaultMediaType: 'text/plain',
      formatters,
    },
    handlerMapping,
    rootContainer: root,
  });
  const fallbackDispatcher = createDispatcher({
    appMiddleware: [{
      async handle(_context: MiddlewareContext, next: Next) {
        await next();
      },
    }],
    contentNegotiation: {
      defaultMediaType: 'text/plain',
      formatters,
    },
    handlerMapping,
    rootContainer: root,
  });

  return { fallbackDispatcher, nativeDispatcher };
}

async function dispatchBoth(path: string, accept?: string, headers?: FrameworkRequest['headers']) {
  const { fallbackDispatcher, nativeDispatcher } = createNegotiatingDispatchers();
  if (!nativeDispatcher.describeRoutes || !nativeDispatcher.dispatchNativeRoute) {
    throw new Error('Expected native route dispatch support.');
  }

  const descriptor = nativeDispatcher.describeRoutes().find((candidate) => candidate.route.path === path);
  if (!descriptor) {
    throw new Error(`Missing native descriptor for ${path}.`);
  }

  const nativeResponse = createResponse();
  const fallbackResponse = createResponse();
  const nativeHandled = await nativeDispatcher.dispatchNativeRoute(
    { descriptor, params: {} },
    createRequest(path, accept, headers),
    nativeResponse,
  );
  await fallbackDispatcher.dispatch(createRequest(path, accept, headers), fallbackResponse);

  expect(nativeHandled).toBe(true);
  expect({
    body: nativeResponse.body,
    committed: nativeResponse.committed,
    headers: nativeResponse.headers,
    statusCode: nativeResponse.statusCode,
  }).toEqual({
    body: fallbackResponse.body,
    committed: fallbackResponse.committed,
    headers: fallbackResponse.headers,
    statusCode: fallbackResponse.statusCode,
  });
  return { fallbackDispatcher, nativeDispatcher, response: nativeResponse };
}

describe('successful response content negotiation', () => {
  it.each([
    ['quality', '/representations/all', 'application/json;q=0.4, text/plain;q=0.9', 200, 'text/plain', 'plain'],
    ['exact range', '/representations/all', 'application/problem+json', 200, 'application/problem+json', 'problem'],
    ['subtype wildcard', '/representations/all', 'text/*', 200, 'text/plain', 'plain'],
    ['structured suffix wildcard', '/representations/all', 'application/*+json', 200, 'application/problem+json', 'problem'],
    ['configured default without Accept', '/representations/all', undefined, 200, 'text/plain', 'plain'],
    ['configured default for */*', '/representations/all', '*/*', 200, 'text/plain', 'plain'],
    ['valid entry after malformed range', '/representations/all', 'not-a-range, application/json', 200, 'application/json', 'json'],
    ['malformed quality', '/representations/all', 'application/json;q=2', 406, undefined, undefined],
    [
      'malformed quality alongside a valid entry',
      '/representations/all',
      'application/json;q=0.9=invalid, text/plain;q=0.2',
      200,
      'text/plain',
      'plain',
    ],
    [
      'quoted media parameter',
      '/representations/all',
      'application/json;profile="a,b";q=0.1, text/plain;q=0.9',
      200,
      'text/plain',
      'plain',
    ],
    [
      'valid quoted comma equals escaped quote and backslash',
      '/representations/all',
      'application/json;note="a,b=c\\"d\\\\e";q=1, text/plain;q=0',
      200,
      'application/json;note="a,b=c\\"d\\\\e"',
      'json-note',
    ],
    [
      'parameterized representation wins after a generic range',
      '/representations/all',
      'application/json;q=1, application/json;profile=v2;q=1',
      200,
      'application/json;profile=v2',
      'json-profile',
    ],
    [
      'parameterized representation wins before a generic range',
      '/representations/all',
      'application/json;profile=v2;q=1, application/json;q=1',
      200,
      'application/json;profile=v2',
      'json-profile',
    ],
    [
      'combines duplicate-case Accept field arrays before candidate selection',
      '/representations/all',
      undefined,
      200,
      'application/json;profile=v2',
      'json-profile',
      {
        Accept: ['application/json;q=1', 'text/plain;q=0.1'],
        ACCEPT: ['application/json;profile=v2;q=1'],
      },
    ],
    [
      'rejects media parameters after q',
      '/representations/all',
      'application/json;q=1;note="a,b=c\\"d\\\\e", text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'parameterized q=0 overrides a preceding generic range',
      '/representations/parameterized',
      'application/json;q=1, application/json;note="a,b=c\\"d\\\\e";q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'parameterized q=0 overrides a following generic range',
      '/representations/parameterized',
      'application/json;note="a,b=c\\"d\\\\e";q=0, application/json;q=1',
      406,
      undefined,
      undefined,
    ],
    [
      'keeps structurally distinct media parameter representations',
      '/representations/structural-quoted',
      'application/json;a="x;b=y"',
      200,
      'application/json;a="x;b=y"',
      'json-a-x-semicolon-b-y',
    ],
    [
      'raw NUL in quoted parameter',
      '/representations/all',
      'application/json;note="a\0b";q=1, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'escaped NUL in quoted parameter',
      '/representations/all',
      'application/json;note="a\\\0b";q=1, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'raw carriage return in quoted parameter',
      '/representations/all',
      'application/json;note="a\rb";q=1, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'escaped carriage return in quoted parameter',
      '/representations/all',
      'application/json;note="a\\\rb";q=1, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'raw line feed in quoted parameter',
      '/representations/all',
      'application/json;note="a\nb";q=1, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'escaped line feed in quoted parameter',
      '/representations/all',
      'application/json;note="a\\\nb";q=1, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    [
      'media parameter without a matching representation',
      '/representations/without-suffix',
      'application/json;profile=v2',
      406,
      undefined,
      undefined,
    ],
    [
      'quoted parameter with an invalid escaped control octet',
      '/representations/without-suffix',
      'application/json;profile="a\\\u0001"',
      406,
      undefined,
      undefined,
    ],
    [
      'unterminated quoted parameter after a valid entry',
      '/representations/all',
      'application/json, text/plain;note="unterminated',
      200,
      'application/json',
      'json',
    ],
    [
      'malformed whitespace before quality assignment',
      '/representations/all',
      'application/json;q =0, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
    ['unsupported range', '/representations/all', 'image/avif', 406, undefined, undefined],
    [
      'exact q=0 overrides a positive wildcard',
      '/representations/without-suffix',
      'application/*;q=1, application/json;q=0, text/plain;q=0',
      406,
      undefined,
      undefined,
    ],
  ])(
    'keeps native and fallback dispatch identical for %s',
    async (_name, path, accept, status, contentType, body, headers?: FrameworkRequest['headers']) => {
      const { nativeDispatcher, fallbackDispatcher, response } = await dispatchBoth(path, accept, headers);

      expect(response.statusCode).toBe(status);
      expect(response.headers['Content-Type']).toBe(contentType);
      expect(getDispatcherFastPathStats(nativeDispatcher)?.routes.every((route) => route.executionPath === 'fast')).toBe(true);
      expect(getDispatcherFastPathStats(fallbackDispatcher)?.routes.every((route) => route.executionPath === 'full')).toBe(true);
      if (status === 200) {
        expect(response.body).toBe(body);
        expect(response.headers.Vary).toBe('Accept');
      } else {
        expect(response.body).toMatchObject({ error: { code: 'NOT_ACCEPTABLE', status: 406 } });
      }
    },
  );

  it('deduplicates Accept while preserving existing Vary fields', async () => {
    const { response } = await dispatchBoth('/representations/existing-vary', 'application/json');

    expect(response.headers.Vary).toBe('Accept-Encoding, accept');
    expect(
      String(response.headers.Vary)
        .split(',')
        .filter((field) => field.trim().toLowerCase() === 'accept'),
    ).toHaveLength(1);
  });
});
