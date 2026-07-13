import { Module, Scope } from '@fluojs/core';
import {
  type CallHandler,
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  type GuardContext,
  type InterceptorContext,
  type MiddlewareContext,
  type Next,
  Post,
  type RequestContext,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  createReactServerFunctionRegistry,
  REACT_SERVER_FUNCTION_REQUEST_HEADER,
  type ReactServerFunctionReference,
  type ReactServerFunctionValue,
} from './rsc.js';

type TestResponse = FrameworkResponse & { body?: unknown };

const encoder = new TextEncoder();
const secret = new Uint8Array(32).fill(7);

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createRequest(
  reference: ReactServerFunctionReference,
  args: readonly ReactServerFunctionValue[],
  authorization = 'Bearer allowed',
): FrameworkRequest {
  const body = { action: reference.value, args };
  return {
    body,
    cookies: {},
    headers: {
      authorization,
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      [REACT_SERVER_FUNCTION_REQUEST_HEADER]: '1',
    },
    method: 'POST',
    params: {},
    path: '/_fluo/actions',
    query: {},
    raw: {},
    rawBody: encoder.encode(JSON.stringify(body)),
    url: '/_fluo/actions',
  };
}

function createResponse(): TestResponse {
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
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

describe('experimental React Server Function dispatch', () => {
  it('runs authorized calls through middleware, guards, interceptors, and isolated request scopes', async () => {
    // Given: a signed action registry is mounted on an ordinary guarded fluo POST route.
    const events: string[] = [];
    let nextRequestId = 0;

    @Scope('request')
    class RequestMarker {
      readonly id = ++nextRequestId;
    }

    class ActionMiddleware {
      async handle(context: MiddlewareContext, next: Next): Promise<void> {
        events.push('middleware');
        context.response.setHeader('x-action-middleware', 'ran');
        await next();
      }
    }

    class ActionGuard {
      canActivate(context: GuardContext) {
        events.push('guard');
        return context.requestContext.request.headers.authorization === 'Bearer allowed';
      }
    }

    class ActionInterceptor {
      async intercept(_context: InterceptorContext, next: CallHandler) {
        events.push('interceptor:before');
        const result = await next.handle();
        events.push('interceptor:after');
        return result;
      }
    }

    const firstActionStarted = createDeferred();
    const secondActionStarted = createDeferred();
    const releaseFirstAction = createDeferred();
    const registry = createReactServerFunctionRegistry({
      actions: {
        async updateProfile(args, context) {
          events.push('action');
          const marker = await context.container.resolve(RequestMarker);
          const label = args[0];
          if (typeof label !== 'string') {
            return 'invalid-label';
          }
          if (label === 'first') {
            firstActionStarted.resolve();
            await releaseFirstAction.promise;
          }
          if (label === 'second') {
            secondActionStarted.resolve();
          }
          return { label, requestId: marker.id };
        },
      },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const reference = await registry.createReference('updateProfile');

    @UseGuards(ActionGuard)
    @UseInterceptors(ActionInterceptor)
    @Controller('/_fluo')
    class ActionController {
      @Post('/actions')
      invoke(_input: undefined, context: RequestContext) {
        return registry.invoke(context);
      }
    }

    @Module({
      controllers: [ActionController],
      middleware: [ActionMiddleware],
      providers: [ActionGuard, ActionInterceptor, RequestMarker],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: two authorized calls overlap in the existing HTTP dispatcher.
      const firstResponse = createResponse();
      const firstDispatch = app.dispatch(createRequest(reference, ['first']), firstResponse);
      await firstActionStarted.promise;
      const secondResponse = createResponse();
      const secondDispatch = app.dispatch(createRequest(reference, ['second']), secondResponse);
      await secondActionStarted.promise;
      releaseFirstAction.resolve();
      await Promise.all([firstDispatch, secondDispatch]);

      // Then: the full lifecycle runs and each action sees a distinct request-scoped provider.
      expect(firstResponse.statusCode).toBe(201);
      expect(firstResponse.headers['x-action-middleware']).toBe('ran');
      expect(firstResponse.body).toEqual({ result: { label: 'first', requestId: 1 } });
      expect(secondResponse.body).toEqual({ result: { label: 'second', requestId: 2 } });
      expect(events.filter((event) => event === 'middleware')).toHaveLength(2);
      expect(events.filter((event) => event === 'guard')).toHaveLength(2);
      expect(events.filter((event) => event === 'interceptor:before')).toHaveLength(2);
      expect(events.filter((event) => event === 'action')).toHaveLength(2);
      expect(events.filter((event) => event === 'interceptor:after')).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('rejects an unauthorized call through existing guard HTTP semantics', async () => {
    // Given: an action endpoint whose guard rejects the request.
    let invocationCount = 0;
    class DenyGuard {
      canActivate() {
        return false;
      }
    }
    const registry = createReactServerFunctionRegistry({
      actions: {
        mutate() {
          invocationCount += 1;
          return { updated: true };
        },
      },
      allowedOrigins: ['https://app.example.com'],
      crypto: globalThis.crypto,
      secret,
    });
    const reference = await registry.createReference('mutate');

    @UseGuards(DenyGuard)
    @Controller('/_fluo')
    class ActionController {
      @Post('/actions')
      invoke(_input: undefined, context: RequestContext) {
        return registry.invoke(context);
      }
    }

    @Module({ controllers: [ActionController], providers: [DenyGuard] })
    class AppModule {}
    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const response = createResponse();

      // When: the dispatcher receives the action call.
      await app.dispatch(createRequest(reference, []), response);

      // Then: guard rejection uses the normal 403 envelope and never invokes the action.
      expect(response.statusCode).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN', status: 403 } });
      expect(invocationCount).toBe(0);
    } finally {
      await app.close();
    }
  });
});
