import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { DrizzleDatabase } from './database.js';
import type { DrizzleAsyncModuleOptions } from './module.js';
import {
  createDrizzleRuntimeProviders,
  getNormalizedOptionsToken,
  getRegistrationGuardToken,
  type ResolvedDrizzleModuleOptions,
} from './registration-providers.js';
import { normalizeDrizzleRegistrationName } from './registration-name.js';
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

const DRIZZLE_MODULE_EXPORTS = [
  DrizzleDatabase,
  DrizzleTransactionInterceptor,
  DRIZZLE_HANDLE_PROVIDER,
  DRIZZLE_DATABASE,
  DRIZZLE_DISPOSE,
  DRIZZLE_OPTIONS,
];

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function assertNamedRegistrationIsScoped(name: string | undefined, global: boolean | undefined): void {
  if (name !== undefined && global) {
    throw new Error('Named Drizzle registrations are scoped and cannot be registered globally.');
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

function createDrizzleProvidersAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase,
  TTransactionOptions,
>(
  options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>,
  name: string | undefined,
): Provider[] {
  const registrationGuardToken = name === undefined ? undefined : getRegistrationGuardToken(name);
  const normalizedOptionsProvider = {
    inject: registrationGuardToken === undefined
      ? options.inject
      : [registrationGuardToken, ...(options.inject ?? [])],
    provide: getNormalizedOptionsToken(name),
    scope: 'singleton' as const,
    useFactory: async (...dependencies: unknown[]) =>
      normalizeDrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>({
        ...(await options.useFactory(...(registrationGuardToken === undefined ? dependencies : dependencies.slice(1)))),
        global: options.global,
        name,
      }),
  };

  return createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>(
    normalizedOptionsProvider,
    name,
  );
}

function getDrizzleModuleExports(name: string | undefined) {
  return name === undefined
    ? DRIZZLE_MODULE_EXPORTS
    : [
      getDrizzleDatabaseToken(name),
      getDrizzleDisposeToken(name),
      getDrizzleHandleProviderToken(name),
      getDrizzleOptionsToken(name),
    ];
}

export function buildDrizzleModule<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  const normalizedOptions = normalizeDrizzleModuleOptions(options);
  const name = normalizedOptions.name;
  class DrizzleRootModuleDefinition {}

  return defineModule(DrizzleRootModuleDefinition, {
    exports: getDrizzleModuleExports(name),
    global: normalizedOptions.global ?? false,
    providers: createDrizzleRuntimeProviders<TDatabase, TTransactionDatabase, TTransactionOptions>({
      provide: getNormalizedOptionsToken(name),
      useValue: normalizedOptions,
    }, name),
  });
}

export function buildDrizzleModuleAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  const name = normalizeDrizzleRegistrationName(options.name);
  assertNamedRegistrationIsScoped(name, options.global);
  class DrizzleAsyncModuleDefinition {}

  return defineModule(DrizzleAsyncModuleDefinition, {
    exports: getDrizzleModuleExports(name),
    global: name === undefined ? options.global ?? false : false,
    providers: createDrizzleProvidersAsync(options, name),
  });
}
