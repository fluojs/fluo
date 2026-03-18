import { type AsyncModuleOptions, type MaybePromise } from '@konekti/core';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { DrizzleDatabase } from './database.js';
import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE, DRIZZLE_OPTIONS } from './tokens.js';
import { DrizzleTransactionInterceptor } from './transaction.js';
import type { DrizzleDatabaseLike, DrizzleModuleOptions } from './types.js';

export function createDrizzleProviders<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): Provider[] {
  return [
    {
      provide: DRIZZLE_DATABASE,
      useValue: options.database,
    },
    {
      provide: DRIZZLE_DISPOSE,
      useValue: options.dispose,
    },
    {
      provide: DRIZZLE_OPTIONS,
      useValue: { strictTransactions: options.strictTransactions ?? false },
    },
    DrizzleDatabase,
    DrizzleTransactionInterceptor,
  ];
}

export function createDrizzleModule<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = TDatabase,
  TTransactionOptions = unknown,
>(options: DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
  class DrizzleModule {}

  return defineModule(DrizzleModule, {
    exports: [DrizzleDatabase, DrizzleTransactionInterceptor],
    providers: createDrizzleProviders(options),
  });
}

export function createDrizzleModuleAsync<
  TDatabase extends DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = unknown,
  TTransactionOptions = unknown,
>(options: AsyncModuleOptions<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>>): ModuleType {
  class DrizzleAsyncModule {}

  const factory = options.useFactory as (...args: unknown[]) => MaybePromise<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>>;

  let cachedResult: Promise<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>> | undefined;
  const memoizedFactory = (...deps: unknown[]): Promise<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>> => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(factory(...deps));
    }
    return cachedResult;
  };

  const databaseProvider = {
    inject: options.inject,
    provide: DRIZZLE_DATABASE,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolved = await memoizedFactory(...deps);
      return resolved.database;
    },
  };

  const disposeProvider = {
    inject: options.inject,
    provide: DRIZZLE_DISPOSE,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolved = await memoizedFactory(...deps);
      return resolved.dispose;
    },
  };

  const optionsProvider = {
    inject: options.inject,
    provide: DRIZZLE_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolved = await memoizedFactory(...deps);
      return { strictTransactions: resolved.strictTransactions ?? false };
    },
  };

  return defineModule(DrizzleAsyncModule, {
    exports: [DrizzleDatabase, DrizzleTransactionInterceptor],
    providers: [databaseProvider, disposeProvider, optionsProvider, DrizzleDatabase, DrizzleTransactionInterceptor],
  });
}
