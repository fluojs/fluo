import type { Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';

import { DrizzleDatabase } from './database.js';
import {
  getDrizzleDatabaseToken,
  getDrizzleDisposeToken,
  getDrizzleHandleProviderToken,
  getDrizzleOptionsToken,
} from './tokens.js';
import { DrizzleTransactionInterceptor } from './transaction.js';
import type { DrizzleDatabaseLike, DrizzleModuleOptions } from './types.js';

/**
 * Normalized runtime options consumed by lifecycle-aware Drizzle providers.
 *
 * @internal
 */
export type DrizzleRuntimeOptions = {
  strictTransactions: boolean;
};

/**
 * Fully normalized module options stored behind an internal registration token.
 *
 * @internal
 */
export type ResolvedDrizzleModuleOptions<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
> = Omit<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'strictTransactions'> & {
  strictTransactions: boolean;
};

const DRIZZLE_NORMALIZED_OPTIONS = Symbol('fluo.drizzle.normalized-options');
const DRIZZLE_REGISTRATION_IDENTITIES = Symbol.for('fluo.drizzle.registration-identities');

/**
 * Returns the internal options token for a default or named registration.
 *
 * @internal
 * @param name Optional normalized registration name.
 * @returns The internal token that stores normalized module options.
 */
export function getNormalizedOptionsToken(name?: string): symbol {
  return name === undefined
    ? DRIZZLE_NORMALIZED_OPTIONS
    : Symbol.for(`fluo.drizzle.normalized-options:${name}`);
}

/**
 * Returns the globally stable duplicate-registration guard token for a name.
 *
 * @internal
 * @param name Normalized named-registration identity.
 * @returns The guard token shared by registrations using the same name.
 */
export function getRegistrationGuardToken(name: string): symbol {
  return Symbol.for(`fluo.drizzle.registration-guard:${name}`);
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

function createRuntimeOptionsProviderValue(strictTransactions: boolean): DrizzleRuntimeOptions {
  return { strictTransactions };
}

/**
 * Builds the provider graph for a default or named Drizzle registration.
 *
 * @internal
 * @param normalizedOptionsProvider Provider that supplies normalized module options.
 * @param name Optional normalized registration name.
 * @returns Providers for the registration's raw handle, lifecycle wrapper, options, and disposal hook.
 */
export function createDrizzleRuntimeProviders<
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
  const registrationGuardToken = name === undefined ? undefined : getRegistrationGuardToken(name);
  const registrationProviders: Provider[] = registrationGuardToken === undefined
    ? []
    : [
      {
        multi: true,
        provide: DRIZZLE_REGISTRATION_IDENTITIES,
        useValue: name,
      },
      {
        inject: [DRIZZLE_REGISTRATION_IDENTITIES],
        provide: registrationGuardToken,
        scope: 'singleton',
        useFactory: (identities: unknown) => {
          assertUniqueDrizzleRegistrationIdentities(identities as readonly string[]);
        },
      },
    ];
  const withRegistrationGuard = (dependencies: readonly Token[]): Token[] =>
    registrationGuardToken === undefined
      ? [...dependencies]
      : [registrationGuardToken, ...dependencies];

  return [
    ...registrationProviders,
    normalizedOptionsProvider,
    {
      inject: withRegistrationGuard([normalizedOptionsToken]),
      provide: databaseToken,
      useFactory: (...dependencies: unknown[]) => {
        const options = dependencies.at(-1) as ResolvedDrizzleModuleOptions<
          TDatabase,
          TTransactionDatabase,
          TTransactionOptions
        >;

        return options.database;
      },
    },
    {
      inject: withRegistrationGuard([normalizedOptionsToken]),
      provide: disposeToken,
      useFactory: (...dependencies: unknown[]) => {
        const options = dependencies.at(-1) as ResolvedDrizzleModuleOptions<
          TDatabase,
          TTransactionDatabase,
          TTransactionOptions
        >;

        return options.dispose;
      },
    },
    {
      inject: withRegistrationGuard([normalizedOptionsToken]),
      provide: optionsToken,
      useFactory: (...dependencies: unknown[]) => {
        const options = dependencies.at(-1) as ResolvedDrizzleModuleOptions<
          TDatabase,
          TTransactionDatabase,
          TTransactionOptions
        >;

        return createRuntimeOptionsProviderValue(options.strictTransactions);
      },
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
          inject: withRegistrationGuard([databaseToken, disposeToken, optionsToken]),
          provide: handleProviderToken,
          useFactory: (...dependencies: unknown[]) => {
            const [database, dispose, databaseOptions] = dependencies.slice(-3);

            return DrizzleDatabase.createFacade<TDatabase, TTransactionDatabase, TTransactionOptions>(
              database as TDatabase,
              dispose as ((database: TDatabase) => Promise<void> | void) | undefined,
              databaseOptions as DrizzleRuntimeOptions,
            );
          },
        },
      ]),
  ];
}
