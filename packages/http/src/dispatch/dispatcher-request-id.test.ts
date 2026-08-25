import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, RequestContext } from '../types.js';
import { Controller, createDispatcher, createHandlerMapping, Get } from '../index.js';

function createRequest(
  headers: FrameworkRequest['headers'],
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path: '/request-id',
    query: {},
    raw: {},
    url: '/request-id',
  };
}

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

describe('dispatcher request id extraction', () => {
  it('reads mixed-case x-request-id headers into RequestContext', async () => {
    @Controller('/request-id')
    class RequestIdController {
      @Get('/')
      read(_input: undefined, context: RequestContext) {
        return {
          requestId: context.requestId,
        };
      }
    }

    const root = new Container().register(RequestIdController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: RequestIdController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest({ 'X-REQUEST-ID': 'req-upper' }), response);

    expect(response.body).toEqual({ requestId: 'req-upper' });
  });
});
