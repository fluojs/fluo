import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse, RequestContext } from '../types.js';
import { Controller, createDispatcher, createHandlerMapping, Get } from '../index.js';

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

function createRequest(isAborted: () => boolean): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    isAborted,
    method: 'GET',
    params: {},
    path: '/native-fast/123',
    query: {},
    raw: {},
    url: '/native-fast/123',
  };
}

describe('dispatcher native fast path', () => {
  it('does not repeat the initial abort probe before native fast-path execution', async () => {
    let abortProbeCount = 0;

    @Controller('/native-fast')
    class NativeFastController {
      @Get('/:id')
      getById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id };
      }
    }

    const root = new Container().register(NativeFastController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: NativeFastController }]),
      rootContainer: root,
    });
    const descriptor = dispatcher.describeRoutes?.()[0];

    if (!descriptor || !dispatcher.dispatchNativeRoute) {
      throw new Error('Expected native route dispatch support.');
    }

    const request = createRequest(() => {
      abortProbeCount += 1;
      return false;
    });
    const response = createResponse();

    await dispatcher.dispatchNativeRoute({ descriptor, params: { id: '123' } }, request, response);

    expect(response.body).toEqual({ id: '123' });
    expect(abortProbeCount).toBe(2);
  });
});
