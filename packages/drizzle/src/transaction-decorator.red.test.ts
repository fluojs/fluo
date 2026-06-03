import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { DrizzleDatabase, DrizzleModule, Transaction } from './index.js';

describe('@fluojs/drizzle Transaction decorator contract (RED - pending Task 8 impl)', () => {
  it('exports Transaction and opens a transaction for current-less repository calls', async () => {
    // TODO: RED - will pass after Task 8 implementation
      const drizzlePackage = await import('./index.js');
    const ExportedTransaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const users = { name: 'users' };
    const transactionDatabase = {
      insert(table: typeof users) {
        events.push(`tx:insert:${table.name}`);
        return {
          values(input: { email: string }) {
            events.push(`tx:values:${input.email}`);
            return Promise.resolve({ email: input.email, id: 'tx-user' });
          },
        };
      },
      select() {
        events.push('tx:select');
        return {
          from(table: typeof users) {
            events.push(`tx:from:${table.name}`);
            return Promise.resolve([{ email: 'ada@example.com', id: 'tx-user' }]);
          },
        };
      },
    };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:end');
        return result;
      },
      insert(table: typeof users) {
        events.push(`root:insert:${table.name}`);
        return {
          values(input: { email: string }) {
            events.push(`root:values:${input.email}`);
            return Promise.resolve({ email: input.email, id: 'root-user' });
          },
        };
      },
      select() {
        events.push('root:select');
        return {
          from(table: typeof users) {
            events.push(`root:from:${table.name}`);
            return Promise.resolve([{ email: 'ada@example.com', id: 'root-user' }]);
          },
        };
      },
    };

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabase<typeof database, typeof transactionDatabase> & typeof database) {}

      async create(email: string) {
        return this.db.insert(users).values({ email });
      }

      async findAll() {
        return this.db.select().from(users);
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @Transaction()
      async create(email: string) {
        await this.repo.findAll();
        return this.repo.create(email);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({ database })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(UserService);

    await expect(service.create('ada@example.com')).resolves.toEqual({
      email: 'ada@example.com',
      id: 'tx-user',
    });

    expect(events).toEqual([
      'transaction:start',
      'tx:select',
      'tx:from:users',
      'tx:insert:users',
      'tx:values:ada@example.com',
      'transaction:end',
    ]);

    await app.close();
  });

  it('reuses an active transaction for nested @Transaction() calls', async () => {
    // TODO: RED - will pass after Task 8 implementation
      const drizzlePackage = await import('./index.js');
    const ExportedTransaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const users = { name: 'users' };
    const transactionDatabase = {
      insert(table: typeof users) {
        events.push(`tx:insert:${table.name}`);
        return {
          values(input: { email: string }) {
            events.push(`tx:values:${input.email}`);
            return Promise.resolve({ email: input.email, id: 'tx-user' });
          },
        };
      },
    };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:end');
        return result;
      },
      insert(table: typeof users) {
        events.push(`root:insert:${table.name}`);
        return {
          values(input: { email: string }) {
            events.push(`root:values:${input.email}`);
            return Promise.resolve({ email: input.email, id: 'root-user' });
          },
        };
      },
    };

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabase<typeof database, typeof transactionDatabase> & typeof database) {}

      async create(email: string) {
        return this.db.insert(users).values({ email });
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @Transaction()
      async outer(email: string) {
        return this.inner(email);
      }

      @Transaction()
      async inner(email: string) {
        return this.repo.create(email);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({ database })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(UserService);

    await expect(service.outer('grace@example.com')).resolves.toEqual({
      email: 'grace@example.com',
      id: 'tx-user',
    });

    expect(events).toEqual(['transaction:start', 'tx:insert:users', 'tx:values:grace@example.com', 'transaction:end']);

    await app.close();
  });

  it('rejects nested @Transaction() calls with options while a context is already active', async () => {
    // TODO: RED - will pass after Task 8 implementation
      const drizzlePackage = await import('./index.js');
    const ExportedTransaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const users = { name: 'users' };
    const transactionDatabase = {
      insert(table: typeof users) {
        events.push(`tx:insert:${table.name}`);
        return {
          values(input: { email: string }) {
            events.push(`tx:values:${input.email}`);
            return Promise.resolve({ email: input.email, id: 'tx-user' });
          },
        };
      },
    };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:end');
        return result;
      },
      insert(table: typeof users) {
        events.push(`root:insert:${table.name}`);
        return {
          values(input: { email: string }) {
            events.push(`root:values:${input.email}`);
            return Promise.resolve({ email: input.email, id: 'root-user' });
          },
        };
      },
    };

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabase<typeof database, typeof transactionDatabase> & typeof database) {}

      async create(email: string) {
        return this.db.insert(users).values({ email });
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @Transaction()
      async outer(email: string) {
        return this.inner(email);
      }

      @Transaction({
        isolationLevel: 'Serializable',
      })
      async inner(email: string) {
        return this.repo.create(email);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({ database })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(UserService);

    await expect(service.outer('linus@example.com')).rejects.toThrow();

    expect(events).toEqual(['transaction:start']);

    await app.close();
  });
});

