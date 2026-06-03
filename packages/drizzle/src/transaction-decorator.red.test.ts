import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { DrizzleDatabase, DrizzleModule } from './index.js';

describe('@fluojs/drizzle Transaction decorator contract (RED - pending Task 8 impl)', () => {
  it('exports Transaction and opens a transaction for current-less repository calls', async () => {
    // TODO: RED - will pass after Task 8 implementation
    const drizzlePackage = await import('@fluojs/drizzle');
    const Transaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(Transaction).toBeTypeOf('function');

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

      @((Transaction as any)())
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
    const drizzlePackage = await import('@fluojs/drizzle');
    const Transaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(Transaction).toBeTypeOf('function');

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

      @((Transaction as any)())
      async outer(email: string) {
        return this.inner(email);
      }

      @((Transaction as any)())
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
    const drizzlePackage = await import('@fluojs/drizzle');
    const Transaction = (drizzlePackage as { Transaction?: unknown }).Transaction;

    expect(Transaction).toBeTypeOf('function');

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

      @((Transaction as any)())
      async outer(email: string) {
        return this.inner(email);
      }

      @((Transaction as any)({
        isolationLevel: 'Serializable',
      }))
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
