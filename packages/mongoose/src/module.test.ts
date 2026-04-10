import { describe, expect, it, vi } from 'vitest';

import { Global, Inject, Module } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';

import {
  MongooseModule,
  createMongoosePlatformStatusSnapshot,
  MongooseConnection,
} from './index.js';
import type { MongooseConnectionLike, MongooseSessionLike } from './types.js';

function createFakeSession(events: string[]): MongooseSessionLike {
  return {
    startTransaction() {
      events.push('transaction:start');
    },
    commitTransaction() {
      events.push('transaction:commit');
    },
    abortTransaction() {
      events.push('transaction:abort');
    },
    endSession() {
      events.push('session:end');
    },
  };
}

describe('@fluojs/mongoose', () => {
  it('exposes current connection, session, and transaction callbacks with optional disposal', async () => {
    const events: string[] = [];
    const session = createFakeSession(events);

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    @Inject(MongooseConnection)
    class UserService {
      constructor(private readonly conn: MongooseConnection<typeof connection>) {}

      async create(email: string) {
        return this.conn.transaction(async () => {
          const current = this.conn.current();
          const currentSession = this.conn.currentSession();

          events.push(`tx:create:${email}`);
          events.push(`session:${currentSession !== undefined}`);

          return { connection: current === connection, email };
        });
      }

      async findById(id: string) {
        events.push(`root:find:${id}`);
        return { id };
      }
    }

    const mongooseModule = MongooseModule.forRoot<typeof connection>({
      connection,
      dispose(current) {
        events.push(`dispose:${current === connection}`);
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [mongooseModule],
      providers: [UserService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });
    const service = await app.container.resolve(UserService);

    await expect(service.findById('user-1')).resolves.toEqual({ id: 'user-1' });
    await expect(service.create('ada@example.com')).resolves.toEqual({ connection: true, email: 'ada@example.com' });

    expect(events).toEqual([
      'root:find:user-1',
      'connection:startSession',
      'transaction:start',
      'tx:create:ada@example.com',
      'session:true',
      'transaction:commit',
      'session:end',
    ]);

    await app.close();

    expect(events).toEqual([
      'root:find:user-1',
      'connection:startSession',
      'transaction:start',
      'tx:create:ada@example.com',
      'session:true',
      'transaction:commit',
      'session:end',
      'dispose:true',
    ]);
  });

  it('rolls back open request transactions before dispose on shutdown', async () => {
    const events: string[] = [];
    const session = createFakeSession(events);

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    const mongooseModule = MongooseModule.forRoot<typeof connection>({
      connection,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [mongooseModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const mongoose = await app.container.resolve(MongooseConnection<typeof connection>);

    const openTransaction = mongoose.requestTransaction(
      async () => new Promise<never>(() => undefined),
    );

    await app.close();

    await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');
    expect(events).toEqual([
      'connection:startSession',
      'transaction:start',
      'transaction:abort',
      'session:end',
      'dispose',
    ]);
  });

  it('waits for async request session cleanup before dispose on shutdown', async () => {
    const events: string[] = [];
    let resolveEndSessionStarted!: () => void;
    let resolveEndSession!: () => void;
    const endSessionStarted = new Promise<void>((resolve) => {
      resolveEndSessionStarted = resolve;
    });
    const endSessionDeferred = new Promise<void>((resolve) => {
      resolveEndSession = resolve;
    });

    const session: MongooseSessionLike = {
      abortTransaction() {
        events.push('transaction:abort');
      },
      async commitTransaction() {
        events.push('transaction:commit');
      },
      async endSession() {
        events.push('session:end:start');
        resolveEndSessionStarted();
        await endSessionDeferred;
        events.push('session:end:done');
      },
      async startTransaction() {
        events.push('transaction:start');
      },
    };

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    const mongooseModule = MongooseModule.forRoot<typeof connection>({
      connection,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [mongooseModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const mongoose = await app.container.resolve(MongooseConnection<typeof connection>);

    const openTransaction = mongoose.requestTransaction(async () => new Promise<never>(() => undefined));
    const closePromise = app.close();

    await endSessionStarted;

    expect(events).toEqual([
      'connection:startSession',
      'transaction:start',
      'transaction:abort',
      'session:end:start',
    ]);

    resolveEndSession();

    await closePromise;
    await expect(openTransaction).rejects.toThrow('Application shutdown interrupted an open request transaction.');

    expect(events).toEqual([
      'connection:startSession',
      'transaction:start',
      'transaction:abort',
      'session:end:start',
      'session:end:done',
      'dispose',
    ]);
  });

  it('enforces strictTransactions for sync and async module builders', async () => {
    const connection = {};

    const StrictSyncModule = MongooseModule.forRoot({
      connection,
      strictTransactions: true,
    });

    class StrictSyncAppModule {}

    defineModule(StrictSyncAppModule, {
      imports: [StrictSyncModule],
    });

    const syncApp = await bootstrapApplication({
      rootModule: StrictSyncAppModule,
    });
    const syncMongoose = await syncApp.container.resolve(MongooseConnection<typeof connection>);

    await expect(syncMongoose.transaction(async () => 'ok')).rejects.toThrow(
      'Transaction not supported: Mongoose connection does not implement startSession.',
    );

    await syncApp.close();

    const StrictAsyncModule = MongooseModule.forRootAsync({
      useFactory: () => ({
        connection,
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
    const asyncMongoose = await asyncApp.container.resolve(MongooseConnection<typeof connection>);

    await expect(asyncMongoose.requestTransaction(async () => 'ok')).rejects.toThrow(
      'Transaction not supported: Mongoose connection does not implement startSession.',
    );

    await asyncApp.close();
  });

  it('runs nested request and service transactions through a single session boundary', async () => {
    let sessionCalls = 0;
    const events: string[] = [];
    const session = createFakeSession(events);

    const connection: MongooseConnectionLike = {
      async startSession() {
        sessionCalls += 1;
        return session;
      },
    };

    const mongoose = new MongooseConnection<typeof connection>(connection);

    await expect(
      mongoose.requestTransaction(async () => mongoose.transaction(async () => 'ok')),
    ).resolves.toBe('ok');
    expect(sessionCalls).toBe(1);
  });

  it('handles transaction abort on error', async () => {
    const events: string[] = [];
    const session = createFakeSession(events);

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    const mongoose = new MongooseConnection<typeof connection>(connection);

    await expect(
      mongoose.transaction(async () => {
        events.push('tx:work');
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');

    expect(events).toEqual([
      'connection:startSession',
      'transaction:start',
      'tx:work',
      'transaction:abort',
      'session:end',
    ]);
  });

  it('preserves the commit failure when abort cleanup also fails', async () => {
    const events: string[] = [];
    const commitError = new Error('commit failed');
    const abortError = new Error('abort failed');
    const session: MongooseSessionLike = {
      abortTransaction() {
        events.push('transaction:abort');
        throw abortError;
      },
      commitTransaction() {
        events.push('transaction:commit');
        throw commitError;
      },
      endSession() {
        events.push('session:end');
      },
      startTransaction() {
        events.push('transaction:start');
      },
    };

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    const mongoose = new MongooseConnection<typeof connection>(connection);

    await expect(
      mongoose.transaction(async () => {
        events.push('tx:work');
        return 'ok';
      }),
    ).rejects.toBe(commitError);

    expect(events).toEqual([
      'connection:startSession',
      'transaction:start',
      'tx:work',
      'transaction:commit',
      'transaction:abort',
      'session:end',
    ]);
  });

  it('ends the session even when abort cleanup throws after a transaction error', async () => {
    const events: string[] = [];
    const abortError = new Error('abort failed');
    const session: MongooseSessionLike = {
      abortTransaction() {
        events.push('transaction:abort');
        throw abortError;
      },
      commitTransaction() {
        events.push('transaction:commit');
      },
      endSession() {
        events.push('session:end');
      },
      startTransaction() {
        events.push('transaction:start');
      },
    };

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    const mongoose = new MongooseConnection<typeof connection>(connection);

    await expect(
      mongoose.transaction(async () => {
        events.push('tx:work');
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');

    expect(events).toEqual([
      'connection:startSession',
      'transaction:start',
      'tx:work',
      'transaction:abort',
      'session:end',
    ]);
  });

  it('handles connection without startSession gracefully', async () => {
    const events: string[] = [];

    const connection = {
      someOtherMethod: async () => {
        events.push('other:method');
      },
    } as unknown as MongooseConnectionLike;

    const mongoose = new MongooseConnection<typeof connection>(connection);

    await expect(mongoose.transaction(async () => {
      events.push('tx:work');
      return 'ok';
    })).resolves.toBe('ok');

    expect(events).toEqual(['tx:work']);
  });

  it('reports ownership/readiness/health semantics in platform snapshot shape', () => {
    const snapshot = createMongoosePlatformStatusSnapshot({
      activeRequestTransactions: 1,
      hasActiveSession: false,
      lifecycleState: 'ready',
      strictTransactions: false,
      supportsStartSession: true,
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      activeRequestTransactions: 1,
      sessionStrategy: 'explicit-session',
      transactionContext: 'als',
    });
  });

  it('marks strict transaction mismatch as not-ready', () => {
    const snapshot = createMongoosePlatformStatusSnapshot({
      activeRequestTransactions: 0,
      hasActiveSession: false,
      lifecycleState: 'ready',
      strictTransactions: true,
      supportsStartSession: false,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.readiness.reason).toContain('strictTransactions');
    expect(snapshot.health.status).toBe('healthy');
  });

  it('marks shutdown state as not-ready and degraded health', () => {
    const snapshot = createMongoosePlatformStatusSnapshot({
      activeRequestTransactions: 0,
      hasActiveSession: false,
      lifecycleState: 'shutting-down',
      strictTransactions: false,
      supportsStartSession: true,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
  });
});

describe('MongooseModule.forRootAsync', () => {
  function makeFakeConnection() {
    const events: string[] = [];
    const session = createFakeSession(events);

    const connection: MongooseConnectionLike = {
      async startSession() {
        events.push('connection:startSession');
        return session;
      },
    };

    return { connection, events, session };
  }

  it('factory receives injected token and resolves MongooseConnection', async () => {
    const { connection, events } = makeFakeConnection();

    class ConfigService {
      readonly url = 'mongodb://localhost/test';
    }

    @Global()
    @Module({ providers: [ConfigService], exports: [ConfigService] })
    class ConfigModule {}

    const factory = vi.fn().mockResolvedValue({ connection });

    const mongooseModule = MongooseModule.forRootAsync<typeof connection>({
      inject: [ConfigService],
      useFactory: factory,
    });

    class AppModule {}

    defineModule(AppModule, {
      imports: [ConfigModule, mongooseModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const conn = await app.container.resolve(MongooseConnection);

    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0]).toBeInstanceOf(ConfigService);

    void conn;
    void events;

    await app.close();
  });

  it('factory returning a promise resolves the connection correctly', async () => {
    const { connection } = makeFakeConnection();

    const mongooseModule = MongooseModule.forRootAsync<typeof connection>({
      useFactory: () => Promise.resolve({ connection }),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [mongooseModule] });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const conn = await app.container.resolve(MongooseConnection);

    expect(conn).toBeInstanceOf(MongooseConnection);

    await app.close();
  });

  it('propagates factory errors during module initialization', async () => {
    const mongooseModule = MongooseModule.forRootAsync({
      useFactory: () => Promise.reject(new Error('mongo config fetch failed')),
    });

    class AppModule {}

    defineModule(AppModule, { imports: [mongooseModule] });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow('mongo config fetch failed');
  });
});
