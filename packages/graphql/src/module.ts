import type { InjectionToken } from '@fluojs/core';
import { type Container, isForwardRef, isOptionalToken, type Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN } from './internal-tokens.js';
import { GraphqlEndpointController, GraphqlLifecycleService } from './service.js';
import type { GraphqlAsyncModuleOptions, GraphqlModuleOptions } from './types.js';

function createGraphqlProviders(optionsProvider: Provider): Provider[] {
  return [
    optionsProvider,
    GraphqlLifecycleService,
  ];
}

function assertGraphqlAsyncModuleOptions(options: GraphqlAsyncModuleOptions): void {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('GraphqlModule.forRootAsync requires an options object.');
  }

  const unsupportedKey = Object.keys(options).find((key) => key !== 'inject' && key !== 'useFactory');

  if (unsupportedKey !== undefined) {
    throw new TypeError(
      `GraphqlModule.forRootAsync does not support "${unsupportedKey}"; use only inject and useFactory.`,
    );
  }

  if (typeof options.useFactory !== 'function') {
    throw new TypeError('GraphqlModule.forRootAsync requires a useFactory function.');
  }

  if (options.inject !== undefined && !Array.isArray(options.inject)) {
    throw new TypeError('GraphqlModule.forRootAsync inject must be an array of application tokens.');
  }
}

function isContainer(value: unknown): value is Container {
  return value !== null && typeof value === 'object' && 'has' in value && 'resolve' in value;
}

async function resolveAsyncDependency(container: Container, token: InjectionToken): Promise<unknown> {
  if (isForwardRef(token)) {
    return await container.resolve(token.forwardRef());
  }

  if (isOptionalToken(token)) {
    return container.has(token.token) ? await container.resolve(token.token) : undefined;
  }

  return await container.resolve(token);
}

/**
 * Represents the graphql module.
 */
export class GraphqlModule {
  /**
   * Registers the GraphQL endpoint controller together with lifecycle providers.
   *
   * @param options Optional GraphQL module options for schema, resolver discovery, context, and plugins.
   * @returns A module definition that wires GraphQL runtime behavior and mounts the GraphQL endpoint controller; use this
   * module path (not `createGraphqlProviders(...)` alone) when the application should expose `/graphql`.
   */
  static forRoot(options: GraphqlModuleOptions = {}): ModuleType {
    class GraphqlRootModule extends GraphqlModule {}

    return defineModule(GraphqlRootModule, {
      controllers: [GraphqlEndpointController],
      middleware: [GraphqlLifecycleService],
      providers: createGraphqlProviders({
        provide: GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN,
        useValue: options,
      }),
    });
  }

  /**
   * Registers GraphQL from options resolved by explicitly injected application dependencies.
   *
   * The factory runs once in each application context. Only `inject` and `useFactory` are
   * supported; NestJS-style `imports`, `useClass`, `useExisting`, and implicit discovery are rejected.
   *
   * @param options Injected dependency tokens and the factory that resolves GraphQL options.
   * @returns A module definition that resolves GraphQL configuration before endpoint lifecycle wiring begins.
   *
   * @throws {TypeError} When the options shape requests unsupported registration behavior.
   */
  static forRootAsync(options: GraphqlAsyncModuleOptions): ModuleType {
    assertGraphqlAsyncModuleOptions(options);

    class GraphqlAsyncRootModule extends GraphqlModule {}

    return defineModule(GraphqlAsyncRootModule, {
      controllers: [GraphqlEndpointController],
      middleware: [GraphqlLifecycleService],
      providers: createGraphqlProviders({
        inject: [RUNTIME_CONTAINER],
        provide: GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN,
        scope: 'singleton',
        useFactory: async (...dependencies: unknown[]) => {
          const [runtimeContainer] = dependencies;

          if (!isContainer(runtimeContainer)) {
            throw new TypeError('GraphqlModule.forRootAsync could not resolve the application container.');
          }

          const injectedDependencies = await Promise.all(
            (options.inject ?? []).map(async (token) => await resolveAsyncDependency(runtimeContainer, token)),
          );

          return Reflect.apply(options.useFactory, options, injectedDependencies);
        },
      }),
    });
  }
}
