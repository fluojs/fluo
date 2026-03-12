import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti-internal/module';

import { createPrismaModule, PrismaService } from './index';

describe('@konekti/prisma', () => {
  it('connects, reuses transaction-scoped handles, and disconnects through lifecycle hooks', async () => {
    const events: string[] = [];
    const transactionClient = {
      kind: 'transaction',
      user: {
        async create(input: { data: { email: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'tx-user' };
        },
        async findUnique(input: { where: { id: string } }) {
          events.push(`tx:find:${input.where.id}`);
          return { id: input.where.id };
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
        async findUnique(input: { where: { id: string } }) {
          events.push(`root:find:${input.where.id}`);
          return { id: input.where.id };
        },
      },
    };

    @Inject([PrismaService])
    class UserService {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(email: string) {
        return this.prisma.transaction(async () => {
          const current = this.prisma.current();

          return current.user.create({ data: { email } });
        });
      }

      async findById(id: string) {
        const current = this.prisma.current();

        return current.user.findUnique({ where: { id } });
      }
    }

    const PrismaModule = createPrismaModule<typeof client, typeof transactionClient>({ client });

    class AppModule {}

    defineModule(AppModule, {
      imports: [PrismaModule],
      providers: [UserService],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const service = await app.container.resolve(UserService);

    expect(events).toEqual(['connect']);
    await expect(service.findById('user-1')).resolves.toEqual({ id: 'user-1' });
    await expect(service.create('ada@example.com')).resolves.toEqual({
      email: 'ada@example.com',
      id: 'tx-user',
    });

    expect(events).toEqual([
      'connect',
      'root:find:user-1',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
    ]);

    await app.close();

    expect(events).toEqual([
      'connect',
      'root:find:user-1',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'disconnect',
    ]);
  });
});
