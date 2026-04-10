import { describe, expect, it } from 'vitest';

import { Container } from '@fluojs/di';

import type { FrameworkRequest, FrameworkResponse, HandlerDescriptor, HandlerMapping, Interceptor, InterceptorContext } from '../types.js';
import { createDispatcher } from './dispatcher.js';

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

function createHandlerMapping(descriptor: HandlerDescriptor): HandlerMapping {
  return {
    descriptors: [descriptor],
    match() {
      return {
        descriptor,
        params: {},
      };
    },
  };
}

describe('dispatcher success status defaults', () => {
  it('defaults POST success responses to 201', async () => {
    class UsersController {
      createUser() {
        return { created: true };
      }
    }

    const descriptor: HandlerDescriptor = {
      controllerToken: UsersController,
      metadata: {
        controllerPath: '/users',
        effectivePath: '/users',
        moduleMiddleware: [],
        pathParams: [],
      },
      methodName: 'createUser',
      route: {
        method: 'POST',
        path: '/',
      },
    };

    const root = new Container().register(UsersController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping(descriptor),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/users', 'POST'), response);

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({ created: true });
  });

  it('defaults DELETE success responses with no body to 204', async () => {
    class UsersController {
      removeUser() {}
    }

    const descriptor: HandlerDescriptor = {
      controllerToken: UsersController,
      metadata: {
        controllerPath: '/users',
        effectivePath: '/users/:id',
        moduleMiddleware: [],
        pathParams: ['id'],
      },
      methodName: 'removeUser',
      route: {
        method: 'DELETE',
        path: '/:id',
      },
    };

    const root = new Container().register(UsersController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping(descriptor),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/users/1', 'DELETE'), response);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBeUndefined();
  });

  it('defaults OPTIONS success responses with no body to 204', async () => {
    class UsersController {
      describeUsers() {}
    }

    const descriptor: HandlerDescriptor = {
      controllerToken: UsersController,
      metadata: {
        controllerPath: '/users',
        effectivePath: '/users',
        moduleMiddleware: [],
        pathParams: [],
      },
      methodName: 'describeUsers',
      route: {
        method: 'OPTIONS',
        path: '/',
      },
    };

    const root = new Container().register(UsersController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping(descriptor),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/users', 'OPTIONS'), response);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBeUndefined();
  });

  it('keeps HttpCode as an override over method defaults', async () => {
    class UsersController {
      createUser() {
        return { accepted: true };
      }
    }

    const descriptor: HandlerDescriptor = {
      controllerToken: UsersController,
      metadata: {
        controllerPath: '/users',
        effectivePath: '/users',
        moduleMiddleware: [],
        pathParams: [],
      },
      methodName: 'createUser',
      route: {
        method: 'POST',
        path: '/',
        successStatus: 202,
      },
    };

    const root = new Container().register(UsersController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping(descriptor),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/users', 'POST'), response);

    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({ accepted: true });
  });

  it('uses the final interceptor result when choosing default status', async () => {
    class UndefinedToValueInterceptor implements Interceptor {
      async intercept(_context: InterceptorContext, next: { handle(): Promise<unknown> }) {
        await next.handle();
        return { restored: true };
      }
    }

    class UsersController {
      removeUser() {}
    }

    const descriptor: HandlerDescriptor = {
      controllerToken: UsersController,
      metadata: {
        controllerPath: '/users',
        effectivePath: '/users/:id',
        moduleMiddleware: [],
        pathParams: ['id'],
      },
      methodName: 'removeUser',
      route: {
        interceptors: [UndefinedToValueInterceptor],
        method: 'DELETE',
        path: '/:id',
      },
    };

    const root = new Container().register(UsersController, UndefinedToValueInterceptor);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping(descriptor),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/users/1', 'DELETE'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ restored: true });
  });
});
