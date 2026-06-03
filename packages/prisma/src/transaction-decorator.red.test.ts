import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { PrismaModule, PrismaService } from './index.js';

describe('@fluojs/prisma Transaction decorator contract (RED - pending Task 7 impl)', () => {
  it('exports Transaction and opens a transaction for current-less repository calls', async () => {
    // TODO: RED - will pass after Task 7 implementation
    const prismaPackage = await import('@fluojs/prisma');
    const Transaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(Transaction).toBeTypeOf('function');

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
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return (this.prisma as unknown as typeof client).user.create({ data: { email } });
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @((Transaction as any)())
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
    const prismaPackage = await import('@fluojs/prisma');
    const Transaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(Transaction).toBeTypeOf('function');

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
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return (this.prisma as unknown as typeof client).user.create({ data: { email } });
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

  it('rejects nested @Transaction() calls with options while a context is already active', async () => {
    // TODO: RED - will pass after Task 7 implementation
    const prismaPackage = await import('@fluojs/prisma');
    const Transaction = (prismaPackage as { Transaction?: unknown }).Transaction;

    expect(Transaction).toBeTypeOf('function');

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
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return (this.prisma as unknown as typeof client).user.create({ data: { email } });
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
