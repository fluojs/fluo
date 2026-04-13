import { describe, expect, it } from 'vitest';

import * as graphqlPublicApi from './index.js';

describe('@fluojs/graphql public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(graphqlPublicApi).toHaveProperty('Arg');
    expect(graphqlPublicApi).toHaveProperty('Query');
    expect(graphqlPublicApi).toHaveProperty('Mutation');
    expect(graphqlPublicApi).toHaveProperty('Subscription');
    expect(graphqlPublicApi).toHaveProperty('Resolver');
    expect(graphqlPublicApi).toHaveProperty('GraphqlModule');
    expect(graphqlPublicApi).toHaveProperty('createGraphqlProviders');
    expect(graphqlPublicApi).toHaveProperty('createDataLoader');
    expect(graphqlPublicApi).toHaveProperty('createDataLoaderMap');
    expect(graphqlPublicApi).toHaveProperty('DataLoader');
    expect(graphqlPublicApi).toHaveProperty('getRequestScopedDataLoader');
    expect(graphqlPublicApi).toHaveProperty('createRequestScopedDataLoaderFactory');
    expect(graphqlPublicApi).toHaveProperty('listOf');
    expect(graphqlPublicApi).toHaveProperty('isGraphqlListTypeRef');
  });

  it('keeps GraphqlModule limited to the documented synchronous entrypoint', () => {
    expect(graphqlPublicApi.GraphqlModule).toHaveProperty('forRoot');
    expect(graphqlPublicApi.GraphqlModule).not.toHaveProperty('forRootAsync');
  });

  it('does not expose internal metadata, lifecycle, or descriptor internals', () => {
    expect(graphqlPublicApi).not.toHaveProperty('createGraphqlModule');
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_MODULE_OPTIONS');
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_LIFECYCLE_SERVICE');
    expect(graphqlPublicApi).not.toHaveProperty('defineResolverMetadata');
    expect(graphqlPublicApi).not.toHaveProperty('getResolverMetadata');
    expect(graphqlPublicApi).not.toHaveProperty('defineResolverHandlerMetadata');
    expect(graphqlPublicApi).not.toHaveProperty('getResolverHandlerMetadata');
    expect(graphqlPublicApi).not.toHaveProperty('getResolverHandlerMetadataEntries');
    expect(graphqlPublicApi).not.toHaveProperty('defineArgFieldMetadata');
    expect(graphqlPublicApi).not.toHaveProperty('getArgFieldMetadata');
    expect(graphqlPublicApi).not.toHaveProperty('getArgFieldMetadataEntries');
    expect(graphqlPublicApi).not.toHaveProperty('resolverMetadataSymbol');
    expect(graphqlPublicApi).not.toHaveProperty('handlerMetadataSymbol');
    expect(graphqlPublicApi).not.toHaveProperty('argMetadataSymbol');
    expect(graphqlPublicApi).not.toHaveProperty('GraphqlEndpointController');
    expect(graphqlPublicApi).not.toHaveProperty('GraphqlLifecycleService');
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_OPERATION_CONTAINER');
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_REQUEST_SCOPED_LOADER_CACHE');
    expect(graphqlPublicApi).not.toHaveProperty('ResolverDescriptor');
    expect(graphqlPublicApi).not.toHaveProperty('ResolverHandlerDescriptor');
  });
});
