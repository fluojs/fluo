import { describe, expect, it } from 'vitest';

import * as graphqlPublicApi from './index.js';

describe('@konekti/graphql public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(graphqlPublicApi).toHaveProperty('Arg');
    expect(graphqlPublicApi).toHaveProperty('Query');
    expect(graphqlPublicApi).toHaveProperty('Mutation');
    expect(graphqlPublicApi).toHaveProperty('Subscription');
    expect(graphqlPublicApi).toHaveProperty('Resolver');
    expect(graphqlPublicApi).toHaveProperty('createGraphqlModule');
    expect(graphqlPublicApi).toHaveProperty('createGraphqlProviders');
    expect(graphqlPublicApi).toHaveProperty('createDataLoader');
    expect(graphqlPublicApi).toHaveProperty('createDataLoaderMap');
    expect(graphqlPublicApi).toHaveProperty('DataLoader');
    expect(graphqlPublicApi).toHaveProperty('getRequestScopedDataLoader');
    expect(graphqlPublicApi).toHaveProperty('createRequestScopedDataLoaderFactory');
  });

  it('does not expose internal lifecycle/module-option tokens', () => {
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_MODULE_OPTIONS');
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_LIFECYCLE_SERVICE');
  });
});
