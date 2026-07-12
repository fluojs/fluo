import { Inject } from '@fluojs/core';
import { type FrameworkRequest, type FrameworkResponse, Get, UseInterceptors } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

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
});
