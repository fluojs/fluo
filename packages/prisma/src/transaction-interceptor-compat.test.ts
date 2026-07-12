import { Inject } from '@fluojs/core';
import { type FrameworkRequest, type FrameworkResponse, Get, UseInterceptors } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { PrismaModule, PrismaService, PrismaTransactionInterceptor } from './index.js';

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

describe('PrismaTransactionInterceptor compatibility', () => {
  it('wraps a routed handler in a request transaction when the compatibility export is used', async () => {
    // Given
    const events: string[] = [];
    const transactionClient = { source: 'transaction' } as const;
    const client = {
      source: 'root' as const,
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:end');
        return result;
      },
    };

    @Inject(PrismaService)
    class CompatibilityController {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      @Get('/compat')
      @UseInterceptors(PrismaTransactionInterceptor)
      readSource(): string {
        events.push('handler');
        return this.prisma.current().source;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CompatibilityController],
      imports: [PrismaModule.forRoot<typeof client, typeof transactionClient>({ client })],
    });
    const app = await bootstrapApplication({ rootModule: AppModule });
    try {
      const response = createResponse();

      // When
      await app.dispatch(createRequest(new AbortController().signal), response);

      // Then
      expect(response.body).toBe('transaction');
      expect(events).toEqual(['transaction:start', 'handler', 'transaction:end']);
    } finally {
      await app.close();
    }
  });
});
