import { GRAPHQL_REQUEST_SCOPED_LOADER_CACHE, type GraphQLContext } from './types.js';

export function getRequestScopedDataLoader<TLoader>(
  context: GraphQLContext,
  key: string | symbol,
  createLoader: () => TLoader,
): TLoader {
  const cache = context[GRAPHQL_REQUEST_SCOPED_LOADER_CACHE] ?? new Map<string | symbol, unknown>();
  context[GRAPHQL_REQUEST_SCOPED_LOADER_CACHE] = cache;

  const existing = cache.get(key);
  if (existing !== undefined) {
    return existing as TLoader;
  }

  const created = createLoader();
  cache.set(key, created);

  return created;
}

export function createRequestScopedDataLoaderFactory<TLoader>(
  key: string | symbol,
  createLoader: () => TLoader,
): (context: GraphQLContext) => TLoader {
  return (context: GraphQLContext) => getRequestScopedDataLoader(context, key, createLoader);
}