describe('@fluojs/drizzle Transaction decorator — named/accessor contract', () => {
  it('uses explicit accessor to select a specific DrizzleDatabase', async () => {
      const drizzlePackage = await import('./index.js');
    const ExportedTransaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const primaryEvents: string[] = [];
    const analyticsEvents: string[] = [];
    const users = { name: 'users' };

    const analyticsTransactionDatabase = {
      select() {
        analyticsEvents.push('analytics-tx:select');
        return {
          from(table: typeof users) {
            analyticsEvents.push(`analytics-tx:from:${table.name}`);
            return Promise.resolve([{ id: 'r1' }]);
          },
        };
      },
    };

    const primaryTransactionDatabase = { _primary: true as const };

    const primaryDatabase = {
      async transaction<T>(callback: (value: typeof primaryTransactionDatabase) => Promise<T>): Promise<T> {
        primaryEvents.push('primary:transaction:start');
        const result = await callback(primaryTransactionDatabase);
        primaryEvents.push('primary:transaction:end');
        return result;
      },
    };

    const analyticsDatabase = {
      async transaction<T>(callback: (value: typeof analyticsTransactionDatabase) => Promise<T>): Promise<T> {
        analyticsEvents.push('analytics:transaction:start');
        const result = await callback(analyticsTransactionDatabase);
        analyticsEvents.push('analytics:transaction:end');
        return result;
      },
    };

    @Inject(DrizzleDatabase)
    class MultiDatabaseService {
      readonly analyticsDb = analyticsDatabase;

      constructor(private readonly db: DrizzleDatabase<typeof primaryDatabase, typeof primaryTransactionDatabase>) {}

      @Transaction((self: MultiDatabaseService) => self.analyticsDb)
      async loadAnalytics() {
        return analyticsEvents.push('analytics:work');
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule.forRoot<typeof primaryDatabase, typeof primaryTransactionDatabase>({ database: primaryDatabase })],
      providers: [MultiDatabaseService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(MultiDatabaseService);

    await service.loadAnalytics();

    expect(analyticsEvents).toContain('analytics:transaction:start');
    expect(analyticsEvents).toContain('analytics:transaction:end');
    expect(primaryEvents).not.toContain('primary:transaction:start');

    await app.close();
  });

  it('does not confuse two Drizzle databases when only one accessor is decorated', async () => {
      const drizzlePackage = await import('./index.js');
    const ExportedTransaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const primaryEvents: string[] = [];
    const analyticsEvents: string[] = [];

    const analyticsTransactionDatabase = {
      select() {
        analyticsEvents.push('analytics-tx:select');
        return { from: () => Promise.resolve([]) };
      },
    };

    const primaryTransactionDatabase2 = { _primary2: true as const };

    const primaryDatabase = {
      async transaction<T>(callback: (value: typeof primaryTransactionDatabase2) => Promise<T>): Promise<T> {
        primaryEvents.push('primary:transaction:start');
        const result = await callback(primaryTransactionDatabase2);
        primaryEvents.push('primary:transaction:end');
        return result;
      },
    };

    const analyticsDatabase = {
      async transaction<T>(callback: (value: typeof analyticsTransactionDatabase) => Promise<T>): Promise<T> {
        analyticsEvents.push('analytics:transaction:start');
        const result = await callback(analyticsTransactionDatabase);
        analyticsEvents.push('analytics:transaction:end');
        return result;
      },
    };

    @Inject(DrizzleDatabase)
    class IsolatedService {
      readonly analyticsDb = analyticsDatabase;

      constructor(private readonly db: DrizzleDatabase<typeof primaryDatabase, typeof primaryTransactionDatabase2>) {}

      @Transaction((self: IsolatedService) => self.analyticsDb)
      async analyticsWork() {
        analyticsEvents.push('analytics:work');
      }

      async primaryWork() {
        primaryEvents.push('primary:work');
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule.forRoot<typeof primaryDatabase, typeof primaryTransactionDatabase2>({ database: primaryDatabase })],
      providers: [IsolatedService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(IsolatedService);

    await service.analyticsWork();
    await service.primaryWork();

    expect(analyticsEvents).toContain('analytics:transaction:start');
    expect(primaryEvents).not.toContain('primary:transaction:start');
    expect(primaryEvents).toContain('primary:work');

    await app.close();
  });
});
