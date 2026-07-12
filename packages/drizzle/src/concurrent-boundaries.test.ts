import { describe, expect, it } from 'vitest';
import { DrizzleDatabase } from './index.js';

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  if (!resolvePromise) {
    throw new Error('Deferred promise resolver was not initialized.');
  }

  return { promise, resolve: resolvePromise };
}

describe('Drizzle concurrent transaction boundaries', () => {
  it('isolates overlapping request handles and drains the remaining boundary before dispose', async () => {
    // Given two independently controlled transaction handles and a delayed rollback.
    const events: string[] = [];
    const firstEntered = createDeferred();
    const secondEntered = createDeferred();
    const firstRelease = createDeferred();
    const inspectSecond = createDeferred();
    const secondInspected = createDeferred();
    const secondRelease = createDeferred();
    const rollbackPending = createDeferred();
    const rollbackRelease = createDeferred();
    const firstTransactionDatabase = { id: 'first' as const };
    const secondTransactionDatabase = { id: 'second' as const };
    type TransactionDatabase = typeof firstTransactionDatabase | typeof secondTransactionDatabase;
    let transactionCalls = 0;
    const database = {
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        const transactionDatabase =
          transactionCalls === 1 ? firstTransactionDatabase : secondTransactionDatabase;
        events.push(`${transactionDatabase.id}:start`);

        try {
          const result = await callback(transactionDatabase);
          events.push(`${transactionDatabase.id}:commit`);
          return result;
        } catch (error) {
          events.push(`${transactionDatabase.id}:rollback:pending`);
          rollbackPending.resolve();
          await rollbackRelease.promise;
          events.push(`${transactionDatabase.id}:rollback:done`);
          throw error;
        } finally {
          events.push(`${transactionDatabase.id}:end`);
        }
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, TransactionDatabase>(
      database,
      () => {
        events.push('dispose');
      },
    );

    // When two request transactions overlap, the first settles, and shutdown aborts the second.
    const firstTransaction = drizzle.requestTransaction(async () => {
      expect(drizzle.current()).toBe(firstTransactionDatabase);
      firstEntered.resolve();
      await firstRelease.promise;
      expect(drizzle.current()).toBe(firstTransactionDatabase);
      return 'first-complete';
    });
    await firstEntered.promise;

    const secondTransaction = drizzle.requestTransaction(async () => {
      expect(drizzle.current()).toBe(secondTransactionDatabase);
      secondEntered.resolve();
      await inspectSecond.promise;
      expect(drizzle.current()).toBe(secondTransactionDatabase);
      secondInspected.resolve();
      await secondRelease.promise;
      return 'second-complete';
    });
    await secondEntered.promise;
    let shutdown: Promise<void> | undefined;

    try {
      // Then each ALS continuation keeps its own handle and status moves from 2 to 1.
      expect(drizzle.current()).toBe(database);
      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(2);

      firstRelease.resolve();
      await expect(firstTransaction).resolves.toBe('first-complete');
      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(1);

      inspectSecond.resolve();
      await secondInspected.promise;

      shutdown = drizzle.onApplicationShutdown();
      await rollbackPending.promise;
      expect(events).not.toContain('dispose');

      rollbackRelease.resolve();
      await expect(secondTransaction).rejects.toThrow(
        'Application shutdown interrupted an open request transaction.',
      );
      await shutdown;

      // And the final status is 0 only after rollback settles, before disposal completes.
      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(0);
      expect(transactionCalls).toBe(2);
      expect(events).toEqual([
        'first:start',
        'second:start',
        'first:commit',
        'first:end',
        'second:rollback:pending',
        'second:rollback:done',
        'second:end',
        'dispose',
      ]);
    } finally {
      firstRelease.resolve();
      inspectSecond.resolve();
      secondRelease.resolve();
      rollbackRelease.resolve();
      await Promise.allSettled([
        firstTransaction,
        secondTransaction,
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });
});
