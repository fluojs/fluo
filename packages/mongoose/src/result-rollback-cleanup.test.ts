import { describe, expect, it, vi } from 'vitest';
import { AfterCommitError, MongooseConnection, TransactionRollbackOnlyError } from './index.js';

// Protocol double for these deterministic native-runner fixtures. Real driver
// confirmation is exercised by rollback-observer tests and the PostgreSQL/Mongo fixture.
const observerDouble = {
  run: <T>(callback: () => Promise<T>): Promise<T> => callback(),
  beginAttempt: () => ({ confirmRollback: () => true as const }),
};

function fixture() {
  const events: string[] = [];
  const session = {
    startTransaction: vi.fn(() => { events.push('start'); }),
    commitTransaction: vi.fn(() => { events.push('commit'); }),
    abortTransaction: vi.fn(() => { events.push('abort'); }),
    endSession: vi.fn(() => { events.push('end'); }),
  };
  const conn = new MongooseConnection({ startSession: async () => session }, () => { events.push('dispose'); }, { strictTransactions: false, rollbackObserver: observerDouble });
  return { conn, events, session };
}

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe.each(['transaction', 'requestTransaction'] as const)('Mongoose manual %s rollback cleanup', (entry) => {
  it('does not return a rejected Result when abortTransaction fails', async () => {
    // Given
    const { conn, events, session } = fixture();
    const failure = { accepted: false };
    const abortError = new Error('abort failed');
    session.abortTransaction.mockImplementation(() => { throw abortError; });
    const callback = async () => {
      conn.afterCommit(() => { events.push('hook'); });
      return failure;
    };
    const policy = { shouldRollback: () => true };
    // When
    const transaction = entry === 'transaction'
      ? conn.transaction(callback, policy)
      : conn.requestTransaction(callback, undefined, policy);
    // Then
    await expect(transaction).rejects.toBeInstanceOf(AggregateError);
    await expect(transaction).rejects.toMatchObject({
      errors: [expect.objectContaining({ result: failure }), abortError],
    });
    expect(events).toEqual(['start', 'end']);
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });

  it('does not return a rejected Result when endSession fails after rollback', async () => {
    // Given
    const { conn, events, session } = fixture();
    const failure = { accepted: false };
    const cleanupError = new Error('end failed');
    session.endSession.mockImplementation(() => { throw cleanupError; });
    const policy = { shouldRollback: () => true };
    const callback = async () => failure;
    // When
    const transaction = entry === 'transaction'
      ? conn.transaction(callback, policy)
      : conn.requestTransaction(callback, undefined, policy);
    // Then
    await expect(transaction).rejects.toMatchObject({
      errors: [expect.objectContaining({ result: failure }), cleanupError],
    });
    expect(events).toEqual(['start', 'abort']);
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });

  it('retains both native abort and cleanup errors when a nested policy owns the failure', async () => {
    // Given
    const { conn, session } = fixture();
    const failure = { accepted: false };
    const abortError = new Error('abort failed');
    const cleanupError = new Error('end failed');
    session.abortTransaction.mockImplementation(() => { throw abortError; });
    session.endSession.mockImplementation(() => { throw cleanupError; });
    const callback = async () => {
      await conn.requestTransaction(async () => failure, undefined, { shouldRollback: () => true });
      return 'accepted';
    };
    // When
    const transaction = entry === 'transaction' ? conn.transaction(callback) : conn.requestTransaction(callback);
    // Then
    await expect(transaction).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ errors: [expect.objectContaining({ result: failure }), abortError] }),
        cleanupError,
      ],
    });
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });

  it('preserves native commit failure identity when the predicate accepts the result', async () => {
    // Given
    const { conn, events, session } = fixture();
    const commitError = new Error('commit failed');
    session.commitTransaction.mockImplementation(() => { throw commitError; });
    const callback = async () => {
      conn.afterCommit(() => { events.push('hook'); });
      return 42;
    };
    const policy = { shouldRollback: () => false };
    // When
    const transaction = entry === 'transaction'
      ? conn.transaction(callback, policy)
      : conn.requestTransaction(callback, undefined, policy);
    // Then
    await expect(transaction).rejects.toBe(commitError);
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it('preserves ordinary callback failure when legacy abort cleanup also fails', async () => {
    // Given
    const { conn, events, session } = fixture();
    const callbackError = new Error('callback failed');
    session.abortTransaction.mockImplementation(() => { throw new Error('legacy abort failed'); });
    const callback = async () => { throw callbackError; };
    // When
    const transaction = entry === 'transaction' ? conn.transaction(callback) : conn.requestTransaction(callback);
    // Then
    await expect(transaction).rejects.toBe(callbackError);
    expect(events).toEqual(['start', 'end']);
  });

  it('does not treat postcommit hook rejection as a Result rollback signal', async () => {
    // Given
    const { conn, events, session } = fixture();
    const hookError = new TransactionRollbackOnlyError('unrelated failure');
    const callback = async () => {
      conn.afterCommit(() => { throw hookError; });
      conn.afterCommit(() => { events.push('remaining-hook'); });
      return 42;
    };
    const policy = { shouldRollback: () => false };
    // When
    const transaction = entry === 'transaction'
      ? conn.transaction(callback, policy)
      : conn.requestTransaction(callback, undefined, policy);
    // Then
    await expect(transaction).rejects.toBeInstanceOf(AfterCommitError);
    await expect(transaction).rejects.toMatchObject({ committed: true, errors: [hookError] });
    expect(events).toEqual(['start', 'commit', 'end', 'remaining-hook']);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });
});

describe('Mongoose Result rollback lifecycle', () => {
  it('waits for rollback and session cleanup before returning the same root value or disposing', async () => {
    // Given
    const { conn, events, session } = fixture();
    const aborting = barrier();
    const releaseAbort = barrier();
    const ending = barrier();
    const releaseEnd = barrier();
    session.abortTransaction.mockImplementation(async () => {
      events.push('abort:start');
      aborting.release();
      await releaseAbort.promise;
      events.push('abort:done');
    });
    session.endSession.mockImplementation(async () => {
      events.push('end:start');
      ending.release();
      await releaseEnd.promise;
      events.push('end:done');
    });
    const failure = { accepted: false };
    let returned = false;
    // When
    const transaction = conn.transaction(async () => failure, { shouldRollback: () => true }).then((value) => {
      returned = true;
      return value;
    });
    await aborting.promise;
    const shutdown = conn.onApplicationShutdown();
    expect(returned).toBe(false);
    expect(events).toEqual(['start', 'abort:start']);
    releaseAbort.release();
    await ending.promise;
    expect(returned).toBe(false);
    expect(events).toEqual(['start', 'abort:start', 'abort:done', 'end:start']);
    releaseEnd.release();
    // Then
    await expect(transaction).resolves.toBe(failure);
    await shutdown;
    expect(events).toEqual(['start', 'abort:start', 'abort:done', 'end:start', 'end:done', 'dispose']);
  });
});
