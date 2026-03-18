import { type AsyncModuleOptions, type MaybePromise } from '@konekti/core';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { PrismaService } from './service.js';
import { PRISMA_CLIENT, PRISMA_OPTIONS } from './tokens.js';
import { PrismaTransactionInterceptor } from './transaction.js';
import type { PrismaClientLike, PrismaModuleOptions, PrismaTransactionClient } from './types.js';

export function createPrismaProviders<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): Provider[] {
  return [
    {
      provide: PRISMA_CLIENT,
      useValue: options.client,
    },
    {
      provide: PRISMA_OPTIONS,
      useValue: { strictTransactions: options.strictTransactions ?? false },
    },
    PrismaService,
    PrismaTransactionInterceptor,
  ];
}

export function createPrismaModule<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): ModuleType {
  class PrismaModule {}

  return defineModule(PrismaModule, {
    exports: [PrismaService, PrismaTransactionInterceptor],
    providers: createPrismaProviders(options),
  });
}

export function createPrismaModuleAsync<
  TClient extends PrismaClientLike<TTransactionClient>,
  TTransactionClient = PrismaTransactionClient,
>(options: AsyncModuleOptions<PrismaModuleOptions<TClient, TTransactionClient>>): ModuleType {
  class PrismaAsyncModule {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<PrismaModuleOptions<TClient, TTransactionClient>>;

  let cachedResult: Promise<PrismaModuleOptions<TClient, TTransactionClient>> | undefined;
  const memoizedFactory = (...deps: unknown[]): Promise<PrismaModuleOptions<TClient, TTransactionClient>> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps));
    }
    return cachedResult;
  };

  const clientProvider = {
    inject: options.inject,
    provide: PRISMA_CLIENT,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolved = await memoizedFactory(...deps);
      return resolved.client;
    },
  };

  const optionsProvider = {
    inject: options.inject,
    provide: PRISMA_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolved = await memoizedFactory(...deps);
      return { strictTransactions: resolved.strictTransactions ?? false };
    },
  };

  return defineModule(PrismaAsyncModule, {
    exports: [PrismaService, PrismaTransactionInterceptor],
    providers: [clientProvider, optionsProvider, PrismaService, PrismaTransactionInterceptor],
  });
}
