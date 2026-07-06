import { Global, Inject, Module } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';
import type { DrizzleHandleProvider } from './index.js';
import {
  createDrizzlePlatformStatusSnapshot,
  DRIZZLE_DATABASE,
  DRIZZLE_HANDLE_PROVIDER,
  DRIZZLE_OPTIONS,
  DrizzleDatabase,
  DrizzleModule,
} from './index.js';

function createDeferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe('@fluojs/drizzle', () => {
  it('exposes current database handles, transaction callbacks, and optional disposal', async () => {
    const events: string[] = [];
    const transactionDatabase = {
      users: {
        async findById(id: string) {
          events.push(`tx:find:${id}`);
          return { id };
        },
        async insert(value: { email: string }) {
          events.push(`tx:insert:${value.email}`);
          return value;
        },
      },
    };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:end');
        return result;
      },
      users: {
        async insert(value: { email: string }) {
          events.push(`root:insert:${value.email}`);
          return value;
        },
        async findById(id: string) {
          events.push(`root:find:${id}`);
          return { id };
        },
      },
    };

    @Inject(DrizzleDatabase)
    class UserService {
      constructor(private readonly db: DrizzleDatabase<typeof database, typeof transactionDatabase>) {}

      async create(email: string) {
        return this.db.transaction(async () => {
          const current = this.db.current();

          return current.users.insert({ email });
        });
      }

      async findById(id: string) {
        const current = this.db.current();

        return current.users.findById(id);
      }
    }

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose(current) {
        events.push(`dispose:${current === database}`);
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
      providers: [UserService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    try {
      const service = await app.container.resolve(UserService);

      await expect(service.findById('user-1')).resolves.toEqual({ id: 'user-1' });
      await expect(service.create('ada@example.com')).resolves.toEqual({ email: 'ada@example.com' });

      expect(events).toEqual([
        'root:find:user-1',
        'transaction:start',
        'tx:insert:ada@example.com',
        'transaction:end',
      ]);
    } finally {
      await app.close();
    }

    expect(events).toEqual([
      'root:find:user-1',
      'transaction:start',
      'tx:insert:ada@example.com',
      'transaction:end',
      'dispose:true',
    ]);
  });

  it('rolls back open request transactions before dispose on shutdown', async () => {
    const events: string[] = [];
    const transactionDatabase = {};
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, typeof transactionDatabase>);

    const openTransaction = drizzle.requestTransaction(
      async () => new Promise<never>(() => undefined),
    );

    await app.close();

    await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
    expect(events).toEqual([
      'transaction:start',
      'transaction:rollback',
      'transaction:end',
      'dispose',
    ]);
  });

  it('waits for delayed request transaction settlement before dispose on shutdown', async () => {
    const events: string[] = [];
    const transactionDatabase = {};
    const rollbackBarrier = createDeferred();
    const rollbackPending = createDeferred();
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } catch (error) {
          events.push('transaction:rollback:pending');
          rollbackPending.resolve();
          await rollbackBarrier.promise;
          events.push('transaction:rollback:done');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, typeof transactionDatabase>);
    const requestAbortController = new AbortController();
    const openTransaction = drizzle.requestTransaction(
      async () => new Promise<never>(() => undefined),
      requestAbortController.signal,
    );
    let rollbackReleased = false;
    let shutdownPromise: Promise<void> | undefined;

    try {
      requestAbortController.abort(new Error('request aborted'));
      await rollbackPending.promise;

      shutdownPromise = app.close();
      expect(events).toContain('transaction:rollback:pending');
      expect(events).not.toContain('dispose');

      rollbackReleased = true;
      rollbackBarrier.resolve();

      await expect(openTransaction).rejects.toThrow();
      await shutdownPromise;

      expect(events).toEqual([
        'transaction:start',
        'transaction:rollback:pending',
        'transaction:rollback:done',
        'transaction:end',
        'dispose',
      ]);
    } finally {
      if (!rollbackReleased) {
        rollbackReleased = true;
        rollbackBarrier.resolve();
      }

      await Promise.allSettled([
        openTransaction,
        shutdownPromise ?? app.close(),
      ]);
    }
  });

  it('rejects new request transactions once shutdown begins', async () => {
    const events: string[] = [];
    const transactionDatabase = {};
    const rollbackBarrier = createDeferred();
    const rollbackPending = createDeferred();
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } catch (error) {
          events.push('transaction:rollback:pending');
          rollbackPending.resolve();
          await rollbackBarrier.promise;
          events.push('transaction:rollback:done');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, typeof transactionDatabase>);
    const openTransaction = drizzle.requestTransaction(async () => new Promise<never>(() => undefined));
    let rollbackReleased = false;
    const shutdownPromise = app.close();

    try {
      await rollbackPending.promise;
      expect(events).toContain('transaction:rollback:pending');

      await expect(drizzle.requestTransaction(async () => 'late-request')).rejects.toThrow(
        'Drizzle request transactions are not available during shutdown.',
      );

      rollbackReleased = true;
      rollbackBarrier.resolve();

      await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
      await shutdownPromise;

      expect(events).toEqual([
        'transaction:start',
        'transaction:rollback:pending',
        'transaction:rollback:done',
        'transaction:end',
        'dispose',
      ]);
    } finally {
      if (!rollbackReleased) {
        rollbackReleased = true;
        rollbackBarrier.resolve();
      }

      await Promise.allSettled([openTransaction, shutdownPromise]);
    }
  });

  it('waits for open manual transaction settlement before dispose on shutdown', async () => {
    const events: string[] = [];
    const transactionDatabase = {};
    const transactionBarrier = createDeferred();
    const transactionSettling = createDeferred();
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        try {
          return await callback(transactionDatabase);
        } finally {
          events.push('transaction:settle:pending');
          transactionSettling.resolve();
          await transactionBarrier.promise;
          events.push('transaction:settle:done');
        }
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, typeof transactionDatabase>);

    const openTransaction = drizzle.transaction(async () => 'manual-result');
    let transactionReleased = false;
    let shutdownPromise: Promise<void> | undefined;

    try {
      await transactionSettling.promise;
      shutdownPromise = app.close();

      expect(events).toEqual(['transaction:start', 'transaction:settle:pending']);
      expect(events).not.toContain('dispose');

      transactionReleased = true;
      transactionBarrier.resolve();

      await expect(openTransaction).resolves.toBe('manual-result');
      await shutdownPromise;

      expect(events).toEqual([
        'transaction:start',
        'transaction:settle:pending',
        'transaction:settle:done',
        'dispose',
      ]);
    } finally {
      if (!transactionReleased) {
        transactionReleased = true;
        transactionBarrier.resolve();
      }

      await Promise.allSettled([
        openTransaction,
        shutdownPromise ?? app.close(),
      ]);
    }
  });

  it('waits for fail-open manual transaction fallback before dispose on shutdown', async () => {
    const events: string[] = [];
    const transactionBarrier = createDeferred();
    const fallbackStarted = createDeferred();
    const database = {};

    const drizzleModule = DrizzleModule.forRoot<typeof database>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database>);
    let transactionReleased = false;
    let shutdownPromise: Promise<void> | undefined;

    const openTransaction = drizzle.transaction(async () => {
      events.push('fallback:start');
      fallbackStarted.resolve();
      await transactionBarrier.promise;
      events.push('fallback:end');
      return 'fallback-result';
    });

    try {
      await fallbackStarted.promise;

      shutdownPromise = app.close();

      expect(events).toEqual(['fallback:start']);
      expect(events).not.toContain('dispose');

      transactionReleased = true;
      transactionBarrier.resolve();

      await expect(openTransaction).resolves.toBe('fallback-result');
      await shutdownPromise;

      expect(events).toEqual(['fallback:start', 'fallback:end', 'dispose']);
    } finally {
      if (!transactionReleased) {
        transactionReleased = true;
        transactionBarrier.resolve();
      }

      await Promise.allSettled([
        openTransaction,
        shutdownPromise ?? app.close(),
      ]);
    }
  });

  it('rejects new manual transactions once shutdown begins', async () => {
    const events: string[] = [];
    const disposeBarrier = createDeferred();
    const disposeStarted = createDeferred();
    const database = {
      async transaction<T>(callback: (value: Record<string, never>) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        return callback({});
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, Record<string, never>>({
      database,
      async dispose() {
        events.push('dispose:start');
        disposeStarted.resolve();
        await disposeBarrier.promise;
        events.push('dispose:end');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, Record<string, never>>);

    const shutdownPromise = app.close();
    let disposeReleased = false;

    try {
      await disposeStarted.promise;

      await expect(drizzle.transaction(async () => 'late-manual')).rejects.toThrow(
        'Drizzle transactions are not available during application shutdown.',
      );
      expect(events).toEqual(['dispose:start']);

      disposeReleased = true;
      disposeBarrier.resolve();
      await shutdownPromise;
      expect(events).toEqual(['dispose:start', 'dispose:end']);
    } finally {
      if (!disposeReleased) {
        disposeReleased = true;
        disposeBarrier.resolve();
      }

      await shutdownPromise;
    }
  });

  it('rejects nested manual transactions once shutdown begins', async () => {
    const nestedAttemptBarrier = createDeferred();
    const outerWaiting = createDeferred();
    let transactionCalls = 0;
    const transactionDatabase = {};
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        return callback(transactionDatabase);
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database);

    const outerTransaction = drizzle.transaction(async () => {
      outerWaiting.resolve();
      await nestedAttemptBarrier.promise;

      await expect(drizzle.transaction(async () => 'late-nested')).rejects.toThrow(
        'Drizzle transactions are not available during application shutdown.',
      );

      return 'outer-complete';
    });
    let nestedAttemptReleased = false;
    let shutdown: Promise<void> | undefined;

    try {
      await outerWaiting.promise;
      expect(transactionCalls).toBe(1);

      shutdown = drizzle.onApplicationShutdown();

      nestedAttemptReleased = true;
      nestedAttemptBarrier.resolve();

      await expect(outerTransaction).resolves.toBe('outer-complete');
      await shutdown;
      expect(transactionCalls).toBe(1);
    } finally {
      if (!nestedAttemptReleased) {
        nestedAttemptReleased = true;
        nestedAttemptBarrier.resolve();
      }

      await Promise.allSettled([
        outerTransaction,
        shutdown ?? drizzle.onApplicationShutdown(),
      ]);
    }
  });

  it('waits for transaction runner settlement before reporting late request aborts', async () => {
    const events: string[] = [];
    const transactionDatabase = {};
    const commitBarrier = createDeferred();
    const commitPending = createDeferred();
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:commit:pending');
        commitPending.resolve();
        await commitBarrier.promise;
        events.push('transaction:commit:done');
        return result;
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database);
    const controller = new AbortController();

    const requestTransaction = drizzle.requestTransaction(
      async () => {
        events.push('request:done');
        return 'committed-result';
      },
      controller.signal,
    );
    let commitReleased = false;

    try {
      await commitPending.promise;
      expect(events).toEqual(['transaction:start', 'request:done', 'transaction:commit:pending']);

      controller.abort(new Error('client aborted during transaction settlement'));

      await Promise.resolve();
      expect(events).not.toContain('transaction:commit:done');

      commitReleased = true;
      commitBarrier.resolve();

      await expect(requestTransaction).rejects.toThrow('client aborted during transaction settlement');
      expect(events).toEqual([
        'transaction:start',
        'request:done',
        'transaction:commit:pending',
        'transaction:commit:done',
      ]);
    } finally {
      if (!commitReleased) {
        commitReleased = true;
        commitBarrier.resolve();
      }

      await Promise.allSettled([requestTransaction]);
    }
  });

  it('enforces strictTransactions for sync and async module builders', async () => {
    const database = {};

    const StrictSyncModule = DrizzleModule.forRoot({
      database,
      strictTransactions: true,
    });

    class StrictSyncAppModule {}

    defineModule(StrictSyncAppModule, {
      imports: [StrictSyncModule],
    });

    const syncApp = await bootstrapApplication({
      rootModule: StrictSyncAppModule,
    });
    try {
      const syncDrizzle = await syncApp.container.resolve(DrizzleDatabase<typeof database>);

      await expect(syncDrizzle.transaction(async () => 'ok')).rejects.toThrow(
        'Transaction not supported: Drizzle database does not implement transaction.',
      );
    } finally {
      await syncApp.close();
    }

    const StrictAsyncModule = DrizzleModule.forRootAsync({
      useFactory: () => ({
        database,
        strictTransactions: true,
      }),
    });

    class StrictAsyncAppModule {}

    defineModule(StrictAsyncAppModule, {
      imports: [StrictAsyncModule],
    });

    const asyncApp = await bootstrapApplication({
      rootModule: StrictAsyncAppModule,
    });
    try {
      const asyncDrizzle = await asyncApp.container.resolve(DrizzleDatabase<typeof database>);

      await expect(asyncDrizzle.requestTransaction(async () => 'ok')).rejects.toThrow(
        'Transaction not supported: Drizzle database does not implement transaction.',
      );
    } finally {
      await asyncApp.close();
    }
  });

  it('defaults strictTransactions to false for sync and async module entrypoints', async () => {
    const database = {};

    const SyncModule = DrizzleModule.forRoot({
      database,
    });

    class SyncAppModule {}

    defineModule(SyncAppModule, {
      imports: [SyncModule],
    });

    const syncApp = await bootstrapApplication({
      rootModule: SyncAppModule,
    });
    const syncDrizzle = await syncApp.container.resolve(DrizzleDatabase<typeof database>);
    const syncOptions = await syncApp.container.resolve<{ strictTransactions: boolean }>(DRIZZLE_OPTIONS);

    await expect(syncDrizzle.transaction(async () => 'sync-fallback')).resolves.toBe('sync-fallback');
    await expect(syncDrizzle.requestTransaction(async () => 'sync-request-fallback')).resolves.toBe('sync-request-fallback');
    expect(syncOptions).toEqual({ strictTransactions: false });

    await syncApp.close();

    const AsyncModule = DrizzleModule.forRootAsync({
      useFactory: () => ({
        database,
      }),
    });

    class AsyncAppModule {}

    defineModule(AsyncAppModule, {
      imports: [AsyncModule],
    });

    const asyncApp = await bootstrapApplication({
      rootModule: AsyncAppModule,
    });
    const asyncDrizzle = await asyncApp.container.resolve(DrizzleDatabase<typeof database>);
    const asyncOptions = await asyncApp.container.resolve<{ strictTransactions: boolean }>(DRIZZLE_OPTIONS);

    await expect(asyncDrizzle.transaction(async () => 'async-fallback')).resolves.toBe('async-fallback');
    await expect(asyncDrizzle.requestTransaction(async () => 'async-request-fallback')).resolves.toBe('async-request-fallback');
    expect(asyncOptions).toEqual({ strictTransactions: false });

    await asyncApp.close();
  });

  it('rejects missing Drizzle database handles from sync and async registration', async () => {
    const invalidDatabase = null as unknown as Record<string, never>;

    expect(() => DrizzleModule.forRoot({ database: invalidDatabase })).toThrow(
      'DrizzleModule requires a database option.',
    );

    const drizzleModule = DrizzleModule.forRootAsync({
      useFactory: () => ({ database: invalidDatabase }),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [drizzleModule] });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'DrizzleModule requires a database option.',
    );
  });

  it('awaits async dispose hooks registered through module entrypoints', async () => {
    const events: string[] = [];
    const database = {};

    const drizzleModule = DrizzleModule.forRootAsync({
      useFactory: async () => ({
        database,
        dispose: async () => {
          events.push('dispose:start');
          await Promise.resolve();
          events.push('dispose:end');
        },
      }),
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    await app.close();

    expect(events).toEqual(['dispose:start', 'dispose:end']);
  });

  it('falls back for requestTransaction when transaction support is unavailable and strictTransactions is false', async () => {
    const database = {};
    const drizzle = new DrizzleDatabase<typeof database>(database, undefined, {
      strictTransactions: false,
    });
    let invoked = false;

    await expect(drizzle.requestTransaction(async () => {
      invoked = true;
      return 'fallback-request';
    })).resolves.toBe('fallback-request');
    await expect(drizzle.transaction(async () => 'fallback-transaction')).resolves.toBe('fallback-transaction');
    expect(invoked).toBe(true);
  });

  it('still honors request abort signals on requestTransaction fallback when transaction support is unavailable', async () => {
    const database = {};
    const drizzle = new DrizzleDatabase<typeof database>(database, undefined, {
      strictTransactions: false,
    });
    const controller = new AbortController();
    controller.abort(new Error('request aborted before fallback'));

    await expect(
      drizzle.requestTransaction(async () => 'never', controller.signal),
    ).rejects.toThrow('request aborted before fallback');
  });

  it('aborts unsupported requestTransaction fallback during direct execution', async () => {
    const events: string[] = [];
    const database = {};
    const drizzle = new DrizzleDatabase<typeof database>(database, undefined, {
      strictTransactions: false,
    });
    const controller = new AbortController();
    const fallbackBarrier = createDeferred();

    const requestTransaction = drizzle.requestTransaction(async () => {
      events.push('fallback:start');
      controller.abort(new Error('request aborted during fallback'));
      await fallbackBarrier.promise;
      events.push('fallback:end');
      return 'unreachable';
    }, controller.signal);

    try {
      await expect(requestTransaction).rejects.toThrow('request aborted during fallback');
      expect(events).toEqual(['fallback:start']);
    } finally {
      fallbackBarrier.resolve();
      await Promise.allSettled([requestTransaction]);
    }
  });

  it('aborts unsupported requestTransaction fallback on shutdown before dispose', async () => {
    const events: string[] = [];
    const database = {};
    let requestRejected = false;

    const drizzleModule = DrizzleModule.forRoot<typeof database>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database>);

    const openTransaction = drizzle.requestTransaction(async () => {
      events.push('request:start');
      return new Promise<never>(() => undefined);
    });

    void openTransaction.catch(() => {
      requestRejected = true;
    });

    await app.close();

    await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
    expect(requestRejected).toBe(true);
    expect(events).toEqual(['request:start', 'dispose']);
  });

  it('runs nested request and service transactions through a single transaction boundary', async () => {
    let transactionCalls = 0;
    const transactionDatabase = {
      kind: 'transaction' as const,
    };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        return callback(transactionDatabase);
      },
    };

    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database);

    await expect(
      drizzle.requestTransaction(async () => drizzle.transaction(async () => 'ok')),
    ).resolves.toBe('ok');
    expect(transactionCalls).toBe(1);
  });

  it('tracks nested request transactions during shutdown when an explicit transaction is already active', async () => {
    const events: string[] = [];
    const transactionDatabase = {};
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, typeof transactionDatabase>);
    const nestedStarted = createDeferred();

    const openTransaction = drizzle.transaction(async () =>
      drizzle.requestTransaction(async () => {
        nestedStarted.resolve();
        return new Promise<never>(() => undefined);
      }),
    );
    let shutdownPromise: Promise<void> | undefined;

    try {
      await nestedStarted.promise;
      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(1);

      shutdownPromise = app.close();

      await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
      await shutdownPromise;
      expect(events).toEqual([
        'transaction:start',
        'transaction:rollback',
        'transaction:end',
        'dispose',
      ]);
    } finally {
      await Promise.allSettled([
        openTransaction,
        shutdownPromise ?? app.close(),
      ]);
    }
  });

  it('drains nested request transaction rollback before dispose during shutdown', async () => {
    const events: string[] = [];
    const rollbackBarrier = createDeferred();
    const rollbackPending = createDeferred();
    const transactionDatabase = {};
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');

        try {
          return await callback(transactionDatabase);
        } catch (error) {
          events.push('transaction:rollback:pending');
          rollbackPending.resolve();
          await rollbackBarrier.promise;
          events.push('transaction:rollback:done');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
    };

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database, typeof transactionDatabase>);
    const nestedStarted = createDeferred();
    const outerTransaction = drizzle.transaction(async () =>
      drizzle.requestTransaction(async () => {
        nestedStarted.resolve();
        return new Promise<never>(() => undefined);
      }),
    );
    let rollbackReleased = false;
    let shutdown: Promise<void> | undefined;

    try {
      await nestedStarted.promise;
      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(1);

      shutdown = app.close();
      await rollbackPending.promise;

      expect(events).toContain('transaction:rollback:pending');
      expect(events).not.toContain('dispose');

      rollbackReleased = true;
      rollbackBarrier.resolve();

      await expect(outerTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
      await shutdown;

      expect(events).toEqual([
        'transaction:start',
        'transaction:rollback:pending',
        'transaction:rollback:done',
        'transaction:end',
        'dispose',
      ]);
      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(0);
    } finally {
      if (!rollbackReleased) {
        rollbackReleased = true;
        rollbackBarrier.resolve();
      }

      await Promise.allSettled([
        outerTransaction,
        shutdown ?? app.close(),
      ]);
    }
  });

  it('removes completed nested request transactions from active status before the outer transaction settles', async () => {
    const transactionDatabase = {};
    const outerTransactionBarrier = createDeferred();
    const nestedCompleted = createDeferred();
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        return callback(transactionDatabase);
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database);

    const outerTransaction = drizzle.transaction(async () => {
      await expect(drizzle.requestTransaction(async () => 'nested-complete')).resolves.toBe('nested-complete');
      nestedCompleted.resolve();
      await outerTransactionBarrier.promise;
      return 'outer-complete';
    });
    let outerReleased = false;

    try {
      await nestedCompleted.promise;

      expect(drizzle.createPlatformStatusSnapshot().details.activeRequestTransactions).toBe(0);

      outerReleased = true;
      outerTransactionBarrier.resolve();

      await expect(outerTransaction).resolves.toBe('outer-complete');
    } finally {
      if (!outerReleased) {
        outerReleased = true;
        outerTransactionBarrier.resolve();
      }

      await Promise.allSettled([outerTransaction]);
    }
  });

  it('links nested request fast paths to the ambient request abort signal', async () => {
    const transactionDatabase = {};
    let transactionCalls = 0;
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        transactionCalls += 1;
        return callback(transactionDatabase);
      },
    };
    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase>(database);
    const controller = new AbortController();
    const nestedBarrier = createDeferred();

    const requestTransaction = drizzle.requestTransaction(
      async () =>
        drizzle.requestTransaction(async () => {
          controller.abort(new Error('ambient request aborted'));
          await nestedBarrier.promise;
          return 'unreachable';
        }),
      controller.signal,
    );

    try {
      await expect(requestTransaction).rejects.toThrow('ambient request aborted');
      expect(transactionCalls).toBe(1);
    } finally {
      nestedBarrier.resolve();
      await Promise.allSettled([requestTransaction]);
    }
  });

  it('forwards transaction options for explicit and request-scoped transactions', async () => {
    const optionsCalls: Array<{ isolationLevel: string } | undefined> = [];
    const transactionDatabase = { kind: 'transaction' };
    const database = {
      async transaction<T>(
        callback: (value: typeof transactionDatabase) => Promise<T>,
        options?: { isolationLevel: string },
      ): Promise<T> {
        optionsCalls.push(options);
        return callback(transactionDatabase);
      },
    };

    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase, { isolationLevel: string }>(database);

    await expect(drizzle.transaction(async () => drizzle.current(), { isolationLevel: 'serializable' })).resolves.toBe(
      transactionDatabase,
    );

    await expect(
      drizzle.requestTransaction(async () => drizzle.current(), undefined, { isolationLevel: 'read committed' }),
    ).resolves.toBe(transactionDatabase);

    expect(optionsCalls).toEqual([
      { isolationLevel: 'serializable' },
      { isolationLevel: 'read committed' },
    ]);
  });

  it('rejects nested transaction options and still honors nested request abort signals', async () => {
    const transactionDatabase = {
      kind: 'transaction' as const,
    };
    const database = {
      async transaction<T>(
        callback: (value: typeof transactionDatabase) => Promise<T>,
        _options?: { isolationLevel: string },
      ): Promise<T> {
        return callback(transactionDatabase);
      },
    };

    const drizzle = new DrizzleDatabase<typeof database, typeof transactionDatabase, { isolationLevel: string }>(database);

    await expect(
      drizzle.transaction(
        async () => drizzle.transaction(async () => 'never', { isolationLevel: 'serializable' }),
      ),
    ).rejects.toThrow(
      'Nested Drizzle transaction options are not supported because the active transaction context is reused.',
    );

    const controller = new AbortController();
    controller.abort(new Error('nested request aborted'));

    await expect(
      drizzle.transaction(
        async () => drizzle.requestTransaction(async () => new Promise<never>(() => undefined), controller.signal),
      ),
    ).rejects.toThrow('nested request aborted');
  });

  it('binds facade lifecycle methods to the lifecycle owner', async () => {
    const database = {};
    const facade = DrizzleDatabase.createFacade<typeof database>(database);
    const shutdown = facade.onApplicationShutdown;
    const snapshot = facade.createPlatformStatusSnapshot;

    expect(snapshot().details.lifecycleState).toBe('ready');

    await expect(shutdown()).resolves.toBeUndefined();
    expect(snapshot().details.lifecycleState).toBe('stopped');
  });

  it('forwards facade query methods to the root handle outside transactions and ambient handle inside transactions', async () => {
    const events: string[] = [];
    const transactionDatabase = {
      query() {
        events.push('tx:query');
        return 'tx-result';
      },
    };
    const database = {
      query() {
        events.push('root:query');
        return 'root-result';
      },
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:end');
        return result;
      },
    };
    const facade = DrizzleDatabase.createFacade<typeof database, typeof transactionDatabase>(database);

    expect(facade.query()).toBe('root-result');
    await expect(facade.transaction(async () => facade.query())).resolves.toBe('tx-result');
    expect(events).toEqual(['root:query', 'transaction:start', 'tx:query', 'transaction:end']);
  });

  it('reports live createPlatformStatusSnapshot lifecycle transitions through the module facade', async () => {
    const database = {};
    const disposeStarted = createDeferred();
    const disposeBarrier = createDeferred();

    const drizzleModule = DrizzleModule.forRoot<typeof database>({
      database,
      async dispose() {
        disposeStarted.resolve();
        await disposeBarrier.promise;
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const drizzle = await app.container.resolve(DrizzleDatabase<typeof database>);
    let disposeReleased = false;
    let shutdownPromise: Promise<void> | undefined;

    try {
      expect(drizzle.createPlatformStatusSnapshot().details.lifecycleState).toBe('ready');
      expect(drizzle.createPlatformStatusSnapshot().readiness.status).toBe('ready');

      shutdownPromise = app.close();
      await disposeStarted.promise;

      const shuttingDownSnapshot = drizzle.createPlatformStatusSnapshot();
      expect(shuttingDownSnapshot.details.lifecycleState).toBe('shutting-down');
      expect(shuttingDownSnapshot.readiness.status).toBe('not-ready');
      expect(shuttingDownSnapshot.health.status).toBe('degraded');

      disposeReleased = true;
      disposeBarrier.resolve();
      await shutdownPromise;

      const stoppedSnapshot = drizzle.createPlatformStatusSnapshot();
      expect(stoppedSnapshot.details.lifecycleState).toBe('stopped');
      expect(stoppedSnapshot.health.status).toBe('unhealthy');
    } finally {
      if (!disposeReleased) {
        disposeReleased = true;
        disposeBarrier.resolve();
      }

      await (shutdownPromise ?? app.close());
    }
  });

  it('reports ownership/readiness/health semantics in platform snapshot shape', () => {
    const snapshot = createDrizzlePlatformStatusSnapshot({
      activeRequestTransactions: 2,
      lifecycleState: 'ready',
      strictTransactions: false,
      supportsTransaction: true,
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      activeRequestTransactions: 2,
      strictTransactions: false,
      transactionContext: 'als',
    });
  });

  it('marks strict transaction mismatch as not-ready', () => {
    const snapshot = createDrizzlePlatformStatusSnapshot({
      activeRequestTransactions: 0,
      lifecycleState: 'ready',
      strictTransactions: true,
      supportsTransaction: false,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.readiness.reason).toContain('strictTransactions');
    expect(snapshot.health.status).toBe('healthy');
  });

  it('marks shutdown state as not-ready and degraded health', () => {
    const snapshot = createDrizzlePlatformStatusSnapshot({
      activeRequestTransactions: 0,
      lifecycleState: 'shutting-down',
      strictTransactions: false,
      supportsTransaction: true,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
  });

  it('marks stopped state as not-ready and unhealthy', () => {
    const snapshot = createDrizzlePlatformStatusSnapshot({
      activeRequestTransactions: 0,
      lifecycleState: 'stopped',
      strictTransactions: false,
      supportsTransaction: true,
    });

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'Drizzle integration is stopped.',
      status: 'not-ready',
    });
    expect(snapshot.health).toEqual({
      reason: 'Drizzle integration has been disposed.',
      status: 'unhealthy',
    });
  });
});

describe('DrizzleModule.forRootAsync', () => {
  function makeFakeDatabase() {
    const events: string[] = [];
    const transactionDatabase = {};
    const database = {
      async transaction<T>(callback: (tx: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:end');
        return result;
      },
    };
    return { database, events, transactionDatabase };
  }

  it('makes forRootAsync({ global: true }) providers visible to sibling modules', async () => {
    const { database, transactionDatabase } = makeFakeDatabase();

    @Inject(DrizzleDatabase)
    class ConsumerService {
      constructor(readonly drizzle: DrizzleDatabase<typeof database, typeof transactionDatabase>) {}

      currentDatabase() {
        return this.drizzle.current();
      }
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      exports: [ConsumerService],
      providers: [ConsumerService],
    });

    const drizzleModule = DrizzleModule.forRootAsync<typeof database, typeof transactionDatabase>({
      global: true,
      useFactory: () => ({ database }),
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [drizzleModule, FeatureModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const consumer = await app.container.resolve(ConsumerService);

      expect(consumer.currentDatabase()).toBe(database);
    } finally {
      await app.close();
    }
  });

  it('factory receives injected token and resolves DrizzleDatabase', async () => {
    const { database, events, transactionDatabase } = makeFakeDatabase();

    class ConfigService {
      readonly url = 'postgres://localhost/test';
    }

    @Global()
    @Module({ providers: [ConfigService], exports: [ConfigService] })
    class ConfigModule {}

    const factory = vi.fn().mockResolvedValue({ database });

    const drizzleModule = DrizzleModule.forRootAsync<typeof database, typeof transactionDatabase>({
      inject: [ConfigService],
      useFactory: factory,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [ConfigModule, drizzleModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const db = await app.container.resolve(DrizzleDatabase);

    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0]).toBeInstanceOf(ConfigService);

    void db;
    void events;

    await app.close();
  });

  it('resolves DRIZZLE_HANDLE_PROVIDER as the lifecycle-aware DrizzleDatabase alias', async () => {
    const { database, transactionDatabase } = makeFakeDatabase();

    const drizzleModule = DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({ database });

    class AppModule {}

    defineModule(AppModule, { imports: [drizzleModule] });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const drizzle = await app.container.resolve(DrizzleDatabase);
    try {
      const handleProvider = await app.container.resolve<DrizzleHandleProvider<typeof database, typeof transactionDatabase>>(
        DRIZZLE_HANDLE_PROVIDER,
      );

      expect(handleProvider).toBe(drizzle);
      expect(handleProvider.createPlatformStatusSnapshot()).toEqual(drizzle.createPlatformStatusSnapshot());
    } finally {
      await app.close();
    }
  });

  it('factory returning a promise resolves the database correctly', async () => {
    const { database, transactionDatabase } = makeFakeDatabase();

    const drizzleModule = DrizzleModule.forRootAsync<typeof database, typeof transactionDatabase>({
      useFactory: () => Promise.resolve({ database }),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [drizzleModule] });

    const app = await bootstrapApplication({ rootModule: AppModule });
    try {
      const db = await app.container.resolve(DrizzleDatabase);

      expect(db).toBeInstanceOf(DrizzleDatabase);
    } finally {
      await app.close();
    }
  });

  it('resolves async options independently for each application container', async () => {
    type AsyncIsolationTransactionDatabase = { id: string };
    type AsyncIsolationDatabase = {
      id: string;
      transaction<T>(callback: (tx: AsyncIsolationTransactionDatabase) => Promise<T>): Promise<T>;
    };

    const factoryEvents: string[] = [];
    let factoryCalls = 0;

    const drizzleModule = DrizzleModule.forRootAsync<AsyncIsolationDatabase, AsyncIsolationTransactionDatabase>({
      useFactory: () => {
        factoryCalls += 1;
        const id = `database-${factoryCalls}`;
        factoryEvents.push(`factory:${id}`);

        return {
          database: {
            id,
            async transaction<T>(callback: (tx: AsyncIsolationTransactionDatabase) => Promise<T>): Promise<T> {
              return callback({ id: `${id}:tx` });
            },
          },
          dispose: (database: { id: string }) => {
            factoryEvents.push(`dispose:${database.id}`);
          },
        };
      },
    });

    class FirstAppModule {}
    class SecondAppModule {}

    defineModule(FirstAppModule, { imports: [drizzleModule] });
    defineModule(SecondAppModule, { imports: [drizzleModule] });

    const firstApp = await bootstrapApplication({ rootModule: FirstAppModule });
    const firstDatabase = await firstApp.container.resolve<{ id: string }>(DRIZZLE_DATABASE);
    const firstDrizzle = await firstApp.container.resolve(DrizzleDatabase);

    const secondApp = await bootstrapApplication({ rootModule: SecondAppModule });
    const secondDatabase = await secondApp.container.resolve<{ id: string }>(DRIZZLE_DATABASE);
    const secondDrizzle = await secondApp.container.resolve(DrizzleDatabase);

    expect(firstDatabase).not.toBe(secondDatabase);
    expect(firstDrizzle).not.toBe(secondDrizzle);
    expect(factoryEvents).toEqual(['factory:database-1', 'factory:database-2']);

    await firstApp.close();
    await secondApp.close();

    expect(factoryEvents).toEqual([
      'factory:database-1',
      'factory:database-2',
      'dispose:database-1',
      'dispose:database-2',
    ]);
  });

  it('propagates factory errors during module initialization', async () => {
    const drizzleModule = DrizzleModule.forRootAsync({
      useFactory: () => Promise.reject(new Error('db config fetch failed')),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [drizzleModule] });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow('db config fetch failed');
  });
});
