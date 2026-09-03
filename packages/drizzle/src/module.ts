import type { AsyncModuleOptions } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { DrizzleDatabase } from './database.js';
import {
  DRIZZLE_DATABASE,
  DRIZZLE_DISPOSE,
  DRIZZLE_HANDLE_PROVIDER,
  DRIZZLE_OPTIONS,
  getDrizzleDatabaseToken,
  getDrizzleDisposeToken,
  getDrizzleHandleProviderToken,
  getDrizzleOptionsToken,
} from './tokens.js';
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

/**
 * Configures an async Drizzle module registration through an injected factory.
 *
 * @typeParam TDatabase Root Drizzle database handle registered in the module.
 * @typeParam TTransactionDatabase Transaction-scoped database handle resolved inside transaction callbacks.
 * @typeParam TTransactionOptions Options forwarded to the underlying Drizzle transaction runner.
 */
export type DrizzleAsyncModuleOptions<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
> = AsyncModuleOptions<Omit<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'global' | 'name'>> &
  Pick<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'global' | 'name'>;

const DRIZZLE_NORMALIZED_OPTIONS = Symbol('fluo.drizzle.normalized-options');
const DRIZZLE_REGISTRATION_IDENTITIES = Symbol('fluo.drizzle.registration-identities');
const DRIZZLE_MODULE_EXPORTS = [
  DrizzleDatabase,
  DrizzleTransactionInterceptor,
  DRIZZLE_HANDLE_PROVIDER,
  DRIZZLE_DATABASE,
  DRIZZLE_DISPOSE,
  DRIZZLE_OPTIONS,
];

function getNormalizedOptionsToken(name?: string): symbol {
  return name === undefined
    ? DRIZZLE_NORMALIZED_OPTIONS
    : Symbol.for(`fluo.drizzle.normalized-options:${name}`);
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function normalizeDrizzleRegistrationName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw new Error('DrizzleModule name must be a non-empty string when provided.');
  }

  return normalizedName;
}

function assertNamedRegistrationIsScoped(name: string | undefined, global: boolean | undefined): void {
  if (name !== undefined && global) {
    throw new Error('Named Drizzle registrations are scoped and cannot be registered globally.');
  }
}

function assertUniqueDrizzleRegistrationIdentities(identities: readonly string[]): void {
  const seen = new Set<string>();

  for (const identity of identities) {
    if (seen.has(identity)) {
      throw new Error(
        `Duplicate @fluojs/drizzle registration identity "${identity}". Every named DrizzleModule.forRoot(...) registration owns one lifecycle-managed database, so pass a distinct name to each additional registration.`,
      );
    }

    seen.add(identity);
  }
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

  const name = normalizeDrizzleRegistrationName(options.name);
  assertNamedRegistrationIsScoped(name, options.global);

  return {
    ...options,
    global: name === undefined ? options.global : false,
    name,
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
>(
  normalizedOptionsProvider: Provider,
  name?: string,
): Provider[] {
  const normalizedOptionsToken = getNormalizedOptionsToken(name);
  const databaseToken = getDrizzleDatabaseToken(name);
  const disposeToken = getDrizzleDisposeToken(name);
  const optionsToken = getDrizzleOptionsToken(name);
  const handleProviderToken = getDrizzleHandleProviderToken(name);
  const registrationGuardToken = name === undefined
    ? undefined
    : Symbol(`fluo.drizzle.registration-guard:${name}`);
  const registrationProviders: Provider[] = name === undefined
    ? []
    : [
      {
        multi: true,
        provide: DRIZZLE_REGISTRATION_IDENTITIES,
        useValue: name,
      },
      {
        inject: [DRIZZLE_REGISTRATION_IDENTITIES],
        provide: registrationGuardToken!,
        scope: 'singleton',
        useFactory: (identities: unknown) => {
          assertUniqueDrizzleRegistrationIdentities(identities as readonly string[]);
        },
      },
    ];
  const databaseDependencies = registrationGuardToken === undefined
    ? [normalizedOptionsToken]
    : [normalizedOptionsToken, registrationGuardToken];

  return [
    ...registrationProviders,
    normalizedOptionsProvider,
    {
      inject: databaseDependencies,
      provide: databaseToken,
      useFactory: (options: unknown) =>
        (options as ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>).database,
    },
    {
      inject: [normalizedOptionsToken],
      provide: disposeToken,
      useFactory: (options: unknown) =>
        (options as ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>).dispose,
    },
    {
      inject: [normalizedOptionsToken],
      provide: optionsToken,
      useFactory: (options: unknown) =>
        createRuntimeOptionsProviderValue(
          (options as ResolvedDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>).strictTransactions,
        ),
    },
    ...(name === undefined
      ? [
        {
          inject: [databaseToken, disposeToken, optionsToken],
          provide: DrizzleDatabase,
          useFactory: (database: unknown, dispose: unknown, databaseOptions: unknown) =>
            DrizzleDatabase.createFacade<TDatabase, TTransactionDatabase, TTransactionOptions>(
              database as TDatabase,
              dispose as ((database: TDatabase) => Promise<void> | void) | undefined,
              databaseOptions as DrizzleRuntimeOptions,
            ),
        },
        {
          provide: handleProviderToken,
          useExisting: DrizzleDatabase,
        },
        DrizzleTransactionInterceptor,
      ]
      : [
        {
          inject: [databaseToken, disposeToken, optionsToken],
          provide: handleProviderToken,
          useFactory: (database: unknown, dispose: unknown, databaseOptions: unknown) =>
            DrizzleDatabase.createFacade<TDatabase, TTransactionDatabase, TTransactionOptions>(
              database as TDatabase,
              dispose as ((database: TDatabase) => Promise<void> | void) | undefined,
              databaseOptions as DrizzleRuntimeOptions,
            ),
        },
      ]),
  ];
}

function createDrizzleProvidersAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>,
  name: string | undefined,
): Provider[] {
  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: getNormalizedOptionsToken(name),
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) =>
      normalizeDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>(
        {
          ...(await options.useFactory(...deps)),
          global: options.global,
          name,
        },
      ),
  };

  return createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>(
    normalizedOptionsProvider,
    name,
  );
}

