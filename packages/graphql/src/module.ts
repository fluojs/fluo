import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { GraphqlEndpointController, GraphqlLifecycleService } from './service.js';
import { GRAPHQL_LIFECYCLE_SERVICE, GRAPHQL_MODULE_OPTIONS } from './tokens.js';
import type { GraphqlModuleOptions } from './types.js';

export function createGraphqlProviders(options: GraphqlModuleOptions): Provider[] {
  return [
    {
      provide: GRAPHQL_MODULE_OPTIONS,
      useValue: options,
    },
    {
      provide: GRAPHQL_LIFECYCLE_SERVICE,
      useClass: GraphqlLifecycleService,
    },
  ];
}

export function createGraphqlModule(options: GraphqlModuleOptions = {}): ModuleType {
  class GraphqlModule {}

  return defineModule(GraphqlModule, {
    controllers: [GraphqlEndpointController],
    middleware: [],
    providers: createGraphqlProviders(options),
  });
}
