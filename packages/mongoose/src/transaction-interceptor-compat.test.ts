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
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { MongooseConnection, MongooseModule, MongooseTransactionInterceptor } from './index.js';
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
  return { cookies: {}, headers: {}, method: 'GET', params: {}, path: '/compat', query: {}, raw: {}, signal, url: '/compat' };
}

describe('MongooseTransactionInterceptor compatibility', () => {
  it('wraps a routed handler in a request transaction when the compatibility export is used', async () => {
    // Given
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
    class CompatibilityController {
      constructor(private readonly mongoose: MongooseConnection<typeof connection>) {}

      @Get('/compat')
      @UseInterceptors(MongooseTransactionInterceptor)
      hasSession(): boolean {
        events.push('handler');
        return this.mongoose.currentSession() === session;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CompatibilityController],
      imports: [MongooseModule.forRoot({ connection })],
    });
    const app = await bootstrapApplication({ rootModule: AppModule });
    try {
      const response = createResponse();

      // When
      await app.dispatch(createRequest(new AbortController().signal), response);

      // Then
      expect(response.body).toBe(true);
      expect(events).toEqual(['session:start', 'transaction:start', 'handler', 'transaction:commit', 'session:end']);
    } finally {
      await app.close();
    }
  });

  it('rejects a cancelled routed caller and cleans up the compatibility transaction', async () => {
    // Given
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
    class CompatibilityController {
      constructor(private readonly mongoose: MongooseConnection<typeof connection>) {}

      @Get('/compat')
      @UseInterceptors(CallerProbeInterceptor, MongooseTransactionInterceptor)
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
      controllers: [CompatibilityController],
      imports: [MongooseModule.forRoot({ connection })],
      providers: [CallerProbeInterceptor],
    });
    const app = await bootstrapApplication({ rootModule: AppModule });
    const mongoose = await app.container.resolve(MongooseConnection<typeof connection>);
    const controller = new AbortController();

    try {
      const response = createResponse();
      const dispatch = app.dispatch(createRequest(controller.signal), response);
      await handlerStarted;

      // When
      controller.abort(new Error('compatibility caller cancelled'));

      // Then
      expect(events).toEqual(['session:start', 'transaction:start', 'handler:start:true']);
      expect(mongoose.createPlatformStatusSnapshot()).toMatchObject({
        details: {
          activeRequestTransactions: 1,
          activeSessions: 1,
        },
      });

      releaseHandler();
      await expect(dispatch).resolves.toBeUndefined();
      await sessionEnded;
      await vi.waitFor(() => {
        expect(mongoose.createPlatformStatusSnapshot()).toMatchObject({
          details: {
            activeRequestTransactions: 0,
            activeSessions: 0,
          },
        });
      });
      expect(events).toEqual([
        'session:start',
        'transaction:start',
        'handler:start:true',
        'handler:end',
        'transaction:abort',
        'session:end',
        'caller:rejected:compatibility caller cancelled',
      ]);
    } finally {
      releaseHandler();
      await app.close();
    }
  });
});
