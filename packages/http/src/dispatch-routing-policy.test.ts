import { describe, expect, it } from 'vitest';

import { HandlerNotFoundError } from './errors.js';
import { matchHandlerOrThrow, updateRequestParams } from './dispatch-routing-policy.js';
import type { FrameworkRequest, HandlerDescriptor, HandlerMapping, RequestContext } from './types.js';

function createRequest(path: string, method: FrameworkRequest['method']): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createDescriptor(): HandlerDescriptor {
  class ExampleController {
    list() {
      return { ok: true };
    }
  }

  return {
    controllerToken: ExampleController,
    metadata: {
      controllerPath: '/users',
      effectivePath: '/users/:id',
      moduleMiddleware: [],
      pathParams: ['id'],
    },
    methodName: 'list',
    route: {
      method: 'GET',
      path: '/users/:id',
    },
  };
}

describe('dispatch routing policy', () => {
  it('returns the matched handler descriptor and params', () => {
    const descriptor = createDescriptor();
    const mapping: HandlerMapping = {
      descriptors: [descriptor],
      match() {
        return {
          descriptor,
          params: { id: '42' },
        };
      },
    };

    const match = matchHandlerOrThrow(mapping, createRequest('/users/42', 'GET'));

    expect(match.descriptor).toBe(descriptor);
    expect(match.params).toEqual({ id: '42' });
  });

  it('throws HandlerNotFoundError when no route matches', () => {
    const mapping: HandlerMapping = {
      descriptors: [],
      match() {
        return undefined;
      },
    };

    expect(() => matchHandlerOrThrow(mapping, createRequest('/missing', 'GET'))).toThrow(HandlerNotFoundError);
  });

  it('updates request params in request context without mutating unrelated fields', () => {
    const context: RequestContext = {
      container: {
        async dispose() {},
        resolve() {
          throw new Error('not used');
        },
      },
      metadata: {},
      request: createRequest('/users/1', 'GET'),
      response: {
        committed: false,
        headers: {},
        redirect() {},
        send() {},
        setHeader() {},
        setStatus() {},
      },
    };

    updateRequestParams(context, { id: '1' });

    expect(context.request.path).toBe('/users/1');
    expect(context.request.params).toEqual({ id: '1' });
  });
});
