import { GraphqlModule, type GraphqlAsyncModuleOptions } from '@fluojs/graphql';

class GraphqlSettings {
  readonly graphiql = true;
}

const asyncOptions = {
  inject: [GraphqlSettings],
  useFactory: async (settings: GraphqlSettings) => ({
    graphiql: settings.graphiql,
  }),
} satisfies GraphqlAsyncModuleOptions<[GraphqlSettings]>;

void GraphqlModule.forRootAsync(asyncOptions);
