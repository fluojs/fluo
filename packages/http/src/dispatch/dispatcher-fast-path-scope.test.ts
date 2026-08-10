import { Inject, Scope as ScopeDecorator } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { expect, it } from 'vitest';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  getDispatcherFastPathStats,
} from '../index.js';
import type { FrameworkRequest, FrameworkResponse } from '../types.js';

type FastPathResponse = FrameworkResponse & {
  body?: unknown;
  simpleJsonBody?: Record<string, unknown> | unknown[];
  sendSimpleJson(body: Record<string, unknown> | unknown[]): void;
};

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FastPathResponse {
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
    sendSimpleJson(body) {
      this.simpleJsonBody = body;
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

it('preserves transient controller identity across fast-path requests', async () => {
  // Given: a transient controller whose response exposes its instance identity.
  let nextControllerId = 0;
  let nextDependencyId = 0;

  @ScopeDecorator('transient')
  class TransientFastPathDependency {
    readonly dependencyId = ++nextDependencyId;
  }

  @Inject(TransientFastPathDependency)
  @ScopeDecorator('transient')
  @Controller('/transient-fast-path')
  class TransientFastPathController {
    private readonly controllerId = ++nextControllerId;

    constructor(private readonly dependency: TransientFastPathDependency) {}

    @Get('/')
    getValue() {
      return {
        controllerId: this.controllerId,
        dependencyId: this.dependency.dependencyId,
      };
    }
  }

  const root = new Container().register(TransientFastPathDependency, TransientFastPathController);
  const dispatcher = createDispatcher({
    handlerMapping: createHandlerMapping([{ controllerToken: TransientFastPathController }]),
    rootContainer: root,
  });

  // When: the eligible route is dispatched twice through the same dispatcher.
  const firstResponse = createResponse();
  await dispatcher.dispatch(createRequest('/transient-fast-path'), firstResponse);
  const secondResponse = createResponse();
  await dispatcher.dispatch(createRequest('/transient-fast-path'), secondResponse);

  // Then: fast-path execution still resolves a fresh transient controller for each request.
  expect({
    executionPath: getDispatcherFastPathStats(dispatcher)?.routes[0]?.executionPath,
    responses: [firstResponse.simpleJsonBody, secondResponse.simpleJsonBody],
  }).toEqual({
    executionPath: 'fast',
    responses: [
      { controllerId: 1, dependencyId: 1 },
      { controllerId: 2, dependencyId: 2 },
    ],
  });
});
