import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Delete,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  Head,
  Patch,
  Post,
  Produces,
  Put,
} from '../index.js';

type RecordedResponse = FrameworkResponse & {
  readonly sentBodies: unknown[];
};

function createRequest(
  method: string,
  headers: FrameworkRequest['headers'] = {},
  path = '/validators/resource',
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

function createResponse(): RecordedResponse {
  const sentBodies: unknown[] = [];

  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      sentBodies.push(body);
      this.committed = true;
    },
    sentBodies,
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

describe('conditional request policy', () => {
  it('gives If-Match precedence over If-Unmodified-Since before invoking an unsafe handler', async () => {
    let handlerCalls = 0;

    @Controller('/validators')
    class ValidatorsController {
      @Post('/resource')
      getResource() {
        handlerCalls += 1;
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    // Given: a stale strong If-Match and a later If-Unmodified-Since date.
    // When: the dispatcher receives the POST request.
    await dispatcher.dispatch(createRequest('POST', {
      'if-match': '"different-resource"',
      'if-unmodified-since': 'Thu, 01 Jan 2026 01:00:00 GMT',
    }), response);

    // Then: RFC validator precedence rejects the formatter-managed response before mutation.
    expect(response.statusCode).toBe(412);
    expect(handlerCalls).toBe(0);
  });

  it('uses weak comparison for If-None-Match and strong comparison for If-Match', async () => {
    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }

      @Post('/resource')
      updateResource() {
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const noneMatchResponse = createResponse();
    const matchResponse = createResponse();

    // Given: the same opaque tag is weak in both request validators.
    // When: GET evaluates If-None-Match and POST evaluates If-Match.
    await dispatcher.dispatch(createRequest('GET', { 'if-none-match': 'W/"resource-v1"' }), noneMatchResponse);
    await dispatcher.dispatch(createRequest('POST', { 'if-match': 'W/"resource-v1"' }), matchResponse);

    // Then: weak GET cache validation is fresh while unsafe strong matching fails.
    expect(noneMatchResponse.statusCode).toBe(304);
    expect(matchResponse.statusCode).toBe(412);
  });

  it('rejects a strong If-Match against a weak current validator', async () => {
    @Controller('/validators')
    class ValidatorsController {
      @Post('/resource')
      updateResource() {
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: { etag: { opaqueValue: 'resource-v1', strength: 'weak' } },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('POST', { 'if-match': '"resource-v1"' }), response);

    expect(response.statusCode).toBe(412);
  });

  it('weak-compares a strong If-None-Match against a weak current validator', async () => {
    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: { etag: { opaqueValue: 'resource-v1', strength: 'weak' } },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('GET', { 'if-none-match': '"resource-v1"' }), response);

    expect(response.statusCode).toBe(304);
  });

  it('gives a nonmatching If-None-Match precedence over a date that would produce 304', async () => {
    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('GET', {
      'if-modified-since': 'Thu, 01 Jan 2026 01:00:00 GMT',
      'if-none-match': '"different-resource"',
    }), response);

    expect(response.statusCode).toBe(200);
  });

  it('suppresses the body while retaining validators for a 304 response', async () => {
    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'weak' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    // Given: a cached weak validator for the selected representation.
    // When: If-None-Match matches the current response.
    await dispatcher.dispatch(createRequest('GET', { 'if-none-match': 'W/"resource-v1"' }), response);

    // Then: the portable adapter facade receives an empty 304 body with cache metadata.
    expect(response.sentBodies).toEqual([undefined]);
    expect(response.headers.ETag).toBe('W/"resource-v1"');
    expect(response.headers['Last-Modified']).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it('negotiates before conditional short-circuits and preserves representation metadata', async () => {
    let getResourceCalls = 0;
    let headResourceCalls = 0;

    @Controller('/validators')
    class ValidatorsController {
      @Produces('application/json')
      @Get('/negotiated')
      getResource() {
        getResourceCalls += 1;
        return { id: 'resource' };
      }

      @Produces('application/json')
      @Head('/negotiated')
      headResource() {
        headResourceCalls += 1;
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
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
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const getResponse = createResponse();
    const headResponse = createResponse();
    const nonmatchingResponse = createResponse();
    const unacceptableResponse = createResponse();
    getResponse.headers.Vary = 'Origin, accept';
    getResponse.headers.vary = 'ACCEPT, User-Agent';
    headResponse.headers.Vary = 'Origin, accept';
    headResponse.headers.vary = 'ACCEPT, User-Agent';

    // Given: validator matches are scoped to an application/json representation.
    // When: GET and HEAD select it, a validator misses it, and Accept selects no representation.
    await Promise.all([
      dispatcher.dispatch(createRequest('GET', {
        accept: 'application/json',
        'if-none-match': '"resource-v1"',
      }, '/validators/negotiated'), getResponse),
      dispatcher.dispatch(createRequest('HEAD', {
        accept: 'application/json',
        'if-none-match': '"resource-v1"',
      }, '/validators/negotiated'), headResponse),
      dispatcher.dispatch(createRequest('GET', {
        accept: 'application/json',
        'if-none-match': '"different-resource"',
      }, '/validators/negotiated'), nonmatchingResponse),
      dispatcher.dispatch(createRequest('GET', {
        accept: 'text/plain',
        'if-none-match': '"resource-v1"',
      }, '/validators/negotiated'), unacceptableResponse),
    ]);

    // Then: negotiation wins over 304, while negotiated 304s retain canonical cache metadata.
    expect(getResponse.statusCode).toBe(304);
    expect(getResponse.sentBodies).toEqual([undefined]);
    expect(getResponse.headers.ETag).toBe('"resource-v1"');
    expect(getResponse.headers['Last-Modified']).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
    expect(getResponse.headers.Vary).toBe('Origin, accept, User-Agent');
    expect(getResponse.headers.vary).toBeUndefined();
    expect(headResponse.statusCode).toBe(304);
    expect(headResponse.sentBodies).toEqual([undefined]);
    expect(headResponse.headers.ETag).toBe(getResponse.headers.ETag);
    expect(headResponse.headers['Last-Modified']).toBe(getResponse.headers['Last-Modified']);
    expect(headResponse.headers.Vary).toBe(getResponse.headers.Vary);
    expect(nonmatchingResponse.statusCode).toBe(200);
    expect(nonmatchingResponse.headers['Content-Type']).toBe('application/json');
    expect(nonmatchingResponse.headers.Vary).toBe('Accept');
    expect(nonmatchingResponse.sentBodies).toEqual(['{"id":"resource"}']);
    expect(unacceptableResponse.statusCode).toBe(406);
    expect(unacceptableResponse.headers.Vary).toBe('Accept');
    expect(getResourceCalls).toBe(1);
    expect(headResourceCalls).toBe(0);
  });

  it.each([
    ['POST', 'If-Match', { 'if-match': '"different-resource"' }],
    ['PUT', 'If-Match', { 'if-match': '"different-resource"' }],
    ['PATCH', 'If-Match', { 'if-match': '"different-resource"' }],
    ['DELETE', 'If-Match', { 'if-match': '"different-resource"' }],
    ['POST', 'If-None-Match', { 'if-none-match': '"resource-v1"' }],
    ['PUT', 'If-None-Match', { 'if-none-match': '"resource-v1"' }],
    ['PATCH', 'If-None-Match', { 'if-none-match': '"resource-v1"' }],
    ['DELETE', 'If-None-Match', { 'if-none-match': '"resource-v1"' }],
  ])(
    'short-circuits %s after a failed %s before its handler while retaining 412 validators',
    async (method, _condition, headers) => {
      let handlerCalls = 0;
      let interceptorCalls = 0;

      @Controller('/validators')
      class ValidatorsController {
        @Post('/resource')
        createResource() {
          handlerCalls += 1;
          return { id: 'resource' };
        }

        @Put('/resource')
        replaceResource() {
          handlerCalls += 1;
          return { id: 'resource' };
        }

        @Patch('/resource')
        updateResource() {
          handlerCalls += 1;
          return { id: 'resource' };
        }

        @Delete('/resource')
        deleteResource() {
          handlerCalls += 1;
          return { id: 'resource' };
        }
      }

      const dispatcher = createDispatcher({
        conditionalRequest: {
          resolve() {
            return {
              exists: true,
              validators: {
                etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              },
            };
          },
        },
        handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
        interceptors: [{
          async intercept(_context, next) {
            interceptorCalls += 1;
            return next.handle();
          },
        }],
        rootContainer: new Container().register(ValidatorsController),
      });
      const response = createResponse();

      // Given: an unsafe request with a failed entity-tag precondition.
      // When: the dispatcher evaluates the conditional headers.
      await dispatcher.dispatch(createRequest(method, headers), response);

      // Then: the portable adapter facade receives an empty precondition response and ETag.
      expect(response.statusCode).toBe(412);
      expect(response.sentBodies).toEqual([undefined]);
      expect(response.headers.ETag).toBe('"resource-v1"');
      expect(handlerCalls).toBe(0);
      expect(interceptorCalls).toBe(0);
    },
  );

  it('gives HEAD the same validators and status as GET without writing a body', async () => {
    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }

      @Head('/resource')
      headResource() {
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
            },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const getResponse = createResponse();
    const headResponse = createResponse();

    // Given: GET and HEAD select the same resource validators.
    // When: both request methods are dispatched.
    await dispatcher.dispatch(createRequest('GET'), getResponse);
    await dispatcher.dispatch(createRequest('HEAD'), headResponse);

    // Then: metadata and status are identical while HEAD sends no representation body.
    expect(headResponse.statusCode).toBe(getResponse.statusCode);
    expect(headResponse.headers.ETag).toBe(getResponse.headers.ETag);
    expect(headResponse.headers['Last-Modified']).toBe(getResponse.headers['Last-Modified']);
    expect(headResponse.sentBodies).toEqual([undefined]);
  });

});
