import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  getPrismaServiceToken,
  PRISMA_CLIENT,
  PRISMA_OPTIONS,
  PrismaModule,
  PrismaService,
  PrismaTransactionInterceptor,
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

    @Inject(PrismaService, PrismaTransactionInterceptor)
    class ProviderConsumer {
      constructor(
        readonly prisma: PrismaService<typeof client, typeof transactionClient>,
        readonly interceptor: PrismaTransactionInterceptor,
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
    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const providerConsumer = await app.container.resolve(ProviderConsumer);
      const tokenConsumer = await app.container.resolve(TokenConsumer);

      // Then
      expect(providerConsumer.prisma.current()).toBe(client);
      expect(providerConsumer.interceptor).toBeInstanceOf(PrismaTransactionInterceptor);
      expect(tokenConsumer.rawClient).toBe(client);
      expect(tokenConsumer.options).toEqual({ strictTransactions: false });
      expect(tokenConsumer.prisma).toBe(providerConsumer.prisma);
      expect(events).toEqual(['connect']);
    } finally {
      await app.close();
    }

    expect(events).toEqual(['connect', 'disconnect']);
  });
});
