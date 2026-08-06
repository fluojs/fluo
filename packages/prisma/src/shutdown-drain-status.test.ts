import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { PrismaModule, PrismaService } from './index.js';

describe('Prisma request transaction shutdown status', () => {
  it('reports the pending request transaction until shutdown cleanup settles', async () => {
    // Given
    const events: string[] = [];
    let notifyTransactionStarted: () => void = () => undefined;
    let notifyRollbackStarted: () => void = () => undefined;
    let releaseRollback: () => void = () => undefined;
    const transactionStarted = new Promise<void>((resolve) => {
      notifyTransactionStarted = resolve;
    });
    const rollbackStarted = new Promise<void>((resolve) => {
      notifyRollbackStarted = resolve;
    });
    const rollbackReleased = new Promise<void>((resolve) => {
      releaseRollback = resolve;
    });
    const transactionClient = {};
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        notifyTransactionStarted();

        try {
          return await callback(transactionClient);
        } catch (error) {
          events.push('transaction:rollback:pending');
          notifyRollbackStarted();
          await rollbackReleased;
          events.push('transaction:rollback:done');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    class AppModule {}
    defineModule(AppModule, {
      imports: [PrismaModule.forRoot<typeof client, typeof transactionClient>({ client })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const prisma = await app.container.resolve(PrismaService<typeof client, typeof transactionClient>);
    const openTransaction = prisma.requestTransaction(async () => new Promise<never>(() => undefined));
    const openTransactionResult = expect(openTransaction).rejects.toThrow(
      'Application shutdown interrupted an open request transaction.',
    );
    let shutdown: Promise<void> | undefined;

    try {
      await transactionStarted;

      // When
      shutdown = app.close();
      await rollbackStarted;

      // Then
      expect(prisma.createPlatformStatusSnapshot()).toMatchObject({
        details: {
          activeRequestTransactions: 1,
          lifecycleState: 'shutting-down',
        },
        health: { status: 'degraded' },
        readiness: { status: 'not-ready' },
      });
      expect(events).toEqual(['connect', 'transaction:start', 'transaction:rollback:pending']);

      releaseRollback();
      await openTransactionResult;
      await shutdown;

      expect(prisma.createPlatformStatusSnapshot()).toMatchObject({
        details: {
          activeRequestTransactions: 0,
          lifecycleState: 'stopped',
        },
      });
      expect(events).toEqual([
        'connect',
        'transaction:start',
        'transaction:rollback:pending',
        'transaction:rollback:done',
        'transaction:end',
        'disconnect',
      ]);
    } finally {
      releaseRollback();
      await Promise.allSettled([openTransaction, shutdown ?? app.close()]);
    }
  });
});
