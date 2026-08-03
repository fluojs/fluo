import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '../index.js';
import { Controller, createDispatcher, createHandlerMapping, Get } from '../index.js';

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/finish-disposal-order',
    query: {},
    raw: {},
    url: '/finish-disposal-order',
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

class LifecycleOrderingContainer extends Container {
  constructor(private readonly events: string[]) {
    super();
  }

  override createRequestScope(): Container {
    const scope = super.createRequestScope();
    const dispose = scope.dispose.bind(scope);

    scope.dispose = async () => {
      this.events.push('dispose');
      await dispose();
    };

    return scope;
  }
}

function createFinishDisposalDispatcher(events: string[], handler: () => unknown) {
  @Controller('/finish-disposal-order')
  class FinishDisposalOrderController {
    @Get('/')
    handle() {
      return handler();
    }
  }

  const observer = {
    async onRequestFinish() {
      events.push('finish:start');
      await Promise.resolve();
      events.push('finish:end');
    },
  };
  const root = new LifecycleOrderingContainer(events).register(FinishDisposalOrderController);

  return createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: FinishDisposalOrderController }]),
    observers: [observer],
    rootContainer: root,
  });
}

describe('dispatcher lifecycle ordering', () => {
  it('completes onRequestFinish before request-scope disposal on the success path', async () => {
    // Given
    const events: string[] = [];
    const dispatcher = createFinishDisposalDispatcher(events, () => ({ ok: true }));
    const response = createResponse();

    // When
    await dispatcher.dispatch(createRequest(), response);

    // Then
    expect(response.statusCode).toBe(200);
    expect(events).toEqual(['finish:start', 'finish:end', 'dispose']);
  });

  it('completes onRequestFinish before request-scope disposal on the error path', async () => {
    // Given
    const events: string[] = [];
    const dispatcher = createFinishDisposalDispatcher(events, () => {
      throw new Error('handler failed');
    });
    const response = createResponse();

    // When
    await dispatcher.dispatch(createRequest(), response);

    // Then
    expect(response.statusCode).toBe(500);
    expect(events).toEqual(['finish:start', 'finish:end', 'dispose']);
  });
});
