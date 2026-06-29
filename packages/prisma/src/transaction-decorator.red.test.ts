import { Inject } from '@fluojs/core';
import type { Token } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { PrismaModule, PrismaService, Transaction, getPrismaServiceToken, type PrismaServiceFacade } from './index.js';

describe('@fluojs/prisma Transaction decorator contract (RED - pending Task 7 impl)', () => {
  it('exports Transaction and opens a transaction for current-less repository calls', async () => {
    // TODO: RED - will pass after Task 7 implementation
    const prismaPackage = await import('./index.js');
    const ExportedTransaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const transactionClient = {
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'tx-user' };
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:end');
        return result;
      },
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user' };
        },
      },
    };

    @Inject(PrismaService)
    class UserRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return this.prisma.user.create({ data: { email } });
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @Transaction()
      async create(email: string) {
        return this.repo.create(email);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule.forRoot({ client })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(UserService);

    await expect(service.create('ada@example.com')).resolves.toEqual({
      email: 'ada@example.com',
      id: 'tx-user',
    });

    expect(events).toEqual(['connect', 'transaction:start', 'tx:create:ada@example.com', 'transaction:end']);

    await app.close();
  });

  it('reuses an active transaction for nested @Transaction() calls', async () => {
    // TODO: RED - will pass after Task 7 implementation
    const prismaPackage = await import('./index.js');
    const ExportedTransaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const transactionClient = {
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'tx-user' };
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:end');
        return result;
      },
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user' };
        },
      },
    };

    @Inject(PrismaService)
    class UserRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return this.prisma.user.create({ data: { email } });
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
      imports: [PrismaModule.forRoot({ client })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(UserService);

    await expect(service.outer('grace@example.com')).resolves.toEqual({
      email: 'grace@example.com',
      id: 'tx-user',
    });

    expect(events).toEqual(['connect', 'transaction:start', 'tx:create:grace@example.com', 'transaction:end']);

    await app.close();
  });

  it('binds current-less top-level Prisma methods to the ambient transaction client', async () => {
    const prismaPackage = await import('./index.js');
    const ExportedTransaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const transactionClient = {
      marker: 'tx',
      async $queryRaw(this: { marker: string }, query: string) {
        events.push(`query:${this.marker}:${query}`);
        return [{ marker: this.marker }];
      },
    };
    const client = {
      marker: 'root',
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:end');
        return result;
      },
      async $queryRaw(this: { marker: string }, query: string) {
        events.push(`query:${this.marker}:${query}`);
        return [{ marker: this.marker }];
      },
    };

    @Inject(PrismaService)
    class QueryRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async load() {
        return this.prisma.$queryRaw('select 1');
      }
    }

    @Inject(QueryRepository)
    class QueryService {
      constructor(private readonly repo: QueryRepository) {}

      @Transaction()
      async load() {
        return this.repo.load();
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule.forRoot({ client })],
      providers: [QueryRepository, QueryService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(QueryService);

    await expect(service.load()).resolves.toEqual([{ marker: 'tx' }]);
    expect(events).toEqual(['connect', 'transaction:start', 'query:tx:select 1', 'transaction:end']);

    await app.close();
  });

  it('rejects nested @Transaction() calls with options while a context is already active', async () => {
    // TODO: RED - will pass after Task 7 implementation
    const prismaPackage = await import('./index.js');
    const ExportedTransaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const events: string[] = [];
    const transactionClient = {
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'tx-user' };
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:end');
        return result;
      },
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user' };
        },
      },
    };

    @Inject(PrismaService)
    class UserRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return this.prisma.user.create({ data: { email } });
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
      imports: [PrismaModule.forRoot({ client })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(UserService);

    await expect(service.outer('linus@example.com')).rejects.toThrow();

    expect(events).toEqual(['connect', 'transaction:start']);

    await app.close();
  });
});

