import { Inject, type AsyncModuleOptions, type Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { PrismaService } from './service.js';
import {
  getPrismaClientToken,
  getPrismaOptionsToken,
  getPrismaServiceToken,
} from './tokens.js';
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
  name?: string;
  client: TClient;
  strictTransactions: boolean;
}

const PRISMA_NORMALIZED_OPTIONS = Symbol('fluo.prisma.normalized-options');

function normalizePrismaRegistrationName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new Error('PrismaModule name must be a non-empty string when provided.');
  }

  return normalizedName;
}

function getPrismaNormalizedOptionsToken(name?: string): Token {
  const normalizedName = normalizePrismaRegistrationName(name);

  return normalizedName === undefined
    ? PRISMA_NORMALIZED_OPTIONS
    : Symbol.for(`fluo.prisma.normalized-options:${normalizedName}`);
}

function normalizePrismaModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
>(
  options: PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
): NormalizedPrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions> {
  return {
    name: normalizePrismaRegistrationName(options.name),
    client: options.client,
    strictTransactions: options.strictTransactions ?? false,
  };
}

function createNamedPrismaServiceProvider<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
>(name: string): Provider[] {
  const clientToken = getPrismaClientToken(name);
  const optionsToken = getPrismaOptionsToken(name);
  const serviceToken = getPrismaServiceToken(name);

  class NamedPrismaService extends PrismaService<TClient, TTransactionClient, TTransactionOptions> {}

  Inject(clientToken, optionsToken)(NamedPrismaService, {} as ClassDecoratorContext);

  return [
    NamedPrismaService,
    {
      provide: serviceToken,
      useExisting: NamedPrismaService,
    },
  ];
}

function createPrismaRuntimeProviders<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
>(
  normalizedOptionsProvider: Provider,
  name?: string,
): Provider[] {
  const normalizedOptionsToken = getPrismaNormalizedOptionsToken(name);
  const clientToken = getPrismaClientToken(name);
  const optionsToken = getPrismaOptionsToken(name);

  return [
    normalizedOptionsProvider,
    {
      inject: [normalizedOptionsToken],
      provide: clientToken,
      useFactory: (options: unknown) =>
        (options as NormalizedPrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>).client,
    },
    {
      inject: [normalizedOptionsToken],
      provide: optionsToken,
      useFactory: (options: unknown) => ({
        strictTransactions:
          (options as NormalizedPrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>).strictTransactions,
      }),
    },
    ...(name === undefined
      ? [
        PrismaService,
        {
          provide: getPrismaServiceToken(),
          useExisting: PrismaService,
        },
        PrismaTransactionInterceptor,
      ]
      : createNamedPrismaServiceProvider<TClient, TTransactionClient, TTransactionOptions>(name)),
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
  const normalizedOptions = normalizePrismaModuleOptions(options);

  return defineModule(PrismaRootModuleDefinition, {
    exports: normalizedOptions.name === undefined
      ? [PrismaService, PrismaTransactionInterceptor, getPrismaServiceToken(), getPrismaClientToken(), getPrismaOptionsToken()]
      : [
        getPrismaServiceToken(normalizedOptions.name),
        getPrismaClientToken(normalizedOptions.name),
        getPrismaOptionsToken(normalizedOptions.name),
      ],
    providers: createPrismaRuntimeProviders<TClient, TTransactionClient, TTransactionOptions>({
      provide: getPrismaNormalizedOptionsToken(normalizedOptions.name),
      useValue: normalizedOptions,
    }, normalizedOptions.name),
  });
}

function buildPrismaModuleAsync<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient = InferPrismaTransactionClient<TClient>,
  TTransactionOptions = InferPrismaTransactionOptions<TClient>,
>(
  options: AsyncModuleOptions<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>> & { name?: string },
): ModuleType {
  class PrismaAsyncModuleDefinition {}

  const factory = options.useFactory;
  const normalizedName = normalizePrismaRegistrationName(options.name);

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: getPrismaNormalizedOptionsToken(normalizedName),
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolvedOptions = await factory(...deps);

      return normalizePrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>({
        ...resolvedOptions,
        name: resolvedOptions.name ?? normalizedName,
      });
    },
  };

  return defineModule(PrismaAsyncModuleDefinition, {
    exports: normalizedName === undefined
      ? [PrismaService, PrismaTransactionInterceptor, getPrismaServiceToken(), getPrismaClientToken(), getPrismaOptionsToken()]
      : [getPrismaServiceToken(normalizedName), getPrismaClientToken(normalizedName), getPrismaOptionsToken(normalizedName)],
    providers: createPrismaRuntimeProviders<TClient, TTransactionClient, TTransactionOptions>(normalizedOptionsProvider, normalizedName),
  });
}

/**
 * Runtime module entrypoint for Prisma lifecycle and transaction wiring.
 */
export class PrismaModule {
  /**
   * Registers Prisma providers from static options under an explicit name.
   *
   * @param name Registration name used to generate isolated Prisma DI tokens.
   * @param options Prisma module options with client handle and strict transaction mode.
   * @returns A module definition that exports the named Prisma tokens.
   */
  static forName<
    TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
    TTransactionClient = InferPrismaTransactionClient<TClient>,
    TTransactionOptions = InferPrismaTransactionOptions<TClient>,
  >(
    name: string,
    options: Omit<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>, 'name'>,
  ): ModuleType {
    return buildPrismaModule<TClient, TTransactionClient, TTransactionOptions>({
      ...options,
      name,
    });
  }

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
   * Registers Prisma providers from an async DI factory under an explicit name.
   *
   * @param name Registration name used to generate isolated Prisma DI tokens.
   * @param options Async module options that resolve Prisma client/module configuration.
   * @returns A module definition that resolves async options once per application container.
   */
  static forNameAsync<
    TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
    TTransactionClient = InferPrismaTransactionClient<TClient>,
    TTransactionOptions = InferPrismaTransactionOptions<TClient>,
  >(
    name: string,
    options: AsyncModuleOptions<Omit<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>, 'name'>>,
  ): ModuleType {
    return buildPrismaModuleAsync<TClient, TTransactionClient, TTransactionOptions>({
      ...options,
      name,
    });
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
    options: AsyncModuleOptions<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>> & { name?: string },
  ): ModuleType {
    return buildPrismaModuleAsync<TClient, TTransactionClient, TTransactionOptions>(options);
  }
}
