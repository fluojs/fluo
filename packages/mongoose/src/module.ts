import type { TransactionRollbackObserver } from './result-rollback.js';
import type { AsyncModuleOptions } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { MongooseConnection } from './connection.js';
import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import type { MongooseConnectionLike, MongooseModuleOptions } from './types.js';

type MongooseRuntimeOptions = {
  strictTransactions: boolean;
  rollbackObserver?: TransactionRollbackObserver;
};

type ResolvedMongooseModuleOptions<TConnection extends MongooseConnectionLike> = Omit<
  MongooseModuleOptions<TConnection>,
  'strictTransactions'
> & {
  strictTransactions: boolean;
};

/**
 * Async registration options accepted by `MongooseModule.forRootAsync(...)`.
 *
 * The factory resolves the same connection, disposal, and strict transaction
 * options accepted by `MongooseModule.forRoot(...)`; `global` remains on the
 * top-level async registration so callers can opt into global provider export.
 */
export type MongooseAsyncModuleOptions<TConnection extends MongooseConnectionLike> = AsyncModuleOptions<
  Omit<MongooseModuleOptions<TConnection>, 'global'>
> & Pick<MongooseModuleOptions<TConnection>, 'global'>;

const MONGOOSE_NORMALIZED_OPTIONS = Symbol('fluo.mongoose.normalized-options');
const MONGOOSE_MODULE_EXPORTS = [MongooseConnection];

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function normalizeMongooseModuleOptions<TConnection extends MongooseConnectionLike>(
  options: MongooseModuleOptions<TConnection>,
): ResolvedMongooseModuleOptions<TConnection> {
  if (!isObjectLike(options.connection)) {
    throw new Error('MongooseModule requires a connection option.');
  }

  return {
    ...options,
    strictTransactions: options.strictTransactions ?? false,
  };
}

function createRuntimeOptionsProviderValue(strictTransactions: boolean, rollbackObserver?: TransactionRollbackObserver): MongooseRuntimeOptions {
  return { strictTransactions, ...(rollbackObserver && { rollbackObserver }) };
}

function createMongooseRuntimeProviders<TConnection extends MongooseConnectionLike>(
  normalizedOptionsProvider: Provider,
): Provider[] {
  return [
    normalizedOptionsProvider,
    {
      inject: [MONGOOSE_NORMALIZED_OPTIONS],
      provide: MONGOOSE_CONNECTION,
      useFactory: (options: unknown) => (options as ResolvedMongooseModuleOptions<TConnection>).connection,
    },
    {
      inject: [MONGOOSE_NORMALIZED_OPTIONS],
      provide: MONGOOSE_DISPOSE,
      useFactory: (options: unknown) => (options as ResolvedMongooseModuleOptions<TConnection>).dispose,
    },
    {
      inject: [MONGOOSE_NORMALIZED_OPTIONS],
      provide: MONGOOSE_OPTIONS,
      useFactory: (options: unknown) =>
        createRuntimeOptionsProviderValue(
          (options as ResolvedMongooseModuleOptions<TConnection>).strictTransactions,
          (options as ResolvedMongooseModuleOptions<TConnection>).rollbackObserver,
        ),
    },
    MongooseConnection,
  ];
}

function createAsyncMongooseRuntimeProviders<TConnection extends MongooseConnectionLike>(
  options: MongooseAsyncModuleOptions<TConnection>,
): Provider[] {
  const factory = options.useFactory;

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: MONGOOSE_NORMALIZED_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => {
      const resolvedOptions = await factory(...deps);

      return normalizeMongooseModuleOptions<TConnection>({
        ...resolvedOptions,
        global: options.global,
      });
    },
  };

  return createMongooseRuntimeProviders<TConnection>(normalizedOptionsProvider);
}

/**
 * Module entrypoint for wiring a Mongoose connection into the Fluo runtime lifecycle.
 */
export class MongooseModule {
  /**
   * Registers Mongoose providers from static options.
   *
   * @param options Mongoose module options with connection handle, optional dispose hook, and strict transaction mode.
   * @returns A module definition that exports `MongooseConnection`.
   */
  static forRoot<TConnection extends MongooseConnectionLike>(options: MongooseModuleOptions<TConnection>): ModuleType {
    return MongooseModule.createRootModule(
      options.global,
      createMongooseRuntimeProviders<TConnection>({
        provide: MONGOOSE_NORMALIZED_OPTIONS,
        useValue: normalizeMongooseModuleOptions(options),
      }),
    );
  }

  /**
   * Registers Mongoose providers from an async DI factory.
   *
   * @param options Async module options that resolve Mongoose connection/module configuration.
   * @returns A module definition that resolves async options once per application container.
   */
  static forRootAsync<TConnection extends MongooseConnectionLike>(
    options: MongooseAsyncModuleOptions<TConnection>,
  ): ModuleType {
    return MongooseModule.createAsyncRootModule(options.global, createAsyncMongooseRuntimeProviders(options));
  }

  private static createRootModule(global: boolean | undefined, providers: Provider[]): ModuleType {
    class MongooseRootModuleDefinition {}

    return defineModule(MongooseRootModuleDefinition, {
      exports: MONGOOSE_MODULE_EXPORTS,
      global: global ?? false,
      providers,
    });
  }

  private static createAsyncRootModule(global: boolean | undefined, providers: Provider[]): ModuleType {
    class MongooseAsyncModuleDefinition {}

    return defineModule(MongooseAsyncModuleDefinition, {
      exports: MONGOOSE_MODULE_EXPORTS,
      global: global ?? false,
      providers,
    });
  }
}
