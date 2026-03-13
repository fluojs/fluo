import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { DrizzleDatabase } from './database';
import { DRIZZLE_DATABASE, DRIZZLE_DISPOSE } from './tokens';
import { DrizzleTransactionInterceptor } from './transaction';
import type { DrizzleDatabaseLike, DrizzleModuleOptions } from './types';

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
