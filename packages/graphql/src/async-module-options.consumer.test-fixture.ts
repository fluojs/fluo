import { type OptionalToken, optional } from '@fluojs/di';
import { type GraphqlAsyncModuleOptions, GraphqlModule } from '@fluojs/graphql';

class GraphqlSettings {
  readonly graphiql = true;
}

const asyncOptions = {
  inject: [GraphqlSettings],
  useFactory: async (settings: GraphqlSettings) => ({
    graphiql: settings.graphiql,
  }),
} satisfies GraphqlAsyncModuleOptions<[typeof GraphqlSettings]>;

void GraphqlModule.forRootAsync(asyncOptions);

const optionalAsyncOptions = {
  inject: [optional(GraphqlSettings)],
  useFactory: async (settings) => ({
    graphiql: settings?.graphiql ?? false,
  }),
} satisfies GraphqlAsyncModuleOptions<[OptionalToken<GraphqlSettings>]>;

void GraphqlModule.forRootAsync(optionalAsyncOptions);
