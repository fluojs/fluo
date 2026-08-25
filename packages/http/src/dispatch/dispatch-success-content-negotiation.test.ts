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

function createRequest(path: string, accept?: string): FrameworkRequest {
  return {
    cookies: {},
    headers: accept === undefined ? {} : { accept },
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
  @Produces('application/json', 'application/problem+json', 'text/plain')
  @Get('/all')
  all() {
    return { ok: true };
  }

  @Produces('application/json', 'text/plain')
  @Get('/without-suffix')
  withoutSuffix() {
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

async function dispatchBoth(path: string, accept?: string) {
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
    createRequest(path, accept),
    nativeResponse,
  );
  await fallbackDispatcher.dispatch(createRequest(path, accept), fallbackResponse);

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
    async (_name, path, accept, status, contentType, body) => {
      const { nativeDispatcher, fallbackDispatcher, response } = await dispatchBoth(path, accept);

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
