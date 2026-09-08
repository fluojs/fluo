import { describe, expect, it, vi } from 'vitest';
import {
  MongooseConnection,
  TransactionRollbackCapabilityError,
  TransactionRollbackOnlyError,
} from './index.js';
import type { MongooseConnectionLike, MongooseSessionLike } from './index.js';

// Protocol double for these deterministic native-runner fixtures. Real driver
// confirmation is exercised by rollback-observer tests and the PostgreSQL/Mongo fixture.
const observerDouble = {
  run: <T>(callback: () => Promise<T>): Promise<T> => callback(),
  beginAttempt: () => ({ confirmRollback: () => true as const }),
};

function fixture(mode: 'manual' | 'delegated') {
  const events: string[] = [];
  const session: MongooseSessionLike = {
    startTransaction() { events.push('start'); },
    commitTransaction() { events.push('commit'); },
    abortTransaction() { events.push('abort'); },
    endSession() { events.push('end'); },
  };
  const root: MongooseConnectionLike = mode === 'manual'
    ? { startSession: async () => session }
    : {
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        try {
          await session.startTransaction();
          const value = await fn(session);
          await session.commitTransaction();
          return value;
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          await session.endSession();
        }
      },
    };
  return { conn: new MongooseConnection(root, undefined, { strictTransactions: false, rollbackObserver: observerDouble }), events };
}

describe.each(['manual', 'delegated'] as const)('Mongoose %s Result rollback', (mode) => {
  it.each(['transaction', 'requestTransaction'] as const)('returns the same rejected root from %s after rollback', async (entry) => {
    // Given
    const { conn, events } = fixture(mode);
    const failure = { accepted: false };
    const policy = { shouldRollback: (value: typeof failure) => !value.accepted };
    const callback = async () => {
      conn.afterCommit(() => { events.push('hook'); });
      return failure;
    };
    // When
    const result = entry === 'transaction'
      ? await conn.transaction(callback, policy)
      : await conn.requestTransaction(callback, undefined, policy);
    // Then
    expect(result).toBe(failure);
    expect(events).toEqual(['start', 'abort', 'end']);
    expect(conn.currentSession()).toBeUndefined();
  });

  it('does not infer failure from a Result-shaped value without an explicit predicate', async () => {
    // Given
    const { conn, events } = fixture(mode);
    const failure = { ok: false };
    // When
    const result = await conn.transaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
      return failure;
    });
    // Then
    expect(result).toBe(failure);
    expect(events).toEqual(['start', 'commit', 'end', 'hook']);
  });

  it.each(['transaction', 'requestTransaction'] as const)('keeps the first nested %s rejection sticky', async (entry) => {
    // Given
    const { conn, events } = fixture(mode);
    const first = { accepted: false, id: 1 };
    const second = { accepted: false, id: 2 };
    const policy = { shouldRollback: (value: typeof first) => !value.accepted };
    // When
    const transaction = conn.transaction(async () => {
      const callback = async () => {
        conn.afterCommit(() => { events.push('nested-hook'); });
        return first;
      };
      const nested = entry === 'transaction'
        ? await conn.transaction(callback, policy)
        : await conn.requestTransaction(callback, undefined, policy);
      expect(nested).toBe(first);
      expect(events).toEqual(['start']);
      await conn.transaction(async () => second, policy);
      conn.afterCommit(() => { events.push('root-hook'); });
      return { accepted: true };
    }, { shouldRollback: (value) => !value.accepted });
    // Then
    await expect(transaction).rejects.toBeInstanceOf(TransactionRollbackOnlyError);
    await expect(transaction).rejects.toMatchObject({ result: first });
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it('returns the rejected root value rather than the earlier nested failure', async () => {
    // Given
    const { conn, events } = fixture(mode);
    const nested = { accepted: false };
    const root = { accepted: false };
    const policy = { shouldRollback: (value: typeof root) => !value.accepted };
    // When
    const result = await conn.transaction(async () => {
      await conn.requestTransaction(async () => nested, undefined, policy);
      return root;
    }, policy);
    // Then
    expect(result).toBe(root);
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it.each(['transaction', 'requestTransaction'] as const)('still commits hooks when an opted nested %s throws and is caught', async (entry) => {
    // Given
    const { conn, events } = fixture(mode);
    const failure = new Error('ordinary nested throw');
    const predicate = vi.fn(() => true);
    // When
    await conn.transaction(async () => {
      const callback = async () => {
        conn.afterCommit(() => { events.push('nested-hook'); });
        throw failure;
      };
      const nested = entry === 'transaction'
        ? conn.transaction(callback, { shouldRollback: predicate })
        : conn.requestTransaction(callback, undefined, { shouldRollback: predicate });
      await expect(nested).rejects.toBe(failure);
      return 'accepted';
    }, { shouldRollback: () => false });
    // Then
    expect(predicate).not.toHaveBeenCalled();
    expect(events).toEqual(['start', 'commit', 'end', 'nested-hook']);
  });

  it('propagates a thrown predicate instead of recovering a nested value', async () => {
    // Given
    const { conn, events } = fixture(mode);
    const failure = new Error('predicate failed');
    // When
    const transaction = conn.transaction(async () => {
      await conn.transaction(async () => 'nested', { shouldRollback: () => true });
      return 'root';
    }, { shouldRollback: () => { throw failure; } });
    // Then
    await expect(transaction).rejects.toBe(failure);
    expect(events).toEqual(['start', 'abort', 'end']);
  });
});

describe('Mongoose Result rollback capability', () => {
  it.each(['transaction', 'requestTransaction'] as const)('refuses fail-open %s before invoking the callback', async (entry) => {
    // Given
    const conn = new MongooseConnection({}, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    const callback = vi.fn(async () => ({ ok: false }));
    const policy = { shouldRollback: (value: { ok: boolean }) => !value.ok };
    // When
    const transaction = entry === 'transaction'
      ? conn.transaction(callback, policy)
      : conn.requestTransaction(callback, undefined, policy);
    // Then
    await expect(transaction).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(['manual', 'delegated'] as const)('checks actual %s session rollback methods before invoking the callback', async (mode) => {
    // Given: runtime handles may violate their declared native interface.
    const { conn: supported } = fixture('manual');
    const session = await supported.current().startSession?.();
    if (!session) throw new Error('fixture session is required');
    Reflect.deleteProperty(session, 'abortTransaction');
    const root = mode === 'manual'
      ? { startSession: async () => session }
      : { transaction: <T>(fn: (value: MongooseSessionLike) => Promise<T>) => fn(session) };
    const conn = new MongooseConnection(root, undefined, { strictTransactions: false, rollbackObserver: observerDouble });
    const callback = vi.fn(async () => 'failure');
    // When
    const transaction = conn.transaction(callback, { shouldRollback: () => true });
    // Then
    await expect(transaction).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    expect(callback).not.toHaveBeenCalled();
  });
});
