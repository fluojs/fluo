import { Inject, Module, Scope } from '@fluojs/core';
import {
  type CallHandler,
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  type GuardContext,
  Header,
  HttpCode,
  type InterceptorContext,
  type MiddlewareContext,
  type Next,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { REACT_RSC_FLIGHT_CONTENT_TYPE, createReactFlightResponse } from './rsc.js';

type TestResponse = FrameworkResponse & {
  body?: unknown;
};

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/rsc/flight',
    query: {},
    raw: {},
    url: '/rsc/flight',
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

function decodeFlightBody(body: unknown): string {
  if (!(body instanceof Uint8Array)) {
    throw new TypeError('Expected a buffered Flight byte payload.');
  }

  return new TextDecoder().decode(body);
}

describe('experimental RSC Flight response dispatch', () => {
  it('uses the ordinary fluo HTTP pipeline and request scope for Flight payload endpoints', async () => {
    const events: string[] = [];

    @Scope('request')
    class RequestMarker {
      private static nextId = 0;
      readonly id = ++RequestMarker.nextId;
    }

    class FlightMiddleware {
      async handle(context: MiddlewareContext, next: Next): Promise<void> {
        events.push('middleware');
        context.response.setHeader('x-rsc-middleware', 'ran');
        await next();
      }
    }

    class FlightGuard {
      canActivate(context: GuardContext) {
        events.push('guard');
        context.requestContext.response.setHeader('x-rsc-guard', 'allowed');
        return true;
      }
    }

    class FlightInterceptor {
      async intercept(_context: InterceptorContext, next: CallHandler) {
        events.push('interceptor:before');
        const value = await next.handle();
        events.push('interceptor:after');
        return value;
      }
    }

    @Inject(RequestMarker)
    @Scope('request')
    @UseGuards(FlightGuard)
    @UseInterceptors(FlightInterceptor)
    @Controller('/rsc')
    class FlightController {
      constructor(private readonly marker: RequestMarker) {}

      @Header('x-rsc-route', 'flight')
      @HttpCode(206)
      @Get('/flight')
      show() {
        events.push('handler');
        const encoder = new TextEncoder();
        const requestId = this.marker.id;
        const payload = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`1:{"request":${requestId}}\n`));
            controller.close();
          },
        });

        return createReactFlightResponse(payload, {
          headers: {
            'content-type': 'application/json',
            'x-rsc-entry': 'experimental',
          },
          status: 207,
        });
      }
    }

    @Module({
      controllers: [FlightController],
      middleware: [FlightMiddleware],
      providers: [RequestMarker, FlightGuard, FlightInterceptor],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: an ordinary HTTP controller returns an experimental Flight response entry.
      const firstResponse = createResponse();
      const secondResponse = createResponse();

      // When: the normal dispatcher handles two requests.
      await app.dispatch(createRequest(), firstResponse);
      await app.dispatch(createRequest(), secondResponse);

      // Then: HTTP lifecycle metadata, Flight metadata, and request scopes all remain authoritative.
      expect(firstResponse.statusCode).toBe(207);
      expect(firstResponse.headers['Content-Type']).toBe(REACT_RSC_FLIGHT_CONTENT_TYPE);
      expect(firstResponse.headers['content-type']).toBeUndefined();
      expect(firstResponse.headers['x-rsc-middleware']).toBe('ran');
      expect(firstResponse.headers['x-rsc-guard']).toBe('allowed');
      expect(firstResponse.headers['x-rsc-route']).toBe('flight');
      expect(firstResponse.headers['x-rsc-entry']).toBe('experimental');
      expect(decodeFlightBody(firstResponse.body)).toBe('1:{"request":1}\n');
      expect(decodeFlightBody(secondResponse.body)).toBe('1:{"request":2}\n');
      expect(events).toEqual([
        'middleware',
        'guard',
        'interceptor:before',
        'handler',
        'interceptor:after',
        'middleware',
        'guard',
        'interceptor:before',
        'handler',
        'interceptor:after',
      ]);
    } finally {
      await app.close();
    }
  });
});
