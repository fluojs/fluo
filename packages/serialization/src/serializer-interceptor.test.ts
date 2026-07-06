import type {
  CallHandler,
  FrameworkResponse,
  InterceptorContext,
  RequestContext,
  RequestObserver,
} from '@fluojs/http';
import { Module } from '@fluojs/core';
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { createTestApp } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { Exclude } from './decorators/exclude.js';
import { Expose } from './decorators/expose.js';
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

  it('serializes exposed class instances through createTestApp request helpers', async () => {
    @Expose({ excludeExtraneous: true })
    class UserView {
      @Expose()
      id = 'u-1';

      @Expose()
      username = 'fluo';

      passwordHash = 'secret';
    }

    @Controller('/users')
    @UseInterceptors(SerializerInterceptor)
    class UsersController {
      @Get('/one')
      getOne() {
        return new UserView();
      }
    }

    @Module({ controllers: [UsersController], providers: [SerializerInterceptor] })
    class UsersModule {}

    const app = await createTestApp({ rootModule: UsersModule });

    try {
      const response = await app.request('GET', '/users/one').send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: 'u-1', username: 'fluo' });
    } finally {
      await app.close();
    }
  });

  it('bypasses serialization for handler-owned committed responses through createTestApp request helpers', async () => {
    @Expose({ excludeExtraneous: true })
    class StreamOwner {
      @Expose()
      id = 'stream-1';

      internalState = 'owned-by-handler';
    }

    const owner = new StreamOwner();
    let observedSuccess: unknown;
    const observer: RequestObserver = {
      onRequestSuccess(_context, value) {
        observedSuccess = value;
      },
    };

    @Controller('/streams')
    @UseInterceptors(SerializerInterceptor)
    class StreamsController {
      @Get('/owned')
      async getOwned(_input: undefined, context: RequestContext) {
        await context.response.send(owner);
        return owner;
      }
    }

    @Module({ controllers: [StreamsController], providers: [SerializerInterceptor] })
    class StreamsModule {}

    const app = await createTestApp({
      observers: [observer],
      rootModule: StreamsModule,
    });

    try {
      const response = await app.request('GET', '/streams/owned').send();

      expect(response.status).toBe(200);
      expect(response.body).toBe(owner);
      expect(observedSuccess).toBe(owner);
    } finally {
      await app.close();
    }
  });
});
