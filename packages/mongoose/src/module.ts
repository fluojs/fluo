import type { AsyncModuleOptions } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { MongooseConnection } from './connection.js';
import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import { MongooseTransactionInterceptor } from './transaction.js';
import type { MongooseConnectionLike, MongooseModuleOptions } from './types.js';

type MongooseRuntimeOptions = {
  strictTransactions: boolean;
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
const MONGOOSE_MODULE_EXPORTS = [MongooseConnection, MongooseTransactionInterceptor];

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

function createRuntimeOptionsProviderValue(strictTransactions: boolean): MongooseRuntimeOptions {
  return { strictTransactions };
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
        ),
    },
    MongooseConnection,
    MongooseTransactionInterceptor,
  ];
}

function createMongooseProvidersAsync<TConnection extends MongooseConnectionLike>(
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
 * Creates Mongoose providers for compatibility-oriented manual module composition.
 *
 * Prefer `MongooseModule.forRoot(...)` for application registration so module
 * exports and provider visibility stay aligned with the documented namespace
 * facade. Use this helper only when hand-assembling providers in advanced
 * compatibility scenarios.
 *
 * @param options Mongoose module options with a connection handle, optional dispose hook, and strict transaction policy.
 * @returns Provider definitions equivalent to `MongooseModule.forRoot(...)`.
 */
export function createMongooseProviders<TConnection extends MongooseConnectionLike>(
  options: MongooseModuleOptions<TConnection>,
): Provider[] {
  const resolved = normalizeMongooseModuleOptions(options);

  return createMongooseRuntimeProviders<TConnection>({
    provide: MONGOOSE_NORMALIZED_OPTIONS,
    useValue: resolved,
  });
}

function buildMongooseModule<TConnection extends MongooseConnectionLike>(
  options: MongooseModuleOptions<TConnection>,
): ModuleType {
  class MongooseRootModuleDefinition {}

  return defineModule(MongooseRootModuleDefinition, {
    exports: MONGOOSE_MODULE_EXPORTS,
    global: options.global ?? false,
    providers: createMongooseProviders(options),
  });
}

function buildMongooseModuleAsync<TConnection extends MongooseConnectionLike>(
  options: MongooseAsyncModuleOptions<TConnection>,
): ModuleType {
  class MongooseAsyncModuleDefinition {}

  return defineModule(MongooseAsyncModuleDefinition, {
    exports: MONGOOSE_MODULE_EXPORTS,
    global: options.global ?? false,
    providers: createMongooseProvidersAsync(options),
  });
}

/**
 * Module entrypoint for wiring a Mongoose connection into the Fluo runtime lifecycle.
 */
export class MongooseModule {
  /**
   * Registers Mongoose providers from static options.
   *
   * @param options Mongoose module options with connection handle, optional dispose hook, and strict transaction mode.
   * @returns A module definition that exports `MongooseConnection` and `MongooseTransactionInterceptor`.
   */
  static forRoot<TConnection extends MongooseConnectionLike>(options: MongooseModuleOptions<TConnection>): ModuleType {
    return buildMongooseModule<TConnection>(options);
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
    return buildMongooseModuleAsync<TConnection>(options);
  }
}
