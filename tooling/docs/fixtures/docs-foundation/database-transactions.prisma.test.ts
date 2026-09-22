import { Inject, Module } from '@fluojs/core';
import {
  AfterCommitCapabilityError,
  getPrismaClientToken,
  PrismaModule,
  PrismaService,
  Transaction,
  TransactionRollbackCapabilityError,
} from '@fluojs/prisma';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

/**
 * Executable fixture for the "Database transactions" documentation page
 * (apps/docs/content/docs/techniques/database-transactions.mdx).
 *
 * Evidence scope: this fixture runs a client handle WITHOUT `$transaction`,
 * so `PrismaService` operates in its documented fail-open mode. It proves
 * registration, lifecycle ownership, direct execution, ambient `current()`
 * resolution, and the capability preflights - NOT native atomicity. Native
 * rollback/commit behavior requires separate native database verification.
 * See packages/prisma/fixtures/after-commit/ for the package-owned native fixture.
 */

interface FakePrismaClient {
  readonly $connect: () => Promise<void>;
  readonly $disconnect: () => Promise<void>;
}

function createFakePrismaClient() {
  const calls = { connect: 0, disconnect: 0 };
  const client: FakePrismaClient = {
    $connect: async () => {
      calls.connect += 1;
    },
    $disconnect: async () => {
      calls.disconnect += 1;
    },
  };
  return { client, calls };
}

function createUsersApp(client: FakePrismaClient, options?: { strictTransactions?: boolean }) {
  const PrismaFeature = PrismaModule.forRoot({
    client,
    strictTransactions: options?.strictTransactions,
  });

  @Inject(PrismaService, getPrismaClientToken())
  class UserService {
    constructor(
      private readonly prisma: PrismaService<FakePrismaClient>,
      private readonly rawClient: FakePrismaClient,
    ) {}

    @Transaction((self) => self.prisma)
    async onboardUser(email: string): Promise<{
      email: string;
      currentIsRootClient: boolean;
    }> {
      return {
        email,
        currentIsRootClient: this.prisma.current() === this.rawClient,
      };
    }
  }

  @Module({
    imports: [PrismaFeature],
    providers: [UserService],
  })
  class UsersModule {}

  @Module({
    imports: [UsersModule],
  })
  class AppModule {}

  return { UserService, AppModule };
}

describe('docs-foundation database-transactions fixture', () => {
  it('connects on bootstrap, runs a decorated service method in fail-open mode, and resolves current() to the root client', async () => {
    const fake = createFakePrismaClient();
    const { UserService, AppModule } = createUsersApp(fake.client);
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      expect(fake.calls.connect).toBe(1);

      const service = await module.resolve(UserService);
      const result = await service.onboardUser('ada@example.com');

      expect(result).toEqual({
        email: 'ada@example.com',
        currentIsRootClient: true,
      });
    } finally {
      await module.container.dispose();
    }
  });

  it('disconnects the client when the application closes', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client);
    const app = await Test.createApp({ rootModule: AppModule });

    await app.close();

    expect(fake.calls.disconnect).toBe(1);
  });

  it('executes a manual transaction callback directly when the client cannot open transactions', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client);
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      const prisma = await module.resolve<PrismaService<FakePrismaClient>>(PrismaService);

      await expect(prisma.transaction(async () => 'direct-execution')).resolves.toBe(
        'direct-execution',
      );
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects the shouldRollback opt-in before the callback without native rollback capability', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client);
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      const prisma = await module.resolve<PrismaService<FakePrismaClient>>(PrismaService);
      let callbackRan = false;

      await expect(
        prisma.transaction(
          async () => {
            callbackRan = true;
            return { ok: false as const };
          },
          undefined,
          { shouldRollback: (value) => !value.ok },
        ),
      ).rejects.toThrow(TransactionRollbackCapabilityError);

      expect(callbackRan).toBe(false);
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects the requireAfterCommit opt-in before the callback without native commit observation', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client);
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      const prisma = await module.resolve<PrismaService<FakePrismaClient>>(PrismaService);
      let callbackRan = false;

      await expect(
        prisma.transaction(
          async () => {
            callbackRan = true;
            return 'value';
          },
          undefined,
          { requireAfterCommit: true },
        ),
      ).rejects.toThrow(AfterCommitCapabilityError);

      expect(callbackRan).toBe(false);
    } finally {
      await module.container.dispose();
    }
  });

  it('rejects afterCommit registration outside an open native transaction', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client);
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      const prisma = await module.resolve<PrismaService<FakePrismaClient>>(PrismaService);

      expect(() => prisma.afterCommit(async () => {})).toThrow(AfterCommitCapabilityError);
    } finally {
      await module.container.dispose();
    }
  });

  it('refuses transaction boundaries when strictTransactions is enabled without native support', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client, { strictTransactions: true });
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      const prisma = await module.resolve<PrismaService<FakePrismaClient>>(PrismaService);

      await expect(prisma.transaction(async () => 'unused')).rejects.toThrow(
        /Transaction not supported/,
      );
    } finally {
      await module.container.dispose();
    }
  });

  it('exposes the raw client under the PRISMA_CLIENT token', async () => {
    const fake = createFakePrismaClient();
    const { AppModule } = createUsersApp(fake.client);
    const module = await Test.createTestingModule({ rootModule: AppModule }).compile();

    try {
      const rawClient: unknown = await module.resolve(getPrismaClientToken());

      expect(rawClient).toBe(fake.client);
    } finally {
      await module.container.dispose();
    }
  });
});
