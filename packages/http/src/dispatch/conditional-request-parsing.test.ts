import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  type FrameworkRequest,
  type FrameworkResponse,
} from '../index.js';

function createRequest(headers: FrameworkRequest['headers'] = {}): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
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
class ParsingController {
  @Get('/resource')
  getResource() {
    return { id: 'resource' };
  }
}

function createParsingDispatcher() {
  return createDispatcher({
    conditionalRequest: {
      resolve() {
        return {
          exists: true as const,
          validators: {
            etag: { opaqueValue: 'resource,v1', strength: 'strong' as const },
            lastModified: new Date('1994-11-06T08:49:37Z'),
          },
        };
      },
    },
    handlerMapping: createHandlerMapping([{ controllerToken: ParsingController }]),
    rootContainer: new Container().register(ParsingController),
  });
}

describe('conditional request parsing', () => {
  it('parses commas inside quoted entity tags without splitting the list', async () => {
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
            validators: { etag: { opaqueValue: 'resource,v1', strength: 'strong' } },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ 'if-none-match': '"other", "resource,v1"' }), response);

    expect(response.statusCode).toBe(304);
  });

  it('ignores malformed non-HTTP dates instead of accepting ISO timestamps', async () => {
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
            validators: { lastModified: new Date('2026-01-01T00:00:00Z') },
          };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: ValidatorsController }]),
      rootContainer: new Container().register(ValidatorsController),
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ 'if-modified-since': '2026-01-02T00:00:00.000Z' }), response);

    expect(response.statusCode).toBe(200);
  });

  it.each([
    'Sun, 06 Nov 1994 08:49:37 GMT',
    'Sunday, 06-Nov-94 08:49:37 GMT',
    'Sun Nov  6 08:49:37 1994',
  ])('accepts the valid HTTP-date form %s', async (header) => {
    const response = createResponse();

    await createParsingDispatcher().dispatch(createRequest({ 'if-modified-since': header }), response);

    expect(response.statusCode).toBe(304);
  });

  it.each([
    '"resource,v1", *',
    '"resource v1"',
    '"resource,v1',
  ])('ignores malformed If-None-Match %s safely', async (header) => {
    const response = createResponse();

    await createParsingDispatcher().dispatch(createRequest({ 'if-none-match': header }), response);

    expect(response.statusCode).toBe(200);
  });
});
