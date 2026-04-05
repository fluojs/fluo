import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN } from './internal-tokens.js';
import { GraphqlEndpointController, GraphqlLifecycleService } from './service.js';
import type { GraphqlModuleOptions } from './types.js';

/**
 * Creates GraphQL runtime providers for module-level options and lifecycle wiring.
 *
 * @param options GraphQL module options used by the lifecycle service and endpoint controller.
 * @returns Provider definitions that register only the internal options token and GraphQL lifecycle service; this helper
 * does not register `GraphqlEndpointController` or mount the `/graphql` endpoint by itself.
 */
export function createGraphqlProviders(options: GraphqlModuleOptions): Provider[] {
  return [
    {
      provide: GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN,
      useValue: options,
    },
    GraphqlLifecycleService,
  ];
}

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
      middleware: [],
      providers: createGraphqlProviders(options),
    });
  }
}
