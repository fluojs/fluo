import { describe, expect, it } from 'vitest';

import {
  Controller,
  createDispatcher,
  createHandlerMapping,
  Get,
  UseInterceptors,
} from '@fluojs/http';
import type { CallHandler, FrameworkRequest, FrameworkResponse, InterceptorContext, RequestContext } from '@fluojs/http';

import { Exclude } from './decorators/exclude.js';
import { SerializerInterceptor } from './serializer-interceptor.js';

function createInterceptorContext(response: Partial<FrameworkResponse> = {}): InterceptorContext {
  return {
    requestContext: {
      response: {
        committed: false,
        headers: {},
        redirect() {},
        send() {},
        setHeader() {},
        setStatus() {},
        ...response,
      } as FrameworkResponse,
    } as RequestContext,
  } as InterceptorContext;
}

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

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
    },
    statusCode: undefined,
  };
}

function createTestContainer() {
  return {
    createRequestScope() {
      return this;
    },
    async dispose() {
      return undefined;
    },
    hasRequestScopedDependency() {
      return false;
    },
    async resolve<T>(token: new (...args: never[]) => T): Promise<T> {
      return new token();
    },
  };
}

describe('SerializerInterceptor', () => {
  it('serializes class instance responses with metadata', async () => {
    class UserView {
      id: string;

      @Exclude()
      password: string;

      constructor(id: string, password: string) {
        this.id = id;
        this.password = password;
      }
    }

    const interceptor = new SerializerInterceptor();
    const context = createInterceptorContext();
    const next: CallHandler = {
      async handle() {
        return new UserView('u-1', 'secret');
      },
    };

    await expect(interceptor.intercept(context, next)).resolves.toEqual({ id: 'u-1' });
  });

  it('serializes array responses recursively', async () => {
    class UserView {
      id: string;

      @Exclude()
      password: string;

      constructor(id: string, password: string) {
        this.id = id;
        this.password = password;
      }
    }

    const interceptor = new SerializerInterceptor();
    const context = createInterceptorContext();
    const next: CallHandler = {
      async handle() {
        return [new UserView('u-1', 'secret-1'), new UserView('u-2', 'secret-2')];
      },
    };

    await expect(interceptor.intercept(context, next)).resolves.toEqual([{ id: 'u-1' }, { id: 'u-2' }]);
  });

  it('preserves handler-owned responses once the response is committed', async () => {
    class StreamOwner {
      id = 'stream-1';

      @Exclude()
      internalState = 'owned-by-handler';
    }

    const owner = new StreamOwner();
    const interceptor = new SerializerInterceptor();
    const context = createInterceptorContext();
    const next: CallHandler = {
      async handle() {
        context.requestContext.response.committed = true;
        return owner;
      },
    };

    await expect(interceptor.intercept(context, next)).resolves.toBe(owner);
  });

  it('serializes responses through the real HTTP request pipeline', async () => {
    class UserView {
      id = 'u-1';

      @Exclude()
      password = 'secret';
    }

    @Controller('/users')
    @UseInterceptors(SerializerInterceptor)
    class UsersController {
      @Get('/one')
      getOne() {
        return new UserView();
      }
    }

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: UsersController }]),
      rootContainer: createTestContainer() as never,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/users/one'), response);

    expect(response.body).toEqual({ id: 'u-1' });
  });
});
