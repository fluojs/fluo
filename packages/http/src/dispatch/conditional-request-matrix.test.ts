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

function createResponse(): FrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
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

  @Post('/resource')
  updateResource() {
    return { id: 'resource' };
  }
}

function createValidatorsDispatcher(exists = true) {
  return createDispatcher({
    conditionalRequest: {
      resolve() {
        return exists
          ? {
              exists: true as const,
              validators: {
                etag: { opaqueValue: 'resource-v1', strength: 'strong' as const },
                lastModified: new Date('1994-11-06T08:49:37Z'),
              },
            }
          : { exists: false as const };
      },
    },
    handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
    rootContainer: new Container().register(ValidatorsController),
  });
}

describe('conditional request comparison matrix', () => {
  it.each([
    ['strong If-Match accepts a strong current tag', 'GET', { 'if-match': '"resource-v1"' }, 200],
    ['strong If-Match rejects a weak candidate', 'GET', { 'if-match': 'W/"resource-v1"' }, 412],
    ['weak If-None-Match matches a strong current tag', 'GET', { 'if-none-match': 'W/"resource-v1"' }, 304],
    ['unsafe If-None-Match match selects 412', 'POST', { 'if-none-match': '"resource-v1"' }, 412],
    ['wildcard If-Match requires explicit representation existence', 'GET', { 'if-match': '*' }, 412, false],
  ])('%s', async (_name, method, headers, expectedStatus, exists = true) => {
    const response = createResponse();

    await createValidatorsDispatcher(exists).dispatch(createRequest(method, headers), response);

    expect(response.statusCode).toBe(expectedStatus);
  });

  it.each([
    ['GET', { 'if-none-match': '"resource-v1"' }],
    ['HEAD', { 'if-none-match': '"resource-v1"' }],
  ])('gives %s the same conditional representation status and validators', async (method, headers) => {
    const response = createResponse();

    await createValidatorsDispatcher().dispatch(createRequest(method, headers), response);

    expect(response.statusCode).toBe(304);
    expect(response.headers.ETag).toBe('"resource-v1"');
    expect(response.headers['Last-Modified']).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
  });

  it('continues after a successful If-Match when If-None-Match does not match', async () => {
    const response = createResponse();

    await createValidatorsDispatcher().dispatch(createRequest('GET', {
      'if-match': '"resource-v1"',
      'if-none-match': '"another-resource"',
      'if-unmodified-since': 'Sun, 06 Nov 1994 08:49:36 GMT',
    }), response);

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['returns 304 for an existing GET resource', 'GET', true, 304],
    ['returns 412 for an existing unsafe resource', 'POST', true, 412],
    ['continues to an absent resource handler', 'GET', false, 200],
  ])('If-None-Match wildcard %s', async (_name, method, exists, expectedStatus) => {
    const response = createResponse();

    await createValidatorsDispatcher(exists).dispatch(createRequest(method, { 'if-none-match': '*' }), response);

    expect(response.statusCode).toBe(expectedStatus);
  });

  it('permits If-Match wildcard for an existing resource without validators', async () => {
    const dispatcher = createDispatcher({
      conditionalRequest: {
        resolve() {
          return { exists: true };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('GET', { 'if-match': '*' }), response);

    expect(response.statusCode).toBe(200);
  });
});
