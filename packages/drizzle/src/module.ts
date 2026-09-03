import type { AsyncModuleOptions } from '@fluojs/core';
import type { ModuleType } from '@fluojs/runtime';

import { buildDrizzleModule, buildDrizzleModuleAsync } from './named-registration.js';
import type { DrizzleDatabaseLike, DrizzleModuleOptions } from './types.js';

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
