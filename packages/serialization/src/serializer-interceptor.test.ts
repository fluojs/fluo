import { describe, expect, it } from 'vitest';

import type { CallHandler, FrameworkResponse, InterceptorContext, RequestContext } from '@fluojs/http';

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
});
