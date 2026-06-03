import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { MongooseConnection, MongooseModule, Transaction } from './index.js';
import type { MongooseConnectionLike, MongooseSessionLike } from './types.js';

function createFakeSession(events: string[]): MongooseSessionLike & { id: string } {
  return {
    id: 'session-1',
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

type TestMongooseOperationOptions = {
  session?: MongooseSessionLike | null;
  timestamps?: boolean;
};

function createFakeConnection(
  events: string[],
  session: MongooseSessionLike,
): MongooseConnectionLike & {
  model(name: string): {
    create(...args: unknown[]): Promise<unknown[]>;
    find(filter?: unknown, projection?: unknown, opts?: TestMongooseOperationOptions): Promise<unknown[]>;
    findOne(filter?: unknown, projection?: unknown, opts?: TestMongooseOperationOptions): Promise<unknown>;
    aggregate(
      pipeline: unknown[],
      opts?: TestMongooseOperationOptions,
    ): Promise<unknown[]>;
    bulkWrite(
      ops: unknown[],
      opts?: TestMongooseOperationOptions,
    ): Promise<{ ok: boolean }>;
  };
} {
  return {
    async startSession() {
      events.push('connection:startSession');
      return session;
    },
    model(name: string) {
      return {
        async create(...args: unknown[]) {
          const maybeOptions = args.at(-1);
          const opts =
            maybeOptions && typeof maybeOptions === 'object' && 'session' in maybeOptions
              ? (maybeOptions as TestMongooseOperationOptions)
              : undefined;
          const docs = opts ? args.slice(0, -1) : args;

          events.push(`model:${name}:create:session=${opts?.session != null ? 'set' : 'unset'}`);
          events.push(`model:${name}:create:docs=${docs.length}`);
          if (opts && 'timestamps' in opts) {
            events.push(`model:${name}:create:timestamps=${String(opts.timestamps)}`);
          }
          return docs;
        },
        async find(_filter?: unknown, projection?: unknown, opts?: TestMongooseOperationOptions) {
          if (projection && typeof projection === 'object' && 'session' in projection) {
            events.push(`model:${name}:find:projection-session=set`);
          }
          events.push(`model:${name}:find:session=${opts?.session != null ? 'set' : 'unset'}`);
          return [];
        },
        async findOne(_filter?: unknown, projection?: unknown, opts?: TestMongooseOperationOptions) {
          if (projection && typeof projection === 'object' && 'session' in projection) {
            events.push(`model:${name}:findOne:projection-session=set`);
          }
          events.push(`model:${name}:findOne:session=${opts?.session != null ? 'set' : 'unset'}`);
          return null;
        },
        async aggregate(_pipeline: unknown[], opts?: TestMongooseOperationOptions) {
          events.push(
            `model:${name}:aggregate:session=${opts?.session != null ? 'set' : 'unset'}`,
          );
          return [];
        },
        async bulkWrite(_ops: unknown[], opts?: TestMongooseOperationOptions) {
          events.push(
            `model:${name}:bulkWrite:session=${opts?.session != null ? 'set' : 'unset'}`,
          );
          return { ok: true };
        },
      };
    },
  };
}

describe('@fluojs/mongoose Transaction decorator contract (RED - pending Task 9 impl)', () => {
  describe('decorator opens transaction boundary', () => {
    it('exports Transaction as a function', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');
    });

    it('opens a session transaction when @Transaction() is applied to a service method', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserService {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        @Transaction()
        async createUser(name: string) {
          const currentSession = this.conn.currentSession();
          events.push(`service:createUser:session=${currentSession != null ? 'set' : 'unset'}`);
          return { name };
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.createUser('Ada')).resolves.toEqual({ name: 'Ada' });

      expect(events).toContain('connection:startSession');
      expect(events).toContain('transaction:start');
      expect(events).toContain('service:createUser:session=set');
      expect(events).toContain('transaction:commit');
      expect(events).toContain('session:end');

      await app.close();
    });

    it('reuses the ambient session for nested @Transaction() calls', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserService {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        @Transaction()
        async outer(name: string) {
          return this.inner(name);
        }

        @Transaction()
        async inner(name: string) {
          events.push(`inner:session=${this.conn.currentSession() != null ? 'set' : 'unset'}`);
          return { name };
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.outer('Grace')).resolves.toEqual({ name: 'Grace' });

      // Only one transaction should be opened (the outer); inner reuses the ambient session
      const txStarts = events.filter((e) => e === 'transaction:start');
      expect(txStarts).toHaveLength(1);
      expect(events).toContain('inner:session=set');

      await app.close();
    });
  });

  describe('model facade auto-session', () => {
    it('model.create() receives the ambient session inside @Transaction()', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async create(name: string) {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.create([{ name }]);
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async create(name: string) {
          return this.repo.create(name);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await service.create('Ada');

      expect(events).toContain('model:User:create:session=set');

      await app.close();
    });

    it('model.create(docA, docB) preserves multiple document arguments while adding ambient session', async () => {
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async createMany() {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.create({ name: 'Ada' }, { name: 'Grace' });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async createMany() {
          return this.repo.createMany();
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.createMany()).resolves.toEqual([{ name: 'Ada' }, { name: 'Grace' }]);
      expect(events).toContain('model:User:create:session=set');
      expect(events).toContain('model:User:create:docs=2');

      await app.close();
    });

    it('model.create(doc, options) merges the ambient session into existing single-document options', async () => {
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async createOne() {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.create({ name: 'Ada' }, { timestamps: false });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async createOne() {
          return this.repo.createOne();
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.createOne()).resolves.toEqual([{ name: 'Ada' }]);
      expect(events).toContain('model:User:create:session=set');
      expect(events).toContain('model:User:create:docs=1');
      expect(events).toContain('model:User:create:timestamps=false');

      await app.close();
    });

    it('model.create(doc, {}) treats an empty second argument as single-document options', async () => {
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async createOne() {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.create({ name: 'Ada' }, {});
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async createOne() {
          return this.repo.createOne();
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.createOne()).resolves.toEqual([{ name: 'Ada' }]);
      expect(events).toContain('model:User:create:session=set');
      expect(events).toContain('model:User:create:docs=1');

      await app.close();
    });

    it('model.find() receives the ambient session inside @Transaction()', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async findAll() {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.find({}, { name: 1 });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async findAll() {
          return this.repo.findAll();
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await service.findAll();

      expect(events).toContain('model:User:find:session=set');
      expect(events).not.toContain('model:User:find:projection-session=set');

      await app.close();
    });

    it('model.findOne() receives the ambient session inside @Transaction()', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async findOne(id: string) {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.findOne({ _id: id }, { name: 1 });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async findOne(id: string) {
          return this.repo.findOne(id);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await service.findOne('user-1');

      expect(events).toContain('model:User:findOne:session=set');
      expect(events).not.toContain('model:User:findOne:projection-session=set');

      await app.close();
    });

    it('model.aggregate() receives the ambient session inside @Transaction()', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async aggregate(pipeline: unknown[]) {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.aggregate(pipeline);
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async aggregate(pipeline: unknown[]) {
          return this.repo.aggregate(pipeline);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await service.aggregate([{ $match: {} }]);

      expect(events).toContain('model:User:aggregate:session=set');

      await app.close();
    });

    it('model.bulkWrite() receives the ambient session inside @Transaction()', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async bulkWrite(ops: unknown[]) {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.bulkWrite(ops);
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async bulkWrite(ops: unknown[]) {
          return this.repo.bulkWrite(ops);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await service.bulkWrite([{ insertOne: { document: { name: 'Ada' } } }]);

      expect(events).toContain('model:User:bulkWrite:session=set');

      await app.close();
    });

    // v1: doc.save() auto-session is NOT in scope
    it.skip('doc.save() auto-session — excluded from v1 (not a requirement)', () => {
      // v1: doc.save() auto-session is NOT in scope
      // This test is intentionally skipped; doc.save() interception is deferred to a future version.
    });
  });

  describe('session conflict guardrails', () => {
    it('throws when { session: null } is passed inside an active @Transaction() boundary', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async create(name: string) {
          // Passing { session: null } explicitly inside a transaction is a conflict
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.create([{ name }], { session: null });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async create(name: string) {
          return this.repo.create(name);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.create('Ada')).rejects.toThrow();

      await app.close();
    });

    it('throws when model.find() receives { session: null } as the third options argument', async () => {
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async findAll() {
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.find({}, { name: 1 }, { session: null });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async findAll() {
          return this.repo.findAll();
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.findAll()).rejects.toThrow('Explicit session: null conflicts with ambient transaction session');
      expect(events).not.toContain('model:User:find:projection-session=set');

      await app.close();
    });

    it('throws when a different explicit session is passed inside an active @Transaction() boundary', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      const differentSession = createFakeSession([]);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async create(name: string) {
          // Passing a different session object is a session conflict
          const User = this.conn.model('User') as ReturnType<typeof connection.model>;
          return User.create([{ name }], {
            session: differentSession as unknown as MongooseSessionLike,
          });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async create(name: string) {
          return this.repo.create(name);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

      await expect(service.create('Ada')).rejects.toThrow();

      await app.close();
    });

    it('allows passing the same ambient session explicitly inside an active @Transaction() boundary', async () => {
      // TODO: RED - will pass after Task 9 implementation
      const mongoosePackage = await import('./index.js');
      const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

      expect(ExportedTransaction).toBeTypeOf('function');

      const events: string[] = [];
      const session = createFakeSession(events);
      const connection = createFakeConnection(events, session);

      @Inject(MongooseConnection)
      class UserRepository {
        constructor(private readonly conn: MongooseConnection<typeof connection>) {}

        async create(name: string) {
          // Passing the same ambient session is allowed
          const ambientSession = this.conn.currentSession();
          return this.conn.current().model('User').create([{ name }], { session: ambientSession });
        }
      }

      @Inject(UserRepository)
      class UserService {
        constructor(private readonly repo: UserRepository) {}

        @Transaction()
        async create(name: string) {
          return this.repo.create(name);
        }
      }

      class AppModule {}

      defineModule(AppModule, {
        imports: [MongooseModule.forRoot({ connection })],
        providers: [UserRepository, UserService],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const service = await app.container.resolve(UserService);

    await expect(service.create('Ada')).resolves.toBeDefined();

    await app.close();
  });
  });
});

describe('@fluojs/mongoose Transaction decorator — named/accessor contract', () => {
  it('uses explicit accessor to select a specific MongooseConnection', async () => {
      const mongoosePackage = await import('./index.js');
    const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const primaryEvents: string[] = [];
    const analyticsEvents: string[] = [];

    const primarySession = createFakeSession(primaryEvents);
    const primaryConnection = createFakeConnection(primaryEvents, primarySession);

    const analyticsTransactionTarget = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        analyticsEvents.push('analytics:transaction:start');
        const result = await fn();
        analyticsEvents.push('analytics:transaction:end');
        return result;
      },
    };

    @Inject(MongooseConnection)
    class MultiConnectionService {
      readonly analyticsConn = analyticsTransactionTarget;

      constructor(private readonly conn: MongooseConnection<typeof primaryConnection>) {}

      @Transaction((self: MultiConnectionService) => self.analyticsConn)
      async loadAnalytics() {
        void this.conn;
        analyticsEvents.push('service:loadAnalytics');
        return { ok: true };
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [MongooseModule.forRoot({ connection: primaryConnection })],
      providers: [MultiConnectionService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(MultiConnectionService);

    const result = await service.loadAnalytics();

    expect(analyticsEvents).toContain('analytics:transaction:start');
    expect(analyticsEvents).toContain('analytics:transaction:end');
    expect(analyticsEvents).toContain('service:loadAnalytics');
    expect(primaryEvents).not.toContain('connection:startSession');
    expect(result).toEqual({ ok: true });

    await app.close();
  });

  it('does not confuse two connections when only one accessor is decorated', async () => {
      const mongoosePackage = await import('./index.js');
    const ExportedTransaction = (mongoosePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const primaryEvents: string[] = [];
    const analyticsEvents: string[] = [];

    const primarySession = createFakeSession(primaryEvents);
    const primaryConnection = createFakeConnection(primaryEvents, primarySession);

    const analyticsTransactionTarget = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        analyticsEvents.push('analytics:transaction:start');
        const result = await fn();
        analyticsEvents.push('analytics:transaction:end');
        return result;
      },
    };

    @Inject(MongooseConnection)
    class DualConnectionService {
      readonly analyticsConn = analyticsTransactionTarget;

      constructor(private readonly conn: MongooseConnection<typeof primaryConnection>) {}

      @Transaction((self: DualConnectionService) => self.analyticsConn)
      async analyticsWork() {
        void this.conn;
        analyticsEvents.push('service:analyticsWork');
      }

      async primaryWork() {
        primaryEvents.push('service:primaryWork');
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [MongooseModule.forRoot({ connection: primaryConnection })],
      providers: [DualConnectionService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(DualConnectionService);

    await service.analyticsWork();
    await service.primaryWork();

    expect(analyticsEvents).toContain('analytics:transaction:start');
    expect(primaryEvents).not.toContain('connection:startSession');
    expect(primaryEvents).toContain('service:primaryWork');

    await app.close();
  });
});
