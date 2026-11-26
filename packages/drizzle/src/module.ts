import type { AsyncModuleOptions, MaybePromise } from '@fluojs/core';
import type { ModuleType } from '@fluojs/runtime';

import { buildDrizzleModule, buildDrizzleModuleAsync } from './named-registration.js';
import type { DefaultTransactionDatabase, DefaultTransactionOptions } from './transaction-types.js';
import type { DrizzleDatabaseLike, DrizzleModuleOptions } from './types.js';

/**
 * Configures an async Drizzle module registration through an injected factory.
 *
 * @typeParam TDatabase Root Drizzle database handle registered in the module.
 * @typeParam TTransactionDatabase Transaction-scoped handle inferred from the native callback by default.
 * @typeParam TTransactionOptions Native runner options inferred from the registered handle by default.
 */
export type DrizzleAsyncModuleOptions<
  TDatabase extends object & DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
  TTransactionDatabase = DefaultTransactionDatabase<TDatabase>,
  TTransactionOptions = DefaultTransactionOptions<TDatabase>,
> = Pick<AsyncModuleOptions<never>, 'inject'> &
  Pick<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'global' | 'name'> & {
    /** Resolves registration options from the dependencies listed in `inject`, in order. */
    useFactory(...deps: unknown[]): MaybePromise<
      Omit<DrizzleModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>, 'global' | 'name'>
    >;
  };

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
    TDatabase extends object & DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = DefaultTransactionDatabase<TDatabase>,
    TTransactionOptions = DefaultTransactionOptions<TDatabase>,
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
    TDatabase extends object & DrizzleDatabaseLike<TTransactionDatabase, TTransactionOptions>,
    TTransactionDatabase = DefaultTransactionDatabase<TDatabase>,
    TTransactionOptions = DefaultTransactionOptions<TDatabase>,
  >(options: DrizzleAsyncModuleOptions<TDatabase, TTransactionDatabase, TTransactionOptions>): ModuleType {
    return buildDrizzleModuleAsync<TDatabase, TTransactionDatabase, TTransactionOptions>(options);
  }
}
