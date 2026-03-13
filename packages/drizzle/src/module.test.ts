import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { createDrizzleModule, DrizzleDatabase } from './index';

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
      mode: 'test',
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
      mode: 'test',
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
});
