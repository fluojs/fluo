import { type AsyncModuleOptions, type MaybePromise } from '@konekti/core';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { PrismaService } from './service.js';
import { PRISMA_CLIENT, PRISMA_OPTIONS } from './tokens.js';
import { PrismaTransactionInterceptor } from './transaction.js';
import type { PrismaClientLike, PrismaModuleOptions } from './types.js';

interface NormalizedPrismaModuleOptions<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient> {
  client: TClient;
  strictTransactions: boolean;
}

const PRISMA_NORMALIZED_OPTIONS = Symbol('konekti.prisma.normalized-options');
const PRISMA_MODULE_EXPORTS = [PrismaService, PrismaTransactionInterceptor];

function normalizePrismaModuleOptions<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): NormalizedPrismaModuleOptions<TClient, TTransactionClient> {
  return {
    client: options.client,
    strictTransactions: options.strictTransactions ?? false,
  };
}

function createPrismaRuntimeProviders<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient>(
  normalizedOptionsProvider: Provider,
): Provider[] {
  return [
    normalizedOptionsProvider,
    {
      inject: [PRISMA_NORMALIZED_OPTIONS],
      provide: PRISMA_CLIENT,
      useFactory: (options: unknown) => (options as NormalizedPrismaModuleOptions<TClient, TTransactionClient>).client,
    },
    {
      inject: [PRISMA_NORMALIZED_OPTIONS],
      provide: PRISMA_OPTIONS,
      useFactory: (options: unknown) => ({
        strictTransactions: (options as NormalizedPrismaModuleOptions<TClient, TTransactionClient>).strictTransactions,
      }),
    },
    PrismaService,
    PrismaTransactionInterceptor,
  ];
}

export function createPrismaProviders<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): Provider[] {
  return createPrismaRuntimeProviders({
    provide: PRISMA_NORMALIZED_OPTIONS,
    useValue: normalizePrismaModuleOptions(options),
  });
}

export function createPrismaModule<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): ModuleType {
  class PrismaModule {}

  return defineModule(PrismaModule, {
    exports: PRISMA_MODULE_EXPORTS,
    providers: createPrismaProviders(options),
  });
}

export function createPrismaModuleAsync<
  TClient extends PrismaClientLike<TTransactionClient>,
  TTransactionClient = TClient,
>(options: AsyncModuleOptions<PrismaModuleOptions<TClient, TTransactionClient>>): ModuleType {
  class PrismaAsyncModule {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<PrismaModuleOptions<TClient, TTransactionClient>>;

  let cachedResult: Promise<NormalizedPrismaModuleOptions<TClient, TTransactionClient>> | undefined;
  const memoizedFactory = (...deps: unknown[]): Promise<NormalizedPrismaModuleOptions<TClient, TTransactionClient>> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps)).then((resolved) => normalizePrismaModuleOptions(resolved));
    }
    return cachedResult;
  };

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: PRISMA_NORMALIZED_OPTIONS,
    scope: 'singleton' as const,
    useFactory: (...deps: unknown[]) => memoizedFactory(...deps),
  };

  return defineModule(PrismaAsyncModule, {
    exports: PRISMA_MODULE_EXPORTS,
    providers: createPrismaRuntimeProviders(normalizedOptionsProvider),
  });
}
