import { Container } from '@fluojs/di';
import { expect, it } from 'vitest';
import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  getDispatcherFastPathStats,
} from '../index.js';
import type {
  CallHandler,
  FrameworkRequest,
  FrameworkResponse,
  InterceptorContext,
} from '../types.js';

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

it('preserves a full-path dispatcher decision when another dispatcher shares its handler mapping', async () => {
  // Given: a full-path dispatcher created before a fast-path dispatcher from the same mapping.
  const events: string[] = [];

  class GlobalInterceptor {
    async intercept(_context: InterceptorContext, next: CallHandler) {
      events.push('interceptor:before');
      const result = await next.handle();
      events.push('interceptor:after');
      return result;
    }
  }

  @Controller('/shared-full-path')
  class SharedFullPathController {
    @Get('/')
    getValue() {
      events.push('handler');
      return { ok: true };
    }
  }

  const root = new Container().register(GlobalInterceptor, SharedFullPathController);
  const handlerMapping = createHandlerMapping([{ controllerToken: SharedFullPathController }]);
  const fullPathDispatcher = createDispatcher({
    fastPathDebugHeaders: true,
    handlerMapping,
    interceptors: [GlobalInterceptor],
    rootContainer: root,
  });
  createDispatcher({ handlerMapping, rootContainer: root });

  // When: the earlier dispatcher handles its route after the later dispatcher is configured.
  const response = createResponse();
  await fullPathDispatcher.dispatch(createRequest('/shared-full-path'), response);

  // Then: its own interceptor and full-path eligibility remain authoritative.
  expect({
    events,
    executionPath: getDispatcherFastPathStats(fullPathDispatcher)?.routes[0]?.executionPath,
    pathHeader: response.headers['X-Fluo-Path'],
  }).toEqual({
    events: ['interceptor:before', 'handler', 'interceptor:after'],
    executionPath: 'full',
    pathHeader: 'full; route=GET:/shared-full-path; reason=Full path required due to: interceptors',
  });
});

it('preserves a fast-path dispatcher decision when another dispatcher shares its handler mapping', async () => {
  // Given: a fast-path dispatcher created before a full-path dispatcher from the same mapping.
  class GlobalInterceptor {
    async intercept(_context: InterceptorContext, next: CallHandler) {
      return next.handle();
    }
  }

  @Controller('/shared-fast-path')
  class SharedFastPathController {
    @Get('/')
    getValue() {
      return { ok: true };
    }
  }

  const root = new Container().register(GlobalInterceptor, SharedFastPathController);
  const handlerMapping = createHandlerMapping([{ controllerToken: SharedFastPathController }]);
  const fastPathDispatcher = createDispatcher({
    fastPathDebugHeaders: true,
    handlerMapping,
    rootContainer: root,
  });
  createDispatcher({
    handlerMapping,
    interceptors: [GlobalInterceptor],
    rootContainer: root,
  });

  // When: the earlier dispatcher handles its route after the later dispatcher is configured.
  const response = createResponse();
  await fastPathDispatcher.dispatch(createRequest('/shared-fast-path'), response);

  // Then: the request still uses the earlier dispatcher's fast execution path.
  expect({
    body: response.body,
    executionPath: getDispatcherFastPathStats(fastPathDispatcher)?.routes[0]?.executionPath,
    pathHeader: response.headers['X-Fluo-Path'],
    simpleJsonBody: response.simpleJsonBody,
  }).toEqual({
    body: undefined,
    executionPath: 'fast',
    pathHeader: 'fast; route=GET:/shared-fast-path',
    simpleJsonBody: { ok: true },
  });
});
