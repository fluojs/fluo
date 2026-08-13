import { Container } from '@fluojs/di';
import { IsString, MinLength } from '@fluojs/validation';
import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  FromBody,
  Query,
  RequestDto,
  Route,
} from '../index.js';
import type { FrameworkRequest, FrameworkResponse } from '../types.js';

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
  };
}

function createRequest(method: string, path: string, body: unknown): FrameworkRequest {
  return {
    body,
    cookies: {},
    headers: { 'x-request-id': `request-${method.toLowerCase()}` },
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('custom HTTP route method dispatch', () => {
  it.each([
    { method: 'query', path: '/operations/query', result: 'query' },
    { method: 'PURGE', path: '/operations/purge', result: 'purge' },
  ])('binds and validates DTO bodies for $method with default 200 semantics', async ({ method, path, result }) => {
    class OperationRequest {
      @FromBody('value')
      @IsString()
      @MinLength(1, { code: 'VALUE_REQUIRED', message: 'value is required' })
      value = '';
    }

    @Controller('/operations')
    class OperationsController {
      @RequestDto(OperationRequest)
      @Query('/query')
      query(input: OperationRequest) {
        return { method: 'query', value: input.value };
      }

      @RequestDto(OperationRequest)
      @Route('purge', '/purge')
      purge(input: OperationRequest) {
        return { method: 'purge', value: input.value };
      }
    }

    const root = new Container().register(OperationsController);
    const mapping = createHandlerMapping([{ controllerToken: OperationsController }]);
    const dispatcher = createDispatcher({ handlerMapping: mapping, rootContainer: root });
    const response = createResponse();

    await dispatcher.dispatch(createRequest(method, path, { value: 'cache-key' }), response);

    expect(mapping.descriptors.map((descriptor) => descriptor.route.method)).toEqual(['QUERY', 'PURGE']);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ method: result, value: 'cache-key' });
  });

  it.each([
    { method: 'QUERY', path: '/operations/query' },
    { method: 'PURGE', path: '/operations/purge' },
  ])('returns canonical validation errors for invalid $method DTO bodies', async ({ method, path }) => {
    class OperationRequest {
      @FromBody('value')
      @IsString()
      @MinLength(1, { code: 'VALUE_REQUIRED', message: 'value is required' })
      value = '';
    }

    @Controller('/operations')
    class OperationsController {
      @RequestDto(OperationRequest)
      @Query('/query')
      query(input: OperationRequest) {
        return input;
      }

      @RequestDto(OperationRequest)
      @Route('PURGE', '/purge')
      purge(input: OperationRequest) {
        return input;
      }
    }

    const root = new Container().register(OperationsController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: OperationsController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest(method, path, { value: '' }), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [{
          code: 'VALUE_REQUIRED',
          field: 'value',
          message: 'value is required',
          source: 'body',
        }],
        message: 'Validation failed.',
        meta: undefined,
        requestId: `request-${method.toLowerCase()}`,
        status: 400,
      },
    });
  });
});
