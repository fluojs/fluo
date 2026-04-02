import { describe, expect, it, vi } from 'vitest';

import { Global, Inject, Module } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import {
  createDrizzleModule,
  createDrizzleModuleAsync,
  createDrizzlePlatformStatusSnapshot,
  DrizzleDatabase,
} from './index.js';

describe('@konekti/drizzle', () => {
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

    @Inject([DrizzleDatabase])
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

    const DrizzleModule = createDrizzleModule<typeof database, typeof transactionDatabase>({
      database,
      dispose(current) {
        events.push(`dispose:${current === database}`);
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule],
      providers: [UserService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const service = await app.container.resolve(UserService);

    await expect(service.findById('user-1')).resolves.toEqual({ id: 'user-1' });
    await expect(service.create('ada@example.com')).resolves.toEqual({ email: 'ada@example.com' });

    expect(events).toEqual([
      'root:find:user-1',
      'transaction:start',
      'tx:insert:ada@example.com',
      'transaction:end',
    ]);

    await app.close();

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

    const DrizzleModule = createDrizzleModule<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule],
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

  it('enforces strictTransactions for sync and async module builders', async () => {
    const database = {};

    const StrictSyncModule = createDrizzleModule({
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
    const syncDrizzle = await syncApp.container.resolve(DrizzleDatabase<typeof database>);

    await expect(syncDrizzle.transaction(async () => 'ok')).rejects.toThrow(
      'Transaction not supported: Drizzle database does not implement transaction.',
    );

    await syncApp.close();

    const StrictAsyncModule = createDrizzleModuleAsync({
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
    const asyncDrizzle = await asyncApp.container.resolve(DrizzleDatabase<typeof database>);

    await expect(asyncDrizzle.requestTransaction(async () => 'ok')).rejects.toThrow(
      'Transaction not supported: Drizzle database does not implement transaction.',
    );

    await asyncApp.close();
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

  it('aborts unsupported requestTransaction fallback on shutdown before dispose', async () => {
    const events: string[] = [];
    const database = {};
    let requestRejected = false;

    const DrizzleModule = createDrizzleModule<typeof database>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule],
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
});

describe('createDrizzleModuleAsync', () => {
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

  it('factory receives injected token and resolves DrizzleDatabase', async () => {
    const { database, events, transactionDatabase } = makeFakeDatabase();

    class ConfigService {
      readonly url = 'postgres://localhost/test';
    }

    @Global()
    @Module({ providers: [ConfigService], exports: [ConfigService] })
    class ConfigModule {}

    const factory = vi.fn().mockResolvedValue({ database });

    const DrizzleModule = createDrizzleModuleAsync<typeof database, typeof transactionDatabase>({
      inject: [ConfigService],
      useFactory: factory,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [ConfigModule, DrizzleModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const db = await app.container.resolve(DrizzleDatabase);

    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0]).toBeInstanceOf(ConfigService);

    void db;
    void events;

    await app.close();
  });

  it('factory returning a promise resolves the database correctly', async () => {
    const { database, transactionDatabase } = makeFakeDatabase();

    const DrizzleModule = createDrizzleModuleAsync<typeof database, typeof transactionDatabase>({
      useFactory: () => Promise.resolve({ database }),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [DrizzleModule] });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const db = await app.container.resolve(DrizzleDatabase);

    expect(db).toBeInstanceOf(DrizzleDatabase);

    await app.close();
  });

  it('propagates factory errors during module initialization', async () => {
    const DrizzleModule = createDrizzleModuleAsync({
      useFactory: () => Promise.reject(new Error('db config fetch failed')),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [DrizzleModule] });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow('db config fetch failed');
  });
});
