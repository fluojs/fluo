import { describe, expect, it } from 'vitest';

import { HandlerNotFoundError } from '../errors.js';
import { matchHandlerOrThrow, updateRequestParams } from './dispatch-routing-policy.js';
import type { FrameworkRequest, HandlerDescriptor, HandlerMapping, RequestContext } from '../types.js';

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

function createRequestContext(request: FrameworkRequest): RequestContext {
  return {
    container: {
      async dispose() {
        return undefined;
      },
      resolve() {
        throw new Error('not used');
      },
    },
    metadata: {},
    request,
    response: {
      committed: false,
      headers: {},
      redirect() {},
      send() {},
      setHeader() {},
      setStatus() {},
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
    let queryReads = 0;
    const context = createRequestContext(
      Object.defineProperties(createRequest('/users/1', 'GET'), {
        query: {
          configurable: true,
          enumerable: true,
          get() {
            queryReads += 1;
            return {};
          },
        },
      }),
    );

    updateRequestParams(context, { id: '1' });

    expect(context.request.path).toBe('/users/1');
    expect(context.request.params).toEqual({ id: '1' });
    expect(queryReads).toBe(0);
  });

  it('shadows inherited getter-only params descriptors without reading them', () => {
    let paramsReads = 0;
    const prototype = createRequest('/users/1', 'GET');
    Object.defineProperty(prototype, 'params', {
      configurable: true,
      enumerable: true,
      get() {
        paramsReads += 1;
        return { stale: 'true' };
      },
    });
    const request = Object.create(prototype) as FrameworkRequest;
    const context = createRequestContext(request);

    updateRequestParams(context, { id: '1' });

    expect(Object.hasOwn(context.request, 'params')).toBe(true);
    expect(context.request.params).toEqual({ id: '1' });
    expect(paramsReads).toBe(0);
  });

  it('shadows inherited accessor params without invoking inherited setters', () => {
    let setterCalls = 0;
    const prototype = createRequest('/users/1', 'GET');
    Object.defineProperty(prototype, 'params', {
      configurable: true,
      enumerable: true,
      get() {
        return { stale: 'true' };
      },
      set() {
        setterCalls += 1;
      },
    });
    const request = Object.create(prototype) as FrameworkRequest;
    const context = createRequestContext(request);

    updateRequestParams(context, { id: '1' });

    expect(setterCalls).toBe(0);
    expect(Object.hasOwn(context.request, 'params')).toBe(true);
    expect(context.request.params).toEqual({ id: '1' });
  });

  it('shadows inherited non-writable params descriptors', () => {
    const prototype = createRequest('/users/1', 'GET');
    Object.defineProperty(prototype, 'params', {
      configurable: true,
      enumerable: true,
      value: { stale: 'true' },
      writable: false,
    });
    const request = Object.create(prototype) as FrameworkRequest;
    const context = createRequestContext(request);

    updateRequestParams(context, { id: '1' });

    expect(Object.hasOwn(context.request, 'params')).toBe(true);
    expect(context.request.params).toEqual({ id: '1' });
  });
});
