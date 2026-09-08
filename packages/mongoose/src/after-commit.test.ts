import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  AfterCommitCallback,
  MongooseConnectionLike,
  MongooseHandleProvider,
  MongooseSessionLike,
  TransactionBoundaryOptions,
} from './index.js';
import {
  AfterCommitCapabilityError,
  AfterCommitCleanupError,
  AfterCommitError,
  MongooseConnection,
  Transaction,
} from './index.js';

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixture(mode: 'manual' | 'delegated') {
  const events: string[] = [];
  const session: MongooseSessionLike = {
    startTransaction: vi.fn(() => { events.push('start'); }),
    commitTransaction: vi.fn(() => { events.push('commit'); }),
    abortTransaction: vi.fn(() => { events.push('abort'); }),
    endSession: vi.fn(() => { events.push('end'); }),
  };
  const root: MongooseConnectionLike = mode === 'manual'
    ? { startSession: async () => session }
    : {
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        try {
          await session.startTransaction();
          const result = await fn(session);
          await session.commitTransaction();
          return result;
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          await session.endSession();
        }
      },
    };
  const conn = new MongooseConnection(root, () => { events.push('dispose'); });
  return { conn, events, root, session };
}

describe.each(['manual', 'delegated'] as const)('Mongoose afterCommit %s boundary', (mode) => {
  it('registers synchronously and runs only after commit and session cleanup', async () => {
    const { conn, events, root, session } = fixture(mode);
    const value = await conn.transaction(async () => {
      expect(conn.currentSession()).toBe(session);
      expect(conn.afterCommit(() => {
        expect(conn.currentSession()).toBeUndefined();
        expect(conn.current()).toBe(root);
        events.push('hook');
      })).toBeUndefined();
      expect(events).toEqual(['start']);
      return 42;
    }, { requireAfterCommit: true });
    expect(value).toBe(42);
    expect(events).toEqual(['start', 'commit', 'end', 'hook']);
  });

  it('drains asynchronous hooks sequentially in FIFO order', async () => {
    const { conn, events } = fixture(mode);
    const entered = barrier();
    const release = barrier();
    const transaction = conn.transaction(async () => {
      conn.afterCommit(async () => {
        events.push('first:start');
        entered.release();
        await release.promise;
        events.push('first:end');
      });
      conn.afterCommit(() => { events.push('second'); });
    });
    await entered.promise;
    expect(events).toEqual(['start', 'commit', 'end', 'first:start']);
    release.release();
    await transaction;
    expect(events).toEqual(['start', 'commit', 'end', 'first:start', 'first:end', 'second']);
  });

  it('waits for asynchronous endSession before starting hooks', async () => {
    const { conn, events, session } = fixture(mode);
    const ending = barrier();
    const finishEnd = barrier();
    vi.mocked(session.endSession).mockImplementation(async () => {
      events.push('end:start');
      ending.release();
      await finishEnd.promise;
      events.push('end:done');
    });
    const transaction = conn.transaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
    });
    await ending.promise;
    expect(events).toEqual(['start', 'commit', 'end:start']);
    finishEnd.release();
    await transaction;
    expect(events).toEqual(['start', 'commit', 'end:start', 'end:done', 'hook']);
  });

  it('discards hooks when the outer callback throws', async () => {
    const { conn, events } = fixture(mode);
    const failure = new Error('callback failed');
    await expect(conn.transaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
      throw failure;
    })).rejects.toBe(failure);
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it('shares hooks across nested request and decorated service boundaries', async () => {
    const { conn, events } = fixture(mode);
    class Service {
      readonly conn = conn;

      @Transaction(undefined, { requireAfterCommit: true })
      async execute() {
        this.conn.afterCommit(() => { events.push('service'); });
        return 'done';
      }
    }
    const service = new Service();
    const value = await conn.requestTransaction(async () => {
      conn.afterCommit(() => { events.push('outer'); });
      await conn.requestTransaction(async () => {
        conn.afterCommit(() => { events.push('nested'); });
      }, undefined, { requireAfterCommit: true });
      expect(events).toEqual(['start']);
      return service.execute();
    }, undefined, { requireAfterCommit: true });
    expect(value).toBe('done');
    expect(events).toEqual(['start', 'commit', 'end', 'outer', 'nested', 'service']);
  });

  it('uses the final outer outcome after a caught nested throw without savepoints', async () => {
    const { conn, events } = fixture(mode);
    const failure = new Error('nested failed');
    await conn.transaction(async () => {
      await expect(conn.transaction(async () => {
        conn.afterCommit(() => { events.push('nested'); });
        throw failure;
      })).rejects.toBe(failure);
      conn.afterCommit(() => { events.push('outer'); });
    });
    expect(events).toEqual(['start', 'commit', 'end', 'nested', 'outer']);
  });

  it('discards hooks when commit fails', async () => {
    const { conn, events, session } = fixture(mode);
    const failure = new Error('commit failed');
    vi.mocked(session.commitTransaction).mockImplementation(() => { throw failure; });
    await expect(conn.transaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
    })).rejects.toBe(failure);
    expect(events).toEqual(['start', 'abort', 'end']);
  });

  it('collects every hook outcome without aborting committed work', async () => {
    const { conn, events, session } = fixture(mode);
    const first = new Error('first hook failed');
    const second = new Error('second hook failed');
    const result = conn.transaction(async () => {
      conn.afterCommit(() => { throw first; });
      conn.afterCommit(() => { events.push('middle'); });
      conn.afterCommit(async () => { throw second; });
      conn.afterCommit(async () => { events.push('last'); });
    });
    await expect(result).rejects.toBeInstanceOf(AfterCommitError);
    await expect(result).rejects.toMatchObject({
      committed: true,
      errors: [first, second],
      results: [
        { status: 'rejected', reason: first },
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: second },
        { status: 'fulfilled', value: undefined },
      ],
    });
    expect(events).toEqual(['start', 'commit', 'end', 'middle', 'last']);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it('waits for callback settlement on request abort and clears its hooks', async () => {
    const { conn, events } = fixture(mode);
    const started = barrier();
    const release = barrier();
    const controller = new AbortController();
    const reason = new Error('request cancelled');
    const transaction = conn.requestTransaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
      started.release();
      await release.promise;
      events.push('callback:end');
    }, controller.signal);
    const rejected = expect(transaction).rejects.toMatchObject({ name: 'AbortError', message: reason.message });
    await started.promise;
    controller.abort(reason);
    expect(events).toEqual(['start']);
    release.release();
    await rejected;
    expect(events).toEqual(['start', 'callback:end', 'abort', 'end']);
  });

  it('drains committed request hooks during shutdown without changing the commit result', async () => {
    const { conn, events, session } = fixture(mode);
    const entered = barrier();
    const release = barrier();
    const controller = new AbortController();
    const transaction = conn.requestTransaction(async () => {
      conn.afterCommit(async () => {
        events.push('hook:start');
        entered.release();
        await release.promise;
        events.push('hook:end');
      });
      return 42;
    }, controller.signal);
    await entered.promise;
    controller.abort(new Error('too late'));
    const shutdown = conn.onApplicationShutdown();
    expect(events).toEqual(['start', 'commit', 'end', 'hook:start']);
    release.release();
    await expect(transaction).resolves.toBe(42);
    await shutdown;
    expect(events).toEqual(['start', 'commit', 'end', 'hook:start', 'hook:end', 'dispose']);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it('rolls back open request work on shutdown without running its hooks', async () => {
    const { conn, events } = fixture(mode);
    const started = barrier();
    const release = barrier();
    const transaction = conn.requestTransaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
      started.release();
      await release.promise;
    });
    const rejected = expect(transaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
    await started.promise;
    const shutdown = conn.onApplicationShutdown();
    expect(events).toEqual(['start']);
    release.release();
    await rejected;
    await shutdown;
    expect(events).toEqual(['start', 'abort', 'end', 'dispose']);
  });

  it('rejects late inherited registration after callback close before commit finishes', async () => {
    const { conn, session } = fixture(mode);
    const committing = barrier();
    const finishCommit = barrier();
    const late = barrier();
    let lateRegistration: Promise<void> | undefined;
    vi.mocked(session.commitTransaction).mockImplementation(async () => {
      committing.release();
      await finishCommit.promise;
    });
    const transaction = conn.transaction(async () => {
      lateRegistration = late.promise.then(() => {
        expect(() => conn.afterCommit(() => {})).toThrow(/active|closed/i);
      });
    });
    await committing.promise;
    late.release();
    await lateRegistration;
    finishCommit.release();
    await transaction;
    expect(() => conn.afterCommit(() => {})).toThrow(/active|closed/i);
  });

  it('opens a fresh owner for transactions started by a hook', async () => {
    const { conn, events } = fixture(mode);
    await conn.transaction(async () => {
      conn.afterCommit(async () => {
        expect(conn.currentSession()).toBeUndefined();
        await conn.transaction(async () => {
          conn.afterCommit(() => { events.push('fresh'); });
        });
      });
    });
    expect(events).toEqual(['start', 'commit', 'end', 'start', 'commit', 'end', 'fresh']);
  });

  it.each(['commit', 'rollback'])('hides closed inherited sessions after %s', async (outcome) => {
    const { root } = fixture(mode);
    const model = {
      aggregate: vi.fn(),
      bulkWrite: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
    };
    const conn = new MongooseConnection({ ...root, model: () => model });
    const document = { save: vi.fn(async () => document) };
    const released = barrier();
    let continuation: Promise<void> | undefined;
    const failure = new Error('rollback');
    const transaction = conn.transaction(async () => {
      continuation = released.promise.then(async () => {
        expect(conn.currentSession()).toBeUndefined();
        expect(conn.model('User')).toBe(model);
        await expect(conn.saveDocument(document)).rejects.toThrow('active transaction session');
        expect(document.save).not.toHaveBeenCalled();
        expect(() => conn.afterCommit(() => {})).toThrow(AfterCommitCapabilityError);
      });
      if (outcome === 'rollback') throw failure;
    });
    if (outcome === 'rollback') {
      await expect(transaction).rejects.toBe(failure);
    } else {
      await transaction;
    }
    released.release();
    await continuation;
  });

  it.each([
    { boundary: 'manual', required: false },
    { boundary: 'manual', required: true },
    { boundary: 'request', required: false },
    { boundary: 'request', required: true },
  ])('opens a fresh inherited $boundary owner with requireAfterCommit=$required', async ({ boundary, required }) => {
    const { conn, events } = fixture(mode);
    const released = barrier();
    let continuation: Promise<void> | undefined;
    await conn.transaction(async () => {
      continuation = released.promise.then(async () => {
        const callback = async () => {
          expect(conn.currentSession()).toBeDefined();
          conn.afterCommit(() => { events.push('fresh'); });
        };
        if (boundary === 'manual') {
          await conn.transaction(callback, { requireAfterCommit: required });
        } else {
          await conn.requestTransaction(callback, undefined, { requireAfterCommit: required });
        }
        expect(conn.currentSession()).toBeUndefined();
      });
    });
    released.release();
    await continuation;
    expect(events).toEqual(['start', 'commit', 'end', 'start', 'commit', 'end', 'fresh']);
  });

  it.each(['signal', 'shutdown'])('preserves confirmed commit after %s cancellation during commit', async (cancellation) => {
    const { conn, events, session } = fixture(mode);
    const committing = barrier();
    const finishCommit = barrier();
    const controller = new AbortController();
    vi.mocked(session.commitTransaction).mockImplementation(async () => {
      events.push('commit:start');
      committing.release();
      await finishCommit.promise;
      events.push('commit:done');
    });
    const transaction = conn.requestTransaction(async () => {
      conn.afterCommit(() => { events.push('hook'); });
      return 42;
    }, controller.signal);
    await committing.promise;
    let shutdown: Promise<void> | undefined;
    if (cancellation === 'signal') {
      controller.abort(new Error('cancelled while committing'));
    } else {
      shutdown = conn.onApplicationShutdown();
    }
    finishCommit.release();
    await expect(transaction).resolves.toBe(42);
    await shutdown;
    expect(events).toEqual([
      'start', 'commit:start', 'commit:done', 'end', 'hook',
      ...(cancellation === 'shutdown' ? ['dispose'] : []),
    ]);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it.each(['signal', 'shutdown'])('preserves legacy no-hook %s cancellation during commit', async (cancellation) => {
    const { conn, events, session } = fixture(mode);
    const committing = barrier();
    const finishCommit = barrier();
    const controller = new AbortController();
    const reason = cancellation === 'signal'
      ? 'cancelled while committing'
      : 'Application shutdown interrupted an open request transaction.';
    vi.mocked(session.commitTransaction).mockImplementation(async () => {
      events.push('commit:start');
      committing.release();
      await finishCommit.promise;
      events.push('commit:done');
    });
    const transaction = conn.requestTransaction(async () => 42, controller.signal);
    const result = mode === 'delegated'
      ? expect(transaction).rejects.toMatchObject({ name: 'AbortError', message: reason })
      : expect(transaction).resolves.toBe(42);
    await committing.promise;
    let shutdown: Promise<void> | undefined;
    if (cancellation === 'signal') {
      controller.abort(new Error(reason));
    } else {
      shutdown = conn.onApplicationShutdown();
    }
    finishCommit.release();
    await result;
    await shutdown;
    expect(events).toEqual([
      'start', 'commit:start', 'commit:done', 'end',
      ...(cancellation === 'shutdown' ? ['dispose'] : []),
    ]);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('Mongoose afterCommit ownership and public API', () => {
  it.each([
    { boundary: 'manual', options: undefined },
    { boundary: 'manual', options: { requireAfterCommit: false } },
    { boundary: 'request', options: undefined },
    { boundary: 'request', options: { requireAfterCommit: false } },
  ])('preserves legacy cleanup error identity for $boundary with options=$options', async ({ boundary, options }) => {
    const { conn, events, session } = fixture('manual');
    const cleanupFailure = new Error('legacy endSession failure');
    vi.mocked(session.endSession).mockImplementation(async () => { throw cleanupFailure; });
    const callback = async () => 42;
    const transaction = boundary === 'manual'
      ? conn.transaction(callback, options)
      : conn.requestTransaction(callback, undefined, options);
    await expect(transaction).rejects.toBe(cleanupFailure);
    expect(events).toEqual(['start', 'commit']);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { boundary: 'manual', optIn: 'root' },
    { boundary: 'manual', optIn: 'nested transaction' },
    { boundary: 'manual', optIn: 'nested request' },
    { boundary: 'request', optIn: 'root' },
    { boundary: 'request', optIn: 'nested transaction' },
    { boundary: 'request', optIn: 'nested request' },
  ])('keeps no-hook cleanup commitment for $boundary with $optIn opt-in', async ({ boundary, optIn }) => {
    const { conn, session } = fixture('manual');
    const cleanupFailure = new Error('opted-in endSession failure');
    vi.mocked(session.endSession).mockImplementation(async () => { throw cleanupFailure; });
    const options = { requireAfterCommit: true };
    const callback = async () => {
      if (optIn === 'nested transaction') {
        await conn.transaction(async () => {}, options);
      } else if (optIn === 'nested request') {
        await conn.requestTransaction(async () => {}, undefined, options);
      }
    };
    const rootOptions = optIn === 'root' ? options : undefined;
    const transaction = boundary === 'manual'
      ? conn.transaction(callback, rootOptions)
      : conn.requestTransaction(callback, undefined, rootOptions);
    await expect(transaction).rejects.toBeInstanceOf(AfterCommitCleanupError);
    await expect(transaction).rejects.toMatchObject({
      committed: true,
      cause: cleanupFailure,
      errors: [cleanupFailure],
      results: [],
    });
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it.each(['root', 'nested transaction', 'nested request'])(
    'keeps no-hook delegated commitment for %s opt-in when cancelled during commit',
    async (optIn) => {
      const { conn, session } = fixture('delegated');
      const committing = barrier();
      const finishCommit = barrier();
      const controller = new AbortController();
      vi.mocked(session.commitTransaction).mockImplementation(async () => {
        committing.release();
        await finishCommit.promise;
      });
      const options = { requireAfterCommit: true };
      const transaction = conn.requestTransaction(async () => {
        if (optIn === 'nested transaction') {
          await conn.transaction(async () => {}, options);
        } else if (optIn === 'nested request') {
          await conn.requestTransaction(async () => {}, undefined, options);
        }
        return 42;
      }, controller.signal, optIn === 'root' ? options : undefined);
      await committing.promise;
      controller.abort(new Error('cancelled while committing'));
      finishCommit.release();
      await expect(transaction).resolves.toBe(42);
      expect(session.abortTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    { boundary: 'manual', hookFails: false },
    { boundary: 'manual', hookFails: true },
    { boundary: 'request', hookFails: false },
    { boundary: 'request', hookFails: true },
  ])('drains committed hooks after cleanup failure in $boundary with hookFails=$hookFails', async ({ boundary, hookFails }) => {
    const { conn, events, session } = fixture('manual');
    const cleanupFailure = new Error('endSession failed');
    const hookFailure = new Error('hook failed');
    vi.mocked(session.endSession).mockImplementation(async () => {
      events.push('end:failed');
      throw cleanupFailure;
    });
    const callback = async () => {
      conn.afterCommit(async () => {
        expect(conn.currentSession()).toBeUndefined();
        events.push('first');
        if (hookFails) throw hookFailure;
      });
      conn.afterCommit(() => { events.push('second'); });
    };
    const transaction = boundary === 'manual' ? conn.transaction(callback) : conn.requestTransaction(callback);
    await expect(transaction).rejects.toMatchObject({
      committed: true,
      cause: cleanupFailure,
      errors: hookFails ? [cleanupFailure, hookFailure] : [cleanupFailure],
      results: [
        hookFails ? { status: 'rejected', reason: hookFailure } : { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ],
    });
    await expect(transaction).rejects.toBeInstanceOf(AfterCommitCleanupError);
    expect(events).toEqual(['start', 'commit', 'end:failed', 'first', 'second']);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    await conn.onApplicationShutdown();
    expect(events.at(-1)).toBe('dispose');
  });

  it('preflights required capability before manual, request, or decorated callbacks', async () => {
    const conn = new MongooseConnection({});
    const callback = vi.fn(async () => 42);
    await expect(conn.transaction(callback, { requireAfterCommit: true })).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    await expect(conn.requestTransaction(callback, undefined, { requireAfterCommit: true }))
      .rejects.toBeInstanceOf(AfterCommitCapabilityError);
    class Service {
      @Transaction(() => conn, { requireAfterCommit: true })
      async execute() { return callback(); }
    }
    await expect(new Service().execute()).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    expect(callback).not.toHaveBeenCalled();
    await expect(conn.transaction(callback)).resolves.toBe(42);
    await expect(conn.requestTransaction(callback)).resolves.toBe(42);
    await conn.transaction(async () => {
      expect(() => conn.afterCommit(() => {})).toThrow(/active|native/i);
    });
    expect(() => conn.afterCommit(() => {})).toThrow(/active|native/i);
  });

  it('preflights an explicit legacy transaction-only decorator target only when required', async () => {
    const callback = vi.fn(async () => 42);
    const transactionStarted = vi.fn();
    const legacy = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        transactionStarted();
        return fn();
      },
    };
    class Service {
      @Transaction(() => legacy, { requireAfterCommit: true })
      async required() { return callback(); }

      @Transaction(() => legacy)
      async compatible() { return callback(); }
    }
    const service = new Service();
    await expect(service.required()).rejects.toBeInstanceOf(AfterCommitCapabilityError);
    expect(transactionStarted).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    await expect(service.compatible()).resolves.toBe(42);
    expect(transactionStarted).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('keeps simultaneous root owners isolated', async () => {
    const allEntered = barrier();
    const releaseFirst = barrier();
    const hooks: string[] = [];
    let entered = 0;
    const conn = new MongooseConnection({
      async startSession() { return fixture('manual').session; },
    });
    const run = (name: string) => conn.transaction(async () => {
      conn.afterCommit(() => { hooks.push(name); });
      entered += 1;
      if (entered === 2) allEntered.release();
      await allEntered.promise;
      if (name === 'first') await releaseFirst.promise;
    });
    const first = run('first');
    const second = run('second');
    await second;
    expect(hooks).toEqual(['second']);
    releaseFirst.release();
    await first;
    expect(hooks).toEqual(['second', 'first']);
  });

  it('discards every superseded callback queue and drains the final successful attempt once', async () => {
    const { session } = fixture('manual');
    const hooks: number[] = [];
    let attempt = 0;
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        await fn(session);
        expect(hooks).toEqual([]);
        return fn(session);
      },
    });
    const value = await conn.transaction(async () => {
      attempt += 1;
      const currentAttempt = attempt;
      conn.afterCommit(() => { hooks.push(currentAttempt); });
      return currentAttempt;
    });
    expect(value).toBe(2);
    expect(hooks).toEqual([2]);
  });

  it('does not leak hooks from a rejected callback retry', async () => {
    const { session } = fixture('manual');
    const hooks: number[] = [];
    const failure = new Error('transient callback error');
    let attempt = 0;
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        await expect(fn(session)).rejects.toBe(failure);
        return fn(session);
      },
    });
    await conn.transaction(async () => {
      attempt += 1;
      const currentAttempt = attempt;
      conn.afterCommit(() => { hooks.push(currentAttempt); });
      if (currentAttempt === 1) throw failure;
    });
    expect(hooks).toEqual([2]);
  });

  it('drains only once after native commit-only retries finish', async () => {
    const { session } = fixture('manual');
    const hooks: string[] = [];
    const callback = vi.fn(async () => {
      conn.afterCommit(() => { hooks.push('hook'); });
      return 42;
    });
    const conn = new MongooseConnection({
      async transaction<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T> {
        const value = await fn(session);
        await session.commitTransaction();
        expect(hooks).toEqual([]);
        await session.commitTransaction();
        expect(hooks).toEqual([]);
        return value;
      },
    });
    await expect(conn.transaction(callback)).resolves.toBe(42);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(hooks).toEqual(['hook']);
  });

  it('exports package-owned callback, boundary, error, and provider types', () => {
    expectTypeOf<AfterCommitCallback>().toEqualTypeOf<() => void | Promise<void>>();
    expectTypeOf<TransactionBoundaryOptions>().toEqualTypeOf<{
      readonly requireAfterCommit?: boolean;
      readonly shouldRollback?: (value: unknown) => boolean;
    }>();
    expectTypeOf<MongooseHandleProvider['afterCommit']>().toEqualTypeOf<(callback: AfterCommitCallback) => void>();
    expectTypeOf<AfterCommitError['committed']>().toEqualTypeOf<true>();
    expectTypeOf<AfterCommitError['results']>().toEqualTypeOf<readonly PromiseSettledResult<void>[]>();
    expectTypeOf<ConstructorParameters<typeof AfterCommitError>>()
      .toEqualTypeOf<[results: readonly PromiseSettledResult<void>[]]>();
    const reason = new Error('hook');
    const results: readonly PromiseSettledResult<void>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason },
    ];
    const error = new AfterCommitError(results);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.committed).toBe(true);
    expect(error.results).toEqual(results);
    expect(error.errors).toEqual([reason]);
  });
});
