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

describe('Drizzle inherited transaction continuations', () => {
  it('tracks a continuation inherited from a settled manual transaction as a fresh root', async () => {
    // Given: a manual transaction schedules a continuation that starts after its owner settles.
    const events: string[] = [];
    const continuationStarted = createDeferred();
    const continuationRelease = createDeferred();
    const outerDatabase = { id: 'outer' as const };
    const continuationDatabase = { id: 'continuation' as const };
    type TransactionDatabase = typeof outerDatabase | typeof continuationDatabase;
    let transactionCalls = 0;
    const database = {
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        const transactionDatabase = transactionCalls === 1 ? outerDatabase : continuationDatabase;
        events.push(`${transactionDatabase.id}:start`);

        try {
          return await callback(transactionDatabase);
        } finally {
          events.push(`${transactionDatabase.id}:end`);
        }
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, TransactionDatabase>(database, () => {
      events.push('dispose');
    });
    let continuation: Promise<void> | undefined;
    const outer = drizzle.transaction(async () => {
      setImmediate(() => {
        continuation = drizzle.transaction(async () => {
          events.push(`continuation:current:${drizzle.current() === continuationDatabase}`);
          continuationStarted.resolve();
          await continuationRelease.promise;
          events.push('continuation:done');
        });
      });
    });
    let shutdown: Promise<void> | undefined;

    try {
      await outer;
      await continuationStarted.promise;
      const observedContinuation = continuation;

      if (!observedContinuation) {
        throw new Error('Inherited manual continuation did not start.');
      }

      // When: shutdown starts while the inherited continuation is still active.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: the continuation owns a fresh transaction and disposal waits for it.
      expect(transactionCalls).toBe(2);
      expect(events).toEqual([
        'outer:start',
        'outer:end',
        'continuation:start',
        'continuation:current:true',
      ]);

      continuationRelease.resolve();
      await observedContinuation;
      await shutdown;
      expect(events).toEqual([
        'outer:start',
        'outer:end',
        'continuation:start',
        'continuation:current:true',
        'continuation:done',
        'continuation:end',
        'dispose',
      ]);
    } finally {
      continuationRelease.resolve();
      await Promise.allSettled([
        outer,
        continuation ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('tracks a continuation inherited from a settled request transaction as a fresh root', async () => {
    // Given: a request transaction schedules non-request work after its owner settles.
    const events: string[] = [];
    const continuationStarted = createDeferred();
    const continuationRelease = createDeferred();
    const requestDatabase = { id: 'request' as const };
    const continuationDatabase = { id: 'continuation' as const };
    type TransactionDatabase = typeof requestDatabase | typeof continuationDatabase;
    let transactionCalls = 0;
    const database = {
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        const transactionDatabase = transactionCalls === 1 ? requestDatabase : continuationDatabase;
        events.push(`${transactionDatabase.id}:start`);

        try {
          return await callback(transactionDatabase);
        } finally {
          events.push(`${transactionDatabase.id}:end`);
        }
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, TransactionDatabase>(database, () => {
      events.push('dispose');
    });
    let continuation: Promise<void> | undefined;
    const request = drizzle.requestTransaction(async () => {
      setImmediate(() => {
        continuation = drizzle.transaction(async () => {
          events.push(`continuation:current:${drizzle.current() === continuationDatabase}`);
          continuationStarted.resolve();
          await continuationRelease.promise;
          events.push('continuation:done');
        });
      });
    });
    let shutdown: Promise<void> | undefined;

    try {
      await request;
      await continuationStarted.promise;
      const observedContinuation = continuation;

      if (!observedContinuation) {
        throw new Error('Inherited request continuation did not start.');
      }

      // When: shutdown starts while the inherited continuation is still active.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: stale request context is not reused and disposal remains ordered after the fresh root.
      expect(transactionCalls).toBe(2);
      expect(events).toEqual([
        'request:start',
        'request:end',
        'continuation:start',
        'continuation:current:true',
      ]);

      continuationRelease.resolve();
      await observedContinuation;
      await shutdown;
      expect(events).toEqual([
        'request:start',
        'request:end',
        'continuation:start',
        'continuation:current:true',
        'continuation:done',
        'continuation:end',
        'dispose',
      ]);
    } finally {
      continuationRelease.resolve();
      await Promise.allSettled([
        request,
        continuation ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('preserves an inherited request abort signal when the continuation starts a fresh request root', async () => {
    // Given: a settled request owner leaves an inherited continuation with its ambient abort signal.
    const controller = new AbortController();
    const continuationScheduled = createDeferred();
    const requestDatabase = { id: 'request' as const };
    const continuationDatabase = { id: 'continuation' as const };
    type TransactionDatabase = typeof requestDatabase | typeof continuationDatabase;
    let transactionCalls = 0;
    let callbackCalls = 0;
    const database = {
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        const transactionDatabase = transactionCalls === 1 ? requestDatabase : continuationDatabase;
        return callback(transactionDatabase);
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, TransactionDatabase>(database);
    let continuation: Promise<string> | undefined;
    const request = drizzle.requestTransaction(async () => {
      setImmediate(() => {
        continuation = drizzle.requestTransaction(async () => {
          callbackCalls += 1;
          return 'unreachable';
        });
        continuationScheduled.resolve();
      });
    }, controller.signal);

    try {
      await request;
      controller.abort(new Error('inherited request aborted'));
      await continuationScheduled.promise;
      const observedContinuation = continuation;

      if (!observedContinuation) {
        throw new Error('Inherited request continuation did not start.');
      }

      // When: the inherited continuation observes the already-aborted ambient request signal.
      const rejection = expect(observedContinuation).rejects.toThrow('inherited request aborted');

      // Then: it opens no fresh database transaction and never invokes the callback.
      await rejection;
      expect(transactionCalls).toBe(1);
      expect(callbackCalls).toBe(0);
    } finally {
      await Promise.allSettled([request, continuation ?? Promise.resolve('not-started')]);
    }
  });

  it('drains a manual continuation inherited from a settled fail-open owner', async () => {
    // Given: a fail-open manual transaction schedules another manual boundary after it settles.
    const events: string[] = [];
    const continuationStarted = createDeferred();
    const continuationRelease = createDeferred();
    const database = {};
    const drizzle = new DrizzleDatabase<typeof database>(database, () => {
      events.push('dispose');
    });
    let continuation: Promise<void> | undefined;
    const outer = drizzle.transaction(async () => {
      setImmediate(() => {
        continuation = drizzle.transaction(async () => {
          events.push('continuation:start');
          continuationStarted.resolve();
          await continuationRelease.promise;
          events.push('continuation:end');
        });
      });
      events.push('outer:end');
    });
    let shutdown: Promise<void> | undefined;

    try {
      await outer;
      await continuationStarted.promise;
      const observedContinuation = continuation;

      if (!observedContinuation) {
        throw new Error('Inherited fail-open continuation did not start.');
      }

      // When: shutdown starts before the inherited direct-execution boundary settles.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: disposal cannot overtake the fresh fail-open lifecycle root.
      expect(events).toEqual(['outer:end', 'continuation:start']);

      continuationRelease.resolve();
      await observedContinuation;
      await shutdown;
      expect(events).toEqual(['outer:end', 'continuation:start', 'continuation:end', 'dispose']);
    } finally {
      continuationRelease.resolve();
      await Promise.allSettled([
        outer,
        continuation ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('keeps a non-awaited inherited continuation inside its active owner boundary', async () => {
    // Given: inherited manual work starts before its fail-open owner settles but is not awaited by the owner callback.
    const events: string[] = [];
    const continuationStarted = createDeferred();
    const continuationRelease = createDeferred();
    const database = {};
    const drizzle = new DrizzleDatabase<typeof database>(database, () => {
      events.push('dispose');
    });
    let continuation: Promise<void> | undefined;
    const outer = drizzle.transaction(async () => {
      continuation = drizzle.transaction(async () => {
        events.push('continuation:start');
        continuationStarted.resolve();
        await continuationRelease.promise;
        events.push('continuation:end');
      });
      events.push('outer:callback:end');
    });
    let shutdown: Promise<void> | undefined;

    try {
      await continuationStarted.promise;

      // When: shutdown starts while the inherited continuation keeps the outer owner from settling.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: neither the owner nor disposal settles before the inherited callback.
      expect(events).toEqual(['outer:callback:end', 'continuation:start']);

      continuationRelease.resolve();
      await outer;
      await continuation;
      await shutdown;
      expect(events).toEqual(['outer:callback:end', 'continuation:start', 'continuation:end', 'dispose']);
    } finally {
      continuationRelease.resolve();
      await Promise.allSettled([
        outer,
        continuation ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('keeps a real nested continuation inside its active owner boundary', async () => {
    // Given: a real transaction starts nested manual work without awaiting it.
    const events: string[] = [];
    const continuationStarted = createDeferred();
    const continuationRelease = createDeferred();
    const transactionDatabase = { id: 'transaction' as const };
    let transactionCalls = 0;
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } finally {
          events.push('transaction:end');
        }
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database, () => {
      events.push('dispose');
    });
    let continuation: Promise<void> | undefined;
    const outer = drizzle.transaction(async () => {
      continuation = drizzle.transaction(async () => {
        events.push(`continuation:current:${drizzle.current() === transactionDatabase}`);
        continuationStarted.resolve();
        await continuationRelease.promise;
        events.push('continuation:end');
      });
      events.push('outer:callback:end');
    });
    let shutdown: Promise<void> | undefined;

    try {
      await continuationStarted.promise;

      // When: shutdown starts while nested work is still owned by the active real transaction.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: one transaction stays open and disposal waits for the nested callback.
      expect(transactionCalls).toBe(1);
      expect(events).toEqual(['transaction:start', 'outer:callback:end', 'continuation:current:true']);

      continuationRelease.resolve();
      await outer;
      await continuation;
      await shutdown;
      expect(events).toEqual([
        'transaction:start',
        'outer:callback:end',
        'continuation:current:true',
        'continuation:end',
        'transaction:end',
        'dispose',
      ]);
    } finally {
      continuationRelease.resolve();
      await Promise.allSettled([
        outer,
        continuation ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('keeps a non-awaited nested request inside its active real manual owner', async () => {
    // Given: a real manual transaction starts request work without awaiting it.
    const events: string[] = [];
    const nestedStarted = createDeferred();
    const nestedRelease = createDeferred();
    const transactionDatabase = { id: 'transaction' as const };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } finally {
          events.push('transaction:end');
        }
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database, () => {
      events.push('dispose');
    });
    let nested: Promise<void> | undefined;
    const outer = drizzle.transaction(async () => {
      nested = drizzle.requestTransaction(async () => {
        events.push(`nested:current:start:${drizzle.current() === transactionDatabase}`);
        nestedStarted.resolve();
        await nestedRelease.promise;
        events.push(`nested:current:end:${drizzle.current() === transactionDatabase}`);
      });
      void nested.catch((error: unknown) => {
        events.push(`nested:abort:${error instanceof Error ? error.message : String(error)}`);
      });
      events.push('outer:callback:end');
    });
    let shutdown: Promise<void> | undefined;

    try {
      await nestedStarted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));

      // When: shutdown aborts the nested request while its raw callback remains pending.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: abort is visible, but the transaction owner and disposal still wait for callback settlement.
      expect(events).toEqual([
        'transaction:start',
        'nested:current:start:true',
        'outer:callback:end',
        'nested:abort:Application shutdown interrupted an open request transaction.',
      ]);

      nestedRelease.resolve();
      await expect(nested).rejects.toThrow('Application shutdown interrupted an open request transaction.');
      await outer;
      await shutdown;
      events.push(`outside:current:root:${drizzle.current() === database}`);
      expect(events).toEqual([
        'transaction:start',
        'nested:current:start:true',
        'outer:callback:end',
        'nested:abort:Application shutdown interrupted an open request transaction.',
        'nested:current:end:true',
        'transaction:end',
        'dispose',
        'outside:current:root:true',
      ]);
    } finally {
      nestedRelease.resolve();
      await Promise.allSettled([
        outer,
        nested ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('keeps a non-awaited nested request inside its active real request owner', async () => {
    // Given: a real request transaction starts nested request work without awaiting it.
    const events: string[] = [];
    const nestedStarted = createDeferred();
    const nestedRelease = createDeferred();
    const transactionDatabase = { id: 'request' as const };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } finally {
          events.push('transaction:end');
        }
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database, () => {
      events.push('dispose');
    });
    let nested: Promise<void> | undefined;
    const outer = drizzle.requestTransaction(async () => {
      nested = drizzle.requestTransaction(async () => {
        events.push(`nested:current:start:${drizzle.current() === transactionDatabase}`);
        nestedStarted.resolve();
        await nestedRelease.promise;
        events.push(`nested:current:end:${drizzle.current() === transactionDatabase}`);
      });
      void nested.catch((error: unknown) => {
        events.push(`nested:abort:${error instanceof Error ? error.message : String(error)}`);
      });
      events.push('outer:callback:end');
    });
    let shutdown: Promise<void> | undefined;

    try {
      await nestedStarted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));

      // When: shutdown aborts the ambient request while the nested callback remains pending.
      shutdown = drizzle.onApplicationShutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Then: both callers observe abort without closing the real transaction or disposing early.
      expect(events).toEqual([
        'transaction:start',
        'nested:current:start:true',
        'outer:callback:end',
        'nested:abort:Application shutdown interrupted an open request transaction.',
      ]);

      nestedRelease.resolve();
      await expect(nested).rejects.toThrow('Application shutdown interrupted an open request transaction.');
      await expect(outer).rejects.toThrow('Application shutdown interrupted an open request transaction.');
      await shutdown;
      events.push(`outside:current:root:${drizzle.current() === database}`);
      expect(events).toEqual([
        'transaction:start',
        'nested:current:start:true',
        'outer:callback:end',
        'nested:abort:Application shutdown interrupted an open request transaction.',
        'nested:current:end:true',
        'transaction:end',
        'dispose',
        'outside:current:root:true',
      ]);
    } finally {
      nestedRelease.resolve();
      await Promise.allSettled([
        outer,
        nested ?? Promise.resolve(),
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

});
