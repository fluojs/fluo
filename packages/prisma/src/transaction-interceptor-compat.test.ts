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

  it('forwards routed cancellation to the transaction boundary and waits for cleanup', async () => {
    // Given
    const events: string[] = [];
    let notifyHandlerStarted: () => void = () => undefined;
    let releaseHandler: () => void = () => undefined;
    let notifyHandlerFinished: () => void = () => undefined;
    let releaseTransactionCleanup: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      notifyHandlerStarted = resolve;
    });
    const handlerReleased = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handlerFinished = new Promise<void>((resolve) => {
      notifyHandlerFinished = resolve;
    });
    const transactionCleanupReleased = new Promise<void>((resolve) => {
      releaseTransactionCleanup = resolve;
    });
    const transactionClient = { source: 'transaction' } as const;
    const client = {
      source: 'root' as const,
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { signal?: AbortSignal },
      ): Promise<T> {
        events.push('transaction:start');
        const signal = options?.signal;

        if (!signal) {
          events.push('transaction:no-signal');
          return callback(transactionClient);
        }

        events.push('transaction:signal');
        const onAbort = () => {
          const reason = signal.reason;
          events.push(`transaction:abort:${reason instanceof Error ? reason.message : 'unknown'}`);
        };
        signal.addEventListener('abort', onAbort, { once: true });

        try {
          return await callback(transactionClient);
        } finally {
          signal.removeEventListener('abort', onAbort);
          events.push('transaction:cleanup:pending');
          await transactionCleanupReleased;
          events.push('transaction:cleanup:done');
        }
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

    @Inject(PrismaService)
    class CompatibilityController {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      @Get('/compat')
      @UseInterceptors(CallerProbeInterceptor, PrismaTransactionInterceptor)
      async waitForCancellation(): Promise<string> {
        events.push(`handler:start:${this.prisma.current().source}`);
        notifyHandlerStarted();
        await handlerReleased;
        events.push('handler:end');
        notifyHandlerFinished();

        return 'late-result';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CompatibilityController],
      imports: [
        PrismaModule.forRoot<typeof client, typeof transactionClient, { signal?: AbortSignal }>({ client }),
      ],
      providers: [CallerProbeInterceptor],
    });
    const app = await bootstrapApplication({ rootModule: AppModule });
    const prisma = await app.container.resolve(
      PrismaService<typeof client, typeof transactionClient, { signal?: AbortSignal }>,
    );
    const controller = new AbortController();

    try {
      const response = createResponse();
      const dispatch = app.dispatch(createRequest(controller.signal), response);
      await handlerStarted;

      // When
      controller.abort(new Error('compatibility caller cancelled'));
      await vi.waitFor(() => expect(events).toContain('transaction:cleanup:pending'));

      // Then
      expect(events).toEqual([
        'transaction:start',
        'transaction:signal',
        'handler:start:transaction',
        'transaction:abort:compatibility caller cancelled',
        'transaction:cleanup:pending',
      ]);
      expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ activeRequestTransactions: 1 });

      releaseTransactionCleanup();
      await expect(dispatch).resolves.toBeUndefined();
      await vi.waitFor(() => {
        expect(prisma.createPlatformStatusSnapshot().details).toMatchObject({ activeRequestTransactions: 0 });
      });
      expect(events).toEqual([
        'transaction:start',
        'transaction:signal',
        'handler:start:transaction',
        'transaction:abort:compatibility caller cancelled',
        'transaction:cleanup:pending',
        'transaction:cleanup:done',
        'caller:rejected:compatibility caller cancelled',
      ]);

      releaseHandler();
      await handlerFinished;
      expect(events.at(-1)).toBe('handler:end');
    } finally {
      releaseHandler();
      releaseTransactionCleanup();
      await app.close();
    }
  });
});
