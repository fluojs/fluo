import type { AsyncModuleOptions } from '@konekti/core';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { DrizzleDatabase } from './database.js';
import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS } from './tokens.js';
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

const DRIZZLE_NORMALIZED_OPTIONS = Symbol('konekti.drizzle.normalized-options');
const DRIZZLE_MODULE_EXPORTS = [DrizzleDatabase, DrizzleTransactionInterceptor];

function normalizeDrizzleModuleOptions<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>,
): ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions> {
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
    DrizzleTransactionInterceptor,
  ];
}

function createMemoizedDrizzleOptionsResolver<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: AsyncModuleOptions<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>>,
): (...deps: unknown[]) => Promise<ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>> {
  let cachedResult: Promise<ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>> | undefined;

  return (...deps: unknown[]) => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(options.useFactory(...deps)).then((resolved) =>
        normalizeDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>(resolved),
      );
    }

    if (!cachedResult) {
      throw new Error('Drizzle module options resolver initialization failed.');
    }

    return cachedResult;
  };
}

function createDrizzleProvidersAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: AsyncModuleOptions<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>>,
): Provider[] {
  const resolveOptions = createMemoizedDrizzleOptionsResolver(options);

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: DRIZZLE_NORMALIZED_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => resolveOptions(...deps),
  };

  return createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>(normalizedOptionsProvider);
}

/**
 * Creates Drizzle providers for manual module composition.
 *
 * @param options Drizzle module options with a database handle, optional dispose hook, and strict transaction policy.
 * @returns Provider definitions equivalent to `DrizzleModule.forRoot(...)`.
 */
export function createDrizzleProviders<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): Provider[] {
  const resolved = normalizeDrizzleModuleOptions(options);

  return createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>({
    provide: DRIZZLE_NORMALIZED_OPTIONS,
    useValue: resolved,
  });
}

function buildDrizzleModule<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  class DrizzleRootModuleDefinition {}

  return defineModule(DrizzleRootModuleDefinition, {
    exports: DRIZZLE_MODULE_EXPORTS,
    providers: createDrizzleProviders(options),
  });
}

function buildDrizzleModuleAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: AsyncModuleOptions<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>>): ModuleType {
  class DrizzleAsyncModuleDefinition {}

  return defineModule(DrizzleAsyncModuleDefinition, {
    exports: DRIZZLE_MODULE_EXPORTS,
    providers: createDrizzleProvidersAsync(options),
  });
}

/**
 * Module entrypoint for wiring a Drizzle database into the Konekti runtime lifecycle.
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
  >(options: AsyncModuleOptions<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>>): ModuleType {
    return buildDrizzleModuleAsync<TDatabase, TTransactionDatabase, TTransactionOptions>(options);
  }
}