function buildDrizzleModule<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  const normalizedOptions = normalizeDrizzleModuleOptions(options);
  const name = normalizedOptions.name;
  class DrizzleRootModuleDefinition {}

  return defineModule(DrizzleRootModuleDefinition, {
    exports: name === undefined
      ? DRIZZLE_MODULE_EXPORTS
      : [
        getDrizzleDatabaseToken(name),
        getDrizzleDisposeToken(name),
        getDrizzleHandleProviderToken(name),
        getDrizzleOptionsToken(name),
      ],
    global: normalizedOptions.global ?? false,
    providers: createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>({
      provide: getNormalizedOptionsToken(name),
      useValue: normalizedOptions,
    }, name),
  });
}

function buildDrizzleModuleAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  const name = normalizeDrizzleRegistrationName(options.name);
  assertNamedRegistrationIsScoped(name, options.global);
  class DrizzleAsyncModuleDefinition {}

  return defineModule(DrizzleAsyncModuleDefinition, {
    exports: name === undefined
      ? DRIZZLE_MODULE_EXPORTS
      : [
        getDrizzleDatabaseToken(name),
        getDrizzleDisposeToken(name),
        getDrizzleHandleProviderToken(name),
        getDrizzleOptionsToken(name),
      ],
    global: name === undefined ? options.global ?? false : false,
    providers: createDrizzleProvidersAsync(options, name),
  });
}

/**
 * Module entrypoint for wiring a Drizzle database into the Fluo runtime lifecycle.
 */
export class DrizzleModule {
  /**
   * Creates a module definition from static Drizzle options.
   *
   * @param options Static Drizzle registration options.
   * @returns A runtime module definition for the requested Drizzle registration.
   */
  static forRoot<
    TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = TDatabase,
    TTransactionOptions = unknown,
  >(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
    return buildDrizzleModule<TDatabase, TTransactionDatabase, TTransactionOptions>(options);
  }

  /**
   * Creates a module definition from DI-aware async Drizzle options.
   *
   * @param options Async Drizzle registration options.
   * @returns A runtime module definition for the requested Drizzle registration.
   */
  static forRootAsync<
    TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = TDatabase,
    TTransactionOptions = unknown,
  >(options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
    return buildDrizzleModuleAsync<TDatabase, TTransactionDatabase, TTransactionOptions>(options);
  }
}
