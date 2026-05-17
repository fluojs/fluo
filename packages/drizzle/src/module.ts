import type { AsyncModuleOptions } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { DrizzleDatabase } from './database.js';
import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_HANDLE_PROVIDER, DRIZZLE_OPTIONS } from './tokens.js';
import { DrizzleTransactionInterceptor } from './transaction.js';
import type { DrizzleDatabaseLike, DrizzleModuleOptions } from './types.js';

type DrizzleRuntimeOptions = {
  strictTransactions: boolean;
};

type ResolvedDrizzleModuleOptions<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
> = Omit<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'strictTransactions'> & {
  strictTransactions: boolean;
};

type DrizzleAsyncModuleOptions<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
> = AsyncModuleOptions<Omit<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'global'>> &
  Pick<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'global'>;

const DRIZZLE_NORMALIZED_OPTIONS = Symbol('fluo.drizzle.normalized-options');
const DRIZZLE_MODULE_EXPORTS = [DrizzleDatabase, DrizzleTransactionInterceptor, DRIZZLE_HANDLE_PROVIDER];

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function normalizeDrizzleModuleOptions<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>,
): ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions> {
  if (!isObjectLike(options.database)) {
    throw new Error('DrizzleModule requires a database option.');
  }

  return {
    ...options,
    strictTransactions: options.strictTransactions ?? false,
  };
}

function createRuntimeOptionsProviderValue(strictTransactions: boolean): DrizzleRuntimeOptions {
  return { strictTransactions };
}

function createDrizzleRuntimeProviders<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(normalizedOptionsProvider: Provider): Provider[] {
  return [
    normalizedOptionsProvider,
    {
      inject: [DRIZZLE_NORMALIZED_OPTIONS],
      provide: DRIZZLE_DATABASE,
      useFactory: (options: unknown) =>
        (options as ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>).database,
    },
    {
      inject: [DRIZZLE_NORMALIZED_OPTIONS],
      provide: DRIZZLE_DISPOSE,
      useFactory: (options: unknown) =>
        (options as ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>).dispose,
    },
    {
      inject: [DRIZZLE_NORMALIZED_OPTIONS],
      provide: DRIZZLE_OPTIONS,
      useFactory: (options: unknown) =>
        createRuntimeOptionsProviderValue(
          (options as ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>).strictTransactions,
        ),
    },
    DrizzleDatabase,
    {
      provide: DRIZZLE_HANDLE_PROVIDER,
      useExisting: DrizzleDatabase,
    },
    DrizzleTransactionInterceptor,
  ];
}

function createDrizzleProvidersAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>,
): Provider[] {
  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: DRIZZLE_NORMALIZED_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) =>
      normalizeDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>(
        {
          ...(await options.useFactory(...deps)),
          global: options.global,
        },
      ),
  };

  return createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>(normalizedOptionsProvider);
}

function buildDrizzleModule<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  class DrizzleRootModuleDefinition {}

  return defineModule(DrizzleRootModuleDefinition, {
    exports: DRIZZLE_MODULE_EXPORTS,
    global: options.global ?? false,
    providers: createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>({
      provide: DRIZZLE_NORMALIZED_OPTIONS,
      useValue: normalizeDrizzleModuleOptions(options),
    }),
  });
}

function buildDrizzleModuleAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  class DrizzleAsyncModuleDefinition {}

  return defineModule(DrizzleAsyncModuleDefinition, {
    exports: DRIZZLE_MODULE_EXPORTS,
    global: options.global ?? false,
    providers: createDrizzleProvidersAsync(options),
  });
}

/**
 * Module entrypoint for wiring a Drizzle database into the Fluo runtime lifecycle.
 */
export class DrizzleModule {
  /** Creates a module definition from static Drizzle options. */
  static forRoot<
    TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = TDatabase,
    TTransactionOptions = unknown,
  >(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
    return buildDrizzleModule<TDatabase, TTransactionDatabase, TTransactionOptions>(options);
  }

  /** Creates a module definition from DI-aware async Drizzle options. */
  static forRootAsync<
    TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = TDatabase,
    TTransactionOptions = unknown,
  >(options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
    return buildDrizzleModuleAsync<TDatabase, TTransactionDatabase, TTransactionOptions>(options);
  }
}
