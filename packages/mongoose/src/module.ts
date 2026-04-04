import type { AsyncModuleOptions } from '@konekti/core';
import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { MongooseConnection } from './connection.js';
import { MONGOOSE_CONNECTION, MONGOOSE_DISPOSE, MONGOOSE_OPTIONS } from './tokens.js';
import { MongooseTransactionInterceptor } from './transaction.js';
import type { MongooseConnectionLike, MongooseModuleOptions, MongooseRuntimeOptions } from './types.js';

type ResolvedMongooseModuleOptions<TConnection extends MongooseConnectionLike> = Omit<
  MongooseModuleOptions<TConnection>,
  'strictTransactions'
> & {
  strictTransactions: boolean;
};

const MONGOOSE_NORMALIZED_OPTIONS = Symbol('konekti.mongoose.normalized-options');
const MONGOOSE_MODULE_EXPORTS = [MongooseConnection, MongooseTransactionInterceptor];

function normalizeMongooseModuleOptions<TConnection extends MongooseConnectionLike>(
  options: MongooseModuleOptions<TConnection>,
): ResolvedMongooseModuleOptions<TConnection> {
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

function createMemoizedMongooseOptionsResolver<TConnection extends MongooseConnectionLike>(
  options: AsyncModuleOptions<MongooseModuleOptions<TConnection>>,
): (...deps: unknown[]) => Promise<ResolvedMongooseModuleOptions<TConnection>> {
  let cachedResult: Promise<ResolvedMongooseModuleOptions<TConnection>> | undefined;

  return (...deps: unknown[]) => {
    if (!cachedResult) {
      cachedResult = Promise.resolve(options.useFactory(...deps)).then((resolved) =>
        normalizeMongooseModuleOptions<TConnection>(resolved),
      );
    }

    if (!cachedResult) {
      throw new Error('Mongoose module options resolver initialization failed.');
    }

    return cachedResult;
  };
}

function createMongooseProvidersAsync<TConnection extends MongooseConnectionLike>(
  options: AsyncModuleOptions<MongooseModuleOptions<TConnection>>,
): Provider[] {
  const resolveOptions = createMemoizedMongooseOptionsResolver(options);

  const normalizedOptionsProvider = {
    inject: options.inject,
    provide: MONGOOSE_NORMALIZED_OPTIONS,
    scope: 'singleton' as const,
    useFactory: async (...deps: unknown[]) => resolveOptions(...deps),
  };

  return createMongooseRuntimeProviders<TConnection>(normalizedOptionsProvider);
}

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
    providers: createMongooseProviders(options),
  });
}

function buildMongooseModuleAsync<TConnection extends MongooseConnectionLike>(
  options: AsyncModuleOptions<MongooseModuleOptions<TConnection>>,
): ModuleType {
  class MongooseAsyncModuleDefinition {}

  return defineModule(MongooseAsyncModuleDefinition, {
    exports: MONGOOSE_MODULE_EXPORTS,
    providers: createMongooseProvidersAsync(options),
  });
}

export class MongooseModule {
  static forRoot<TConnection extends MongooseConnectionLike>(options: MongooseModuleOptions<TConnection>): ModuleType {
    return buildMongooseModule<TConnection>(options);
  }

  static forRootAsync<TConnection extends MongooseConnectionLike>(
    options: AsyncModuleOptions<MongooseModuleOptions<TConnection>>,
  ): ModuleType {
    return buildMongooseModuleAsync<TConnection>(options);
  }
}
