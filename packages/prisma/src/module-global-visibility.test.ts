import { Inject } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  getPrismaClientToken,
  getPrismaOptionsToken,
  getPrismaServiceToken,
  PRISMA_CLIENT,
  PRISMA_OPTIONS,
  PrismaModule,
  PrismaService,
} from './index.js';

describe('PrismaModule.forRootAsync global visibility', () => {
  it('makes unnamed providers and tokens visible to a sibling module', async () => {
    // Given
    const events: string[] = [];
    const transactionClient = {};
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        return callback(transactionClient);
      },
    };

    @Inject(PrismaService)
    class ProviderConsumer {
      constructor(
        readonly prisma: PrismaService<typeof client, typeof transactionClient>,
      ) {}
    }

    @Inject(PRISMA_CLIENT, PRISMA_OPTIONS, getPrismaServiceToken())
    class TokenConsumer {
      constructor(
        readonly rawClient: typeof client,
        readonly options: { readonly strictTransactions: boolean },
        readonly prisma: PrismaService<typeof client, typeof transactionClient>,
      ) {}
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      exports: [ProviderConsumer, TokenConsumer],
      providers: [ProviderConsumer, TokenConsumer],
    });

    const prismaModule = PrismaModule.forRootAsync<typeof client, typeof transactionClient>({
      global: true,
      useFactory: () => ({ client }),
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [prismaModule, FeatureModule],
    });

    // When
    const app = await FluoFactory.create(AppModule);

    try {
      const providerConsumer = await app.container.resolve(ProviderConsumer);
      const tokenConsumer = await app.container.resolve(TokenConsumer);

      // Then
      expect(providerConsumer.prisma.current()).toBe(client);
      expect(tokenConsumer.rawClient).toBe(client);
      expect(tokenConsumer.options).toEqual({ strictTransactions: false });
      expect(tokenConsumer.prisma).toBe(providerConsumer.prisma);
      expect(events).toEqual(['connect']);
    } finally {
      await app.close();
    }

    expect(events).toEqual(['connect', 'disconnect']);
  });

  it('keeps named-only registrations isolated and unavailable by the PrismaService class token', async () => {
    // Given
    const usersClient = {
      async $connect() {},
      async $disconnect() {},
    };
    const reportsClient = {
      async $connect() {},
      async $disconnect() {},
    };

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        PrismaModule.forRoot({ client: usersClient, name: 'users', strictTransactions: true }),
        PrismaModule.forRoot({ client: reportsClient, name: 'reports' }),
      ],
    });
    const app = await FluoFactory.create(AppModule);

    try {
      // When
      const [usersService, reportsService, usersRawClient, reportsRawClient, usersOptions, reportsOptions] =
        await Promise.all([
          app.container.resolve(getPrismaServiceToken('users')),
          app.container.resolve(getPrismaServiceToken('reports')),
          app.container.resolve(getPrismaClientToken('users')),
          app.container.resolve(getPrismaClientToken('reports')),
          app.container.resolve(getPrismaOptionsToken('users')),
          app.container.resolve(getPrismaOptionsToken('reports')),
        ]);

      // Then
      expect(usersService).not.toBe(reportsService);
      expect(usersRawClient).toBe(usersClient);
      expect(reportsRawClient).toBe(reportsClient);
      expect(usersOptions).toEqual({ strictTransactions: true });
      expect(reportsOptions).toEqual({ strictTransactions: false });
      await expect(app.container.resolve(PrismaService)).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
