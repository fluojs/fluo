import type { AsyncModuleOptions, Token } from '@fluojs/core';
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
  global: boolean;
  strictTransactions: boolean;
}

type PrismaAsyncModuleOptions<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
> = AsyncModuleOptions<Omit<PrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>, 'global' | 'name'>> & {
  global?: boolean;
  name?: string;
};

const PRISMA_NORMALIZED_OPTIONS = Symbol('fluo.prisma.normalized-options');

type PrismaRuntimeOptions = {
  strictTransactions: boolean;
};

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function normalizePrismaRegistrationName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  if (typeof name !== 'string') {
    throw new Error('PrismaModule name must be a string when provided.');
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
  if (!isObjectLike(options.client)) {
    throw new Error('PrismaModule requires a client option.');
  }

  return {
    name: normalizePrismaRegistrationName(options.name),
    client: options.client,
    global: options.global ?? false,
    strictTransactions: options.strictTransactions ?? false,
  };
}

function createPrismaServiceProvider<
  TClient extends PrismaClientLike<TTransactionClient, TTransactionOptions>,
  TTransactionClient,
  TTransactionOptions,
>(provide: Token, clientToken: Token, optionsToken: Token): Provider {
  return {
    inject: [clientToken, optionsToken],
    provide,
    useFactory: (client: unknown, serviceOptions: unknown) =>
      PrismaService.createFacade<TClient, TTransactionClient, TTransactionOptions>(
        client as TClient,
        serviceOptions as PrismaRuntimeOptions,
      ),
  };
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
        createPrismaServiceProvider<TClient, TTransactionClient, TTransactionOptions>(
          PrismaService,
          clientToken,
          optionsToken,
        ),
        {
          provide: getPrismaServiceToken(),
          useExisting: PrismaService,
        },
        PrismaTransactionInterceptor,
      ]
      : [
        createPrismaServiceProvider<TClient, TTransactionClient, TTransactionOptions>(
          getPrismaServiceToken(name),
          clientToken,
          optionsToken,
        ),
      ]),
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

  if (normalizedOptions.name !== undefined && normalizedOptions.global) {
    throw new Error('Named Prisma registrations are scoped and cannot be registered globally.');
  }

  return defineModule(PrismaRootModuleDefinition, {
    exports: normalizedOptions.name === undefined
      ? [
        PrismaService,
        PrismaTransactionInterceptor,
        getPrismaServiceToken(),
        getPrismaClientToken(),
        getPrismaOptionsToken(),
      ]
      : [
        getPrismaServiceToken(normalizedOptions.name),
        getPrismaClientToken(normalizedOptions.name),
        getPrismaOptionsToken(normalizedOptions.name),
      ],
    global: normalizedOptions.name === undefined ? normalizedOptions.global : false,
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
  options: PrismaAsyncModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
): ModuleType {
  class PrismaAsyncModuleDefinition {}

  const factory = options.useFactory;
  const normalizedName = normalizePrismaRegistrationName(options.name);

  if (normalizedName !== undefined && options.global) {
    throw new Error('Named Prisma registrations are scoped and cannot be registered globally.');
  }

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: getPrismaNormalizedOptionsToken(normalizedName),
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolvedOptions = await factory(...deps);

      return normalizePrismaModuleOptions<TClient, TTransactionClient, TTransactionOptions>({
        ...resolvedOptions,
        global: options.global,
        name: normalizedName,
      });
    },
  };

  return defineModule(PrismaAsyncModuleDefinition, {
    exports: normalizedName === undefined
      ? [
        PrismaService,
        PrismaTransactionInterceptor,
        getPrismaServiceToken(),
        getPrismaClientToken(),
        getPrismaOptionsToken(),
      ]
      : [getPrismaServiceToken(normalizedName), getPrismaClientToken(normalizedName), getPrismaOptionsToken(normalizedName)],
    global: normalizedName === undefined ? options.global ?? false : false,
    providers: createPrismaRuntimeProviders<TClient, TTransactionClient, TTransactionOptions>(normalizedOptionsProvider, normalizedName),
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
   * @returns A module definition that exports `PrismaService`, compatibility interceptor, and related Prisma tokens.
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
    options: PrismaAsyncModuleOptions<TClient, TTransactionClient, TTransactionOptions>,
  ): ModuleType {
    return buildPrismaModuleAsync<TClient, TTransactionClient, TTransactionOptions>(options);
  }
}
