import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { MongooseConnection } from './index.js';
import type { MongooseConnectionLike, MongooseSessionLike } from './types.js';

// Controlled-session regressions against the installed Mongoose 9.7.2 peer.
// `Connection.prototype.transaction` always stays the real prototype method, which fires
// `session.endSession()` from its `finally` without awaiting the returned promise. Only the
// session provider (`startSession`) and the driver-owned `withTransaction`/`endSession` seam
// are controlled so an explicit barrier can delay the real cleanup attempt. MongoDB-server
// retry evidence lives in the native fixture; this file records peer-method ordering only.

type ControlledSession = MongooseSessionLike & {
  withTransaction<T>(fn: (ambient: MongooseSessionLike) => Promise<T>): Promise<T>;
};

type WithTransactionRunner = (
  fn: (ambient: MongooseSessionLike) => Promise<unknown>,
  session: MongooseSessionLike,
) => Promise<unknown>;

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Macrotask boundary: pending microtask cascades (an incorrectly ordered hook drain or
// dispose) always complete before it, while barrier-held cleanup settlement cannot.
function afterPendingMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function runSingleAttempt(
  fn: (ambient: MongooseSessionLike) => Promise<unknown>,
  session: MongooseSessionLike,
): Promise<unknown> {
  await session.startTransaction();
  try {
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  }
}

function createRealPeerBoundary(
  events: string[],
  options?: {
    readonly withTransaction?: WithTransactionRunner;
    readonly commitTransaction?: MongooseSessionLike['commitTransaction'];
  },
) {
  const endStarted = barrier();
  const finishEnd = barrier();
  let endCalls = 0;
  const session: ControlledSession = {
    startTransaction() {
      events.push('start');
    },
    commitTransaction: options?.commitTransaction ?? (async () => {
      events.push('commit');
    }),
    async abortTransaction() {
      events.push('abort');
    },
    async endSession() {
      endCalls += 1;
      events.push('end:start');
      endStarted.release();
      await finishEnd.promise;
      events.push('end:done');
    },
    async withTransaction<T>(fn: (ambient: MongooseSessionLike) => Promise<T>): Promise<T> {
      return (options?.withTransaction ?? runSingleAttempt)(fn, session) as Promise<T>;
    },
  };
  const RealDelegatedConnection = mongoose.Connection as unknown as new (base: unknown) => unknown;
  const connection = new RealDelegatedConnection(mongoose) as unknown as MongooseConnectionLike & {
    startSession(): Promise<MongooseSessionLike>;
  };
  connection.startSession = async () => session;
  return { connection, session, endStarted, finishEnd, endCalls: () => endCalls };
}

describe('Mongoose delegated session cleanup settlement', () => {
  it('runs hooks and dispose only after the real delegated endSession settles', async () => {
    const events: string[] = [];
    const { connection, session, endStarted, finishEnd, endCalls } = createRealPeerBoundary(events);
    const originalEndSession = session.endSession;
    const conn = new MongooseConnection(connection, () => {
      events.push('dispose');
    });

    const transaction = conn.transaction(async () => {
      expect(conn.currentSession()).toBe(session);
      expect(conn.current()).toBe(connection);
      conn.afterCommit(() => {
        events.push('hook');
      });
      return 42;
    }, { requireAfterCommit: true });

    await endStarted.promise;
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'commit', 'end:start']);
    expect(conn.createPlatformStatusSnapshot()).toMatchObject({ details: { activeSessions: 1 } });

    const shutdown = conn.onApplicationShutdown();
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'commit', 'end:start']);

    finishEnd.release();
    await expect(transaction).resolves.toBe(42);
    await shutdown;
    expect(events).toEqual(['start', 'commit', 'end:start', 'end:done', 'hook', 'dispose']);
    expect(endCalls()).toBe(1);
    expect(session.endSession).toBe(originalEndSession);
  });

  it('keeps delegated requestTransaction results ordered after the real settlement', async () => {
    const events: string[] = [];
    const { connection, session, endStarted, finishEnd } = createRealPeerBoundary(events);
    const conn = new MongooseConnection(connection, () => {
      events.push('dispose');
    });
    const controller = new AbortController();

    const transaction = conn.requestTransaction(async () => {
      expect(conn.currentSession()).toBe(session);
      conn.afterCommit(() => {
        events.push('hook');
      });
      return 'request-result';
    }, controller.signal, { requireAfterCommit: true });

    await endStarted.promise;
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'commit', 'end:start']);

    finishEnd.release();
    await expect(transaction).resolves.toBe('request-result');
    expect(events).toEqual(['start', 'commit', 'end:start', 'end:done', 'hook']);
    await conn.onApplicationShutdown();
    expect(events).toEqual(['start', 'commit', 'end:start', 'end:done', 'hook', 'dispose']);
  });

  it('reports the delegate failure only after the real cleanup settles', async () => {
    const events: string[] = [];
    const { connection, endStarted, finishEnd } = createRealPeerBoundary(events);
    const conn = new MongooseConnection(connection, () => {
      events.push('dispose');
    });
    const failure = new Error('delegated callback failed');

    const transaction = conn.transaction(async () => {
      conn.afterCommit(() => {
        events.push('hook');
      });
      throw failure;
    });

    await endStarted.promise;
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'abort', 'end:start']);
    const shutdown = conn.onApplicationShutdown();
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'abort', 'end:start']);

    const rejected = expect(transaction).rejects.toBe(failure);
    finishEnd.release();
    await rejected;
    await shutdown;
    expect(events).toEqual(['start', 'abort', 'end:start', 'end:done', 'dispose']);
  });

  it('drains only the final successful attempt after a real peer callback retry', async () => {
    const events: string[] = [];
    const retryError = new Error('transient callback failure');
    const { connection, endStarted, finishEnd, endCalls } = createRealPeerBoundary(events, {
      async withTransaction(fn, ambient) {
        await ambient.startTransaction();
        try {
          const result = await fn(ambient);
          await ambient.commitTransaction();
          return result;
        } catch (error) {
          await ambient.abortTransaction();
          if (error !== retryError) throw error;
          await ambient.startTransaction();
          const retried = await fn(ambient);
          await ambient.commitTransaction();
          return retried;
        }
      },
    });
    const conn = new MongooseConnection(connection, () => {
      events.push('dispose');
    });
    let attempt = 0;

    const transaction = conn.transaction(async () => {
      attempt += 1;
      const current = attempt;
      conn.afterCommit(() => {
        events.push(`hook:${current}`);
      });
      if (current === 1) throw retryError;
      return 'accepted';
    }, { requireAfterCommit: true });

    await endStarted.promise;
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'abort', 'start', 'commit', 'end:start']);

    finishEnd.release();
    await expect(transaction).resolves.toBe('accepted');
    expect(events).toEqual(['start', 'abort', 'start', 'commit', 'end:start', 'end:done', 'hook:2']);
    expect(endCalls()).toBe(1);
  });

  it('does not repeat callbacks or hook registration across a real commit-only retry', async () => {
    const events: string[] = [];
    const commitFailure = new Error('retryable commit failure');
    let commitCalls = 0;
    let callbackCalls = 0;
    let registrations = 0;
    const { connection, endStarted, finishEnd } = createRealPeerBoundary(events, {
      async commitTransaction() {
        commitCalls += 1;
        events.push('commit');
        if (commitCalls === 1) throw commitFailure;
      },
      async withTransaction(fn, ambient) {
        await ambient.startTransaction();
        const result = await fn(ambient);
        try {
          await ambient.commitTransaction();
        } catch (error) {
          if (error !== commitFailure) throw error;
          await ambient.commitTransaction();
        }
        return result;
      },
    });
    const conn = new MongooseConnection(connection, () => {
      events.push('dispose');
    });

    const transaction = conn.transaction(async () => {
      callbackCalls += 1;
      conn.afterCommit(() => {
        registrations += 1;
        events.push('hook');
      });
      return 'committed';
    }, { requireAfterCommit: true });

    await endStarted.promise;
    await afterPendingMicrotasks();
    expect(events).toEqual(['start', 'commit', 'commit', 'end:start']);
    expect(callbackCalls).toBe(1);
    expect(registrations).toBe(0);

    finishEnd.release();
    await expect(transaction).resolves.toBe('committed');
    expect(events).toEqual(['start', 'commit', 'commit', 'end:start', 'end:done', 'hook']);
    expect(callbackCalls).toBe(1);
    expect(registrations).toBe(1);
  });
});
