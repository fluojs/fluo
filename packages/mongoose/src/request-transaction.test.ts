import { Inject } from '@fluojs/core';
import {
  type CallHandler,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  type Interceptor,
  type InterceptorContext,
  UseInterceptors,
} from '@fluojs/http';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { MongooseConnection, MongooseModule } from './index.js';
import type { MongooseSessionLike } from './types.js';

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
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

function createRequest(signal: AbortSignal): FrameworkRequest {
  return { cookies: {}, headers: {}, method: 'GET', params: {}, path: '/request', query: {}, raw: {}, signal, url: '/request' };
}

describe('application-owned Mongoose request transaction boundary', () => {
  it('wraps a routed handler in an explicit request transaction', async () => {
    const events: string[] = [];
    const session: MongooseSessionLike = {
      abortTransaction() { events.push('transaction:abort'); },
      commitTransaction() { events.push('transaction:commit'); },
      endSession() { events.push('session:end'); },
      startTransaction() { events.push('transaction:start'); },
    };
    const connection = {
      async startSession(): Promise<MongooseSessionLike> {
        events.push('session:start');
        return session;
      },
    };

    @Inject(MongooseConnection)
    class RequestTransactionBoundary implements Interceptor {
      constructor(private readonly mongoose: MongooseConnection<typeof connection>) {}

      async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
        return this.mongoose.requestTransaction(() => next.handle(), context.requestContext.request.signal);
      }
    }

    @Inject(MongooseConnection)
    class RequestController {
      constructor(private readonly mongoose: MongooseConnection<typeof connection>) {}

      @Get('/request')
      @UseInterceptors(RequestTransactionBoundary)
      hasSession(): boolean {
        events.push('handler');
        return this.mongoose.currentSession() === session;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RequestController],
      imports: [MongooseModule.forRoot({ connection })],
      providers: [RequestTransactionBoundary],
    });
    const app = await FluoFactory.create(AppModule);
    try {
      const response = createResponse();

      await app.dispatch(createRequest(new AbortController().signal), response);

      expect(response.body).toBe(true);
      expect(events).toEqual(['session:start', 'transaction:start', 'handler', 'transaction:commit', 'session:end']);
    } finally {
      await app.close();
    }
  });

  it('forwards caller cancellation and settles the explicit request transaction', async () => {
    const events: string[] = [];
    let notifyHandlerStarted: () => void = () => undefined;
    let releaseHandler: () => void = () => undefined;
    let notifySessionEnded: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      notifyHandlerStarted = resolve;
    });
    const handlerReleased = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const sessionEnded = new Promise<void>((resolve) => {
      notifySessionEnded = resolve;
    });
    const session: MongooseSessionLike = {
      abortTransaction() {
        events.push('transaction:abort');
      },
      commitTransaction() {
        events.push('transaction:commit');
      },
      endSession() {
        events.push('session:end');
        notifySessionEnded();
      },
      startTransaction() {
        events.push('transaction:start');
      },
    };
    const connection = {
      async startSession(): Promise<MongooseSessionLike> {
        events.push('session:start');
        return session;
      },
    };

    class CallerProbeInterceptor implements Interceptor {
      async intercept(_context: InterceptorContext, next: CallHandler): Promise<unknown> {
        try {
          return await next.handle();
        } catch (error) {
          events.push(error instanceof Error ? `caller:rejected:${error.message}` : 'caller:rejected:unknown');
          throw error;
        }
      }
    }

    @Inject(MongooseConnection)
    class RequestTransactionBoundary implements Interceptor {
      constructor(private readonly mongoose: MongooseConnection<typeof connection>) {}

      async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
        return this.mongoose.requestTransaction(() => next.handle(), context.requestContext.request.signal);
      }
    }

    @Inject(MongooseConnection)
    class RequestController {
      constructor(private readonly mongoose: MongooseConnection<typeof connection>) {}

      @Get('/request')
      @UseInterceptors(CallerProbeInterceptor, RequestTransactionBoundary)
      async waitForCancellation(): Promise<string> {
        events.push(`handler:start:${this.mongoose.currentSession() === session}`);
        notifyHandlerStarted();
        await handlerReleased;
        events.push('handler:end');

        return 'late-result';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RequestController],
      imports: [MongooseModule.forRoot({ connection })],
      providers: [CallerProbeInterceptor, RequestTransactionBoundary],
    });
    const app = await FluoFactory.create(AppModule);
    const mongoose = await app.container.resolve(MongooseConnection<typeof connection>);
    const controller = new AbortController();

    try {
      const response = createResponse();
      const dispatch = app.dispatch(createRequest(controller.signal), response);
      await handlerStarted;

      controller.abort(new Error('request caller cancelled'));
      expect(mongoose.createPlatformStatusSnapshot()).toMatchObject({
        details: {
          activeRequestTransactions: 1,
          activeSessions: 1,
        },
      });

      releaseHandler();
      await expect(dispatch).resolves.toBeUndefined();
      await sessionEnded;
      expect(mongoose.createPlatformStatusSnapshot()).toMatchObject({
        details: {
          activeRequestTransactions: 0,
          activeSessions: 0,
        },
      });
      expect(events).toEqual([
        'session:start',
        'transaction:start',
        'handler:start:true',
        'handler:end',
        'transaction:abort',
        'session:end',
        'caller:rejected:request caller cancelled',
      ]);
    } finally {
      releaseHandler();
      await app.close();
    }
  });
});
