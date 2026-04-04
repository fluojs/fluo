import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN } from './internal-tokens.js';
import { GraphqlEndpointController, GraphqlLifecycleService } from './service.js';
import type { GraphqlModuleOptions } from './types.js';

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
  static forRoot(options: GraphqlModuleOptions = {}): ModuleType {
    class GraphqlRootModule extends GraphqlModule {}

    return defineModule(GraphqlRootModule, {
      controllers: [GraphqlEndpointController],
      middleware: [],
      providers: createGraphqlProviders(options),
    });
  }
}