describe('@fluojs/prisma Transaction decorator — named/accessor contract', () => {
  it('uses explicit accessor to select a named Prisma service', async () => {
    const prismaPackage = await import('./index.js');
    const ExportedTransaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const usersEvents: string[] = [];
    const analyticsEvents: string[] = [];

    const usersTransactionClient = {
      report: {
        async findMany() {
          usersEvents.push('users-tx:findMany');
          return [];
        },
      },
    };

    const analyticsTransactionClient = {
      report: {
        async findMany() {
          analyticsEvents.push('analytics-tx:findMany');
          return [{ id: 'r1' }];
        },
      },
    };

    const usersClient = {
      async $connect() { usersEvents.push('users:connect'); },
      async $disconnect() { usersEvents.push('users:disconnect'); },
      async $transaction<T>(callback: (value: typeof usersTransactionClient) => Promise<T>): Promise<T> {
        usersEvents.push('users:transaction:start');
        const result = await callback(usersTransactionClient);
        usersEvents.push('users:transaction:end');
        return result;
      },
    };

    const analyticsClient = {
      async $connect() { analyticsEvents.push('analytics:connect'); },
      async $disconnect() { analyticsEvents.push('analytics:disconnect'); },
      async $transaction<T>(callback: (value: typeof analyticsTransactionClient) => Promise<T>): Promise<T> {
        analyticsEvents.push('analytics:transaction:start');
        const result = await callback(analyticsTransactionClient);
        analyticsEvents.push('analytics:transaction:end');
        return result;
      },
    };

    @Inject(
      getPrismaServiceToken('users'),
      getPrismaServiceToken('analytics'),
    )
    class MultiDatabaseService {
      constructor(
        usersPrisma: PrismaService<typeof usersClient, typeof usersTransactionClient>,
        private readonly analyticsPrisma: PrismaService<typeof analyticsClient, typeof analyticsTransactionClient>,
      ) {
        void usersPrisma;
      }

      @Transaction((self: MultiDatabaseService) => self.analyticsPrisma)
      async loadAnalytics() {
        return (this.analyticsPrisma.current() as typeof analyticsTransactionClient).report.findMany();
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        PrismaModule.forRoot({ name: 'users', client: usersClient }),
        PrismaModule.forRoot({ name: 'analytics', client: analyticsClient }),
      ],
      providers: [MultiDatabaseService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(MultiDatabaseService);

    const result = await service.loadAnalytics();

    expect(analyticsEvents).toContain('analytics:transaction:start');
    expect(analyticsEvents).toContain('analytics:transaction:end');
    expect(analyticsEvents).toContain('analytics-tx:findMany');
    expect(usersEvents).not.toContain('users:transaction:start');
    expect(result).toEqual([{ id: 'r1' }]);

    await app.close();
  });

  it('does not confuse two clients when only one is decorated', async () => {
    const prismaPackage = await import('./index.js');
    const ExportedTransaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(ExportedTransaction).toBeTypeOf('function');

    const usersEvents: string[] = [];
    const analyticsEvents: string[] = [];

    const analyticsTransactionClient = {
      report: {
        async findMany() {
          analyticsEvents.push('analytics-tx:report:findMany');
          return [{ id: 'r1' }];
        },
      },
    };

    const usersClient = {
      async $connect() { usersEvents.push('users:connect'); },
      async $disconnect() { usersEvents.push('users:disconnect'); },
      async $transaction<T>(callback: (value: unknown) => Promise<T>): Promise<T> {
        usersEvents.push('users:transaction:start');
        const result = await callback({});
        usersEvents.push('users:transaction:end');
        return result;
      },
    };

    const analyticsClient = {
      async $connect() { analyticsEvents.push('analytics:connect'); },
      async $disconnect() { analyticsEvents.push('analytics:disconnect'); },
      async $transaction<T>(callback: (value: typeof analyticsTransactionClient) => Promise<T>): Promise<T> {
        analyticsEvents.push('analytics:transaction:start');
        const result = await callback(analyticsTransactionClient);
        analyticsEvents.push('analytics:transaction:end');
        return result;
      },
    };

    @Inject(
      getPrismaServiceToken('users'),
      getPrismaServiceToken('analytics'),
    )
    class DualClientService {
      constructor(
        usersPrisma: PrismaService<typeof usersClient>,
        private readonly analyticsPrisma: PrismaService<typeof analyticsClient, typeof analyticsTransactionClient>,
      ) {
        void usersPrisma;
      }

      @Transaction((self: DualClientService) => self.analyticsPrisma)
      async decoratedAnalytics() {
        return (this.analyticsPrisma.current() as typeof analyticsTransactionClient).report.findMany();
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [
        PrismaModule.forRoot({ name: 'users', client: usersClient }),
        PrismaModule.forRoot({ name: 'analytics', client: analyticsClient }),
      ],
      providers: [DualClientService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const service = await app.container.resolve(DualClientService);

    await service.decoratedAnalytics();

    expect(analyticsEvents).toContain('analytics:transaction:start');
    expect(usersEvents).not.toContain('users:transaction:start');

    await app.close();
  });

  it('ignores non-Prisma transaction-like host properties during default resolution', async () => {
    const events: string[] = [];
    const transactionClient = {
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'tx-user' };
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('prisma:transaction:start');
        const result = await callback(transactionClient);
        events.push('prisma:transaction:end');
        return result;
      },
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user' };
        },
      },
    };
    const misleadingPersistence = {
      async transaction<T>(callback: () => Promise<T>): Promise<T> {
        events.push('wrong:transaction:start');
        const result = await callback();
        events.push('wrong:transaction:end');
        return result;
      },
    };
    const MISLEADING_PERSISTENCE = Symbol('MISLEADING_PERSISTENCE') as Token<typeof misleadingPersistence>;

    @Inject(PrismaService)
    class UserRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return this.prisma.user.create({ data: { email } });
      }
    }

    @Inject(MISLEADING_PERSISTENCE, UserRepository)
    class UserService {
      constructor(
        private readonly misleading: typeof misleadingPersistence,
        private readonly repo: UserRepository,
      ) {}

      @Transaction()
      async create(email: string) {
        void this.misleading;

        return this.repo.create(email);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule.forRoot({ client })],
      providers: [
        { provide: MISLEADING_PERSISTENCE, useValue: misleadingPersistence },
        UserRepository,
        UserService,
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const service = await app.container.resolve(UserService);

      await expect(service.create('ada@example.com')).resolves.toEqual({
        email: 'ada@example.com',
        id: 'tx-user',
      });

      expect(events).toEqual(['connect', 'prisma:transaction:start', 'tx:create:ada@example.com', 'prisma:transaction:end']);
    } finally {
      await app.close();
    }
  });
});
