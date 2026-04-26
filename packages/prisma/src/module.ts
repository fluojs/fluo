import type { AsyncModuleOptions } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { PrismaService } from './service.js';
import { PRISMA_CLIENT, PRISMA_OPTIONS } from './tokens.js';
import { PrismaTransactionInterceptor } from './transaction.js';
import type {
  InferPrismaTransactionClient,
  InferPrismaTransactionOptions,
  PrismaClientLike,
  PrismaModuleOptions,
} from './types.js';

interface NormalizedPrismaModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
> {
  client: TClient;
  strictTransactions: boolean;
}

const PRISMA_NORMALIZED_OPTIONS = Symbol('fluo.prisma.normalized-options');
const PRISMA_MODULE_EXPORTS = [PrismaService, PrismaTransactionInterceptor];

function normalizePrismaModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
>(
  options: PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
): NormalizedPrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions> {
  return {
    client: options.client,
    strictTransactions: options.strictTransactions ?? false,
  };
}

function createPrismaRuntimeProviders<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
>(
  normalizedOptionsProvider: Provider,
): Provider[] {
  return [
    normalizedOptionsProvider,
    {
      inject: [PRISMA_NORMALIZED_OPTIONS],
      provide: PRISMA_CLIENT,
      useFactory: (options: unknown) =>
        (options as NormalizedPrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>).client,
    },
    {
      inject: [PRISMA_NORMALIZED_OPTIONS],
      provide: PRISMA_OPTIONS,
      useFactory: (options: unknown) => ({
        strictTransactions:
          (options as NormalizedPrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>).strictTransactions,
      }),
    },
    PrismaService,
    PrismaTransactionInterceptor,
  ];
}

function buildPrismaModule<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
>(
  options: PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
): ModuleType {
  class PrismaRootModuleDefinition {}

  return defineModule(PrismaRootModuleDefinition, {
    exports: PRISMA_MODULE_EXPORTS,
    providers: createPrismaRuntimeProviders<TClient, TTransactionClient, TTransactionOptions>({
      provide: PRISMA_NORMALIZED_OPTIONS,
      useValue: normalizePrismaModuleOptions(options),
    }),
  });
}

function buildPrismaModuleAsync<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
>(options: AsyncModuleOptions<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>>): ModuleType {
  class PrismaAsyncModuleDefinition {}

  const factory = options.useFactory;

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: PRISMA_NORMALIZED_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) =>
      normalizePrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>(await factory(...deps)),
  };

  return defineModule(PrismaAsyncModuleDefinition, {
    exports: PRISMA_MODULE_EXPORTS,
    providers: createPrismaRuntimeProviders<TClient, TTransactionClient, TTransactionOptions>(normalizedOptionsProvider),
  });
}

/**
 * Runtime module entrypoint for Prisma lifecycle and transaction wiring.
 */
export class PrismaModule {
  /**
   * Registers Prisma providers from static options.
   *
   * @param options Prisma module options with client handle and strict transaction mode.
   * @returns A module definition that exports `PrismaService` and `PrismaTransactionInterceptor`.
   */
  static forRoot<
    TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
    TTransactionClient = InferPrismaTransactionClient<TClient>,
    TTransactionOptions = InferPrismaTransactionOptions<TClient>,
  >(
    options: PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
  ): ModuleType {
    return buildPrismaModule<TClient, TTransactionClient, TTransactionOptions>(options);
  }

  /**
   * Registers Prisma providers from an async DI factory.
   *
   * @param options Async module options that resolve Prisma client/module configuration.
   * @returns A module definition that resolves async options once per application container.
   */
  static forRootAsync<
    TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
    TTransactionClient = InferPrismaTransactionClient<TClient>,
    TTransactionOptions = InferPrismaTransactionOptions<TClient>,
  >(
    options: AsyncModuleOptions<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>>,
  ): ModuleType {
    return buildPrismaModuleAsync<TClient, TTransactionClient, TTransactionOptions>(options);
  }
}
