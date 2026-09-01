import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  Head,
  Post,
  type FrameworkRequest,
  type FrameworkResponse,
} from '../index.js';

type RecordedResponse = FrameworkResponse & {
  readonly sentBodies: unknown[];
};

function createRequest(
  method: string,
  headers: FrameworkRequest['headers'] = {},
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method,
    params: {},
    path: '/validators/resource',
    query: {},
    raw: {},
    url: '/validators/resource',
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
  it('gives If-Match precedence over If-Unmodified-Since before invoking a handler', async () => {
    let handlerCalls = 0;

    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        handlerCalls += 1;
        return { id: 'resource' };
      }
    }

    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return {
            etag: { opaqueValue: 'resource-v1', strength: 'strong' },
            lastModified: new Date('2026-01-01T00:00:00.750Z'),
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    // Given: a stale strong If-Match and a later If-Unmodified-Since date.
    // When: the dispatcher receives the GET request.
    await dispatcher.dispatch(createRequest('GET', {
      'if-match': '"different-resource"',
      'if-unmodified-since': 'Thu, 01 Jan 2026 01:00:00 GMT',
    }), response);

    // Then: RFC validator precedence rejects before executing the route.
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
            etag: { opaqueValue: 'resource-v1', strength: 'strong' },
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
            etag: { opaqueValue: 'resource-v1', strength: 'weak' },
            lastModified: new Date('2026-01-01T00:00:00.750Z'),
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

  it('suppresses the body while retaining validators for a 412 response', async () => {
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
            etag: { opaqueValue: 'resource-v1', strength: 'strong' },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    // Given: an unsafe request with a non-matching strong precondition.
    // When: the dispatcher evaluates If-Match.
    await dispatcher.dispatch(createRequest('POST', { 'if-match': '"different-resource"' }), response);

    // Then: the portable adapter facade receives an empty precondition response and ETag.
    expect(response.sentBodies).toEqual([undefined]);
    expect(response.headers.ETag).toBe('"resource-v1"');
  });

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
            etag: { opaqueValue: 'resource-v1', strength: 'strong' },
            lastModified: new Date('2026-01-01T00:00:00.750Z'),
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
