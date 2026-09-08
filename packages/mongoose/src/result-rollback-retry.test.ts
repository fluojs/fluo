import { describe, expect, it } from 'vitest';
import { MongooseConnection, TransactionRollbackOnlyError } from './index.js';
import type { MongooseSessionLike } from './index.js';

// Protocol double for these deterministic native-runner fixtures. Real driver
// confirmation is exercised by rollback-observer tests and the PostgreSQL/Mongo fixture.
const observerDouble = {
  run: <T>(callback: () => Promise<T>): Promise<T> => callback(),
  beginAttempt: () => ({ confirmRollback: () => true as const }),
};

function sessionFixture(events: string[]): MongooseSessionLike {
  return {
    startTransaction() { events.push('start'); },
    commitTransaction() { events.push('commit'); },
    abortTransaction() { events.push('abort'); },
    endSession() { events.push('end'); },
  };
}

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('Mongoose delegated Result rollback attempts', () => {
  it('isolates sticky nested state and hooks from a discarded native callback attempt', async () => {
    // Given
    const events: string[] = [];
    const session = sessionFixture(events);
    const retryError = new Error('native retry');
    let attempt = 0;
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        try {
          await session.startTransaction();
          await expect(fn(session)).rejects.toBe(retryError);
          await session.abortTransaction();
          await session.startTransaction();
          const value = await fn(session);
          await session.commitTransaction();
          return value;
        } finally {
          await session.endSession();
        }
      },
    }, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    // When
    const result = await conn.transaction(async () => {
      const currentAttempt = ++attempt;
      conn.afterCommit(() => { events.push(`hook:${currentAttempt}`); });
      if (currentAttempt === 1) {
        await conn.requestTransaction(async () => 'failure', undefined, { shouldRollback: () => true });
        throw retryError;
      }
      return 'accepted';
    });
    // Then
    expect(result).toBe('accepted');
    expect(events).toEqual(['start', 'abort', 'start', 'commit', 'end', 'hook:2']);
  });

  it('recovers only the last native attempt root value after that attempt rolls back', async () => {
    // Given: the driver seam explicitly invokes another attempt after discarding the first.
    const events: string[] = [];
    const session = sessionFixture(events);
    const first = { attempt: 1 };
    const last = { attempt: 2 };
    let attempt = 0;
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        try {
          await expect(fn(session)).rejects.toBeInstanceOf(TransactionRollbackOnlyError);
          await session.abortTransaction();
          try {
            return await fn(session);
          } catch (error) {
            await session.abortTransaction();
            throw error;
          }
        } finally {
          await session.endSession();
        }
      },
    }, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    // When
    const result = await conn.transaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
      return ++attempt === 1 ? first : last;
    }, { shouldRollback: () => true });
    // Then
    expect(result).toBe(last);
    expect(events).toEqual(['abort', 'abort', 'end']);
  });

  it('does not recover a superseded root signal reported after a later attempt', async () => {
    // Given
    const events: string[] = [];
    const session = sessionFixture(events);
    let oldSignal: unknown;
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        try {
          await fn(session);
        } catch (error) {
          oldSignal = error;
        }
        await fn(session);
        throw oldSignal;
      },
    }, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    let attempt = 0;
    // When
    const transaction = conn.transaction(async () => ++attempt, { shouldRollback: (value) => value === 1 });
    // Then
    await expect(transaction).rejects.toBeInstanceOf(TransactionRollbackOnlyError);
    await expect(transaction).rejects.toMatchObject({ result: 1 });
  });

  it.each(['signal', 'shutdown'] as const)('preserves reported native cleanup errors after %s aborts an opted request', async (cancellation) => {
    // Given
    const events: string[] = [];
    const session = sessionFixture(events);
    const entered = barrier();
    const release = barrier();
    const cleanupError = new Error('native cleanup failed');
    const controller = new AbortController();
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        // This native seam reports its cleanup failure after either callback outcome.
        await fn(session).then(() => undefined, () => undefined);
        events.push('native-cleanup');
        throw cleanupError;
      },
    }, () => { events.push('dispose'); }, { strictTransactions: false, rollbackObserver: observerDouble });
    // When: only the nested request opts in; the root must still preserve native failure.
    const transaction = conn.requestTransaction(async () => {
      await conn.requestTransaction(async () => 'failure', undefined, { shouldRollback: () => true });
      entered.release();
      await release.promise;
      events.push('callback:done');
      return 'accepted';
    }, controller.signal);
    const rejected = expect(transaction).rejects.toBe(cleanupError);
    await entered.promise;
    const shutdown = cancellation === 'shutdown' ? conn.onApplicationShutdown() : undefined;
    if (cancellation === 'signal') controller.abort(new Error('cancelled'));
    expect(events).toEqual([]);
    release.release();
    // Then
    await rejected;
    await shutdown;
    expect(events).toEqual(['callback:done', 'native-cleanup', ...(shutdown ? ['dispose'] : [])]);
  });
});
