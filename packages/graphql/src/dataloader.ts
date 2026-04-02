import DataLoader from 'dataloader';

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

/**
 * Options accepted by {@link createDataLoader}. Extends the standard
 * `DataLoader.Options` with an optional `key` used to deduplicate loader
 * instances inside the per-operation request-scoped cache.
 */
export interface KonektiDataLoaderOptions<K, V, C = K> extends DataLoader.Options<K, V, C> {
  /**
   * Cache key used to store/retrieve this loader in the per-operation
   * request-scoped cache.  When omitted a unique `Symbol` is generated
   * automatically, which means every call-site gets its own loader instance
   * per operation — usually what you want.
   */
  key?: string | symbol;
}

/**
 * A function returned by {@link createDataLoader} that, given a
 * {@link GraphQLContext}, returns a request-scoped `DataLoader` instance.
 *
 * Call this inside any resolver method to obtain a DataLoader that is
 * automatically scoped to the current GraphQL operation.
 */
export type RequestScopedDataLoaderAccessor<K, V> = (context: GraphQLContext) => DataLoader<K, V>;

/**
 * Create a request-scoped `DataLoader` accessor.
 *
 * This is the recommended first-party entry point for DataLoader usage in
 * `@konekti/graphql`.  It combines the `dataloader` package with Konekti's
 * per-operation request-scoped cache so that:
 *
 * - Each GraphQL operation gets its own `DataLoader` instance (cache isolation).
 * - Concurrent operations never share batched results.
 * - The accessor is safe to call from singleton resolvers — no `@Scope('request')` required.
 *
 * @example
 * ```ts
 * import { createDataLoader, type GraphQLContext } from '@konekti/graphql';
 *
 * const getUserById = createDataLoader<string, User | null>(async (ids) => {
 *   const users = await userRepo.findManyByIds([...ids]);
 *   const map = new Map(users.map(u => [u.id, u]));
 *   return ids.map(id => map.get(id) ?? null);
 * });
 *
 * // inside a resolver method:
 * const user = await getUserById(context).load(userId);
 * ```
 */
export function createDataLoader<K, V, C = K>(
  batchFn: DataLoader.BatchLoadFn<K, V>,
  options?: KonektiDataLoaderOptions<K, V, C>,
): RequestScopedDataLoaderAccessor<K, V> {
  const { key: userKey, ...dataloaderOptions } = options ?? ({} as KonektiDataLoaderOptions<K, V, C>);
  const cacheKey: string | symbol = userKey ?? Symbol('konekti.dataloader');

  return createRequestScopedDataLoaderFactory<DataLoader<K, V>>(
    cacheKey,
    () => new DataLoader<K, V, C>(batchFn, dataloaderOptions as DataLoader.Options<K, V, C>),
  );
}

/**
 * Describes a single loader entry in a {@link DataLoaderMap}.
 */
export interface DataLoaderDefinition<K, V, C = K> {
  batch: DataLoader.BatchLoadFn<K, V>;
  options?: DataLoader.Options<K, V, C>;
}

/**
 * A map from loader names to their definitions.
 *
 * @example
 * ```ts
 * const loaders = {
 *   userById: { batch: async (ids) => ... },
 *   postsByAuthor: { batch: async (authorIds) => ..., options: { cache: false } },
 * } satisfies DataLoaderMap;
 * ```
 */
export type DataLoaderMap = Record<string, DataLoaderDefinition<any, any, any>>;

/**
 * The resolved accessor type: each key from the definition map becomes a
 * `DataLoader` instance keyed by the original batch function's types.
 */
export type ResolvedDataLoaders<TMap extends DataLoaderMap> = {
  [K in keyof TMap]: TMap[K] extends DataLoaderDefinition<infer TKey, infer TValue, any>
    ? DataLoader<TKey, TValue>
    : never;
};

/**
 * Create a set of named, request-scoped DataLoaders from a definition map.
 *
 * This is convenient when a resolver (or a group of resolvers) needs multiple
 * loaders — instead of declaring each one individually, define them as a map
 * and retrieve the whole set per operation.
 *
 * @example
 * ```ts
 * const loaders = createDataLoaderMap({
 *   userById: {
 *     batch: async (ids) => {
 *       const users = await repo.findManyByIds([...ids]);
 *       const map = new Map(users.map(u => [u.id, u]));
 *       return ids.map(id => map.get(id) ?? null);
 *     },
 *   },
 * });
 *
 * // inside resolver:
 * const { userById } = loaders(context);
 * const user = await userById.load('abc');
 * ```
 */
export function createDataLoaderMap<TMap extends DataLoaderMap>(
  definitions: TMap,
): (context: GraphQLContext) => ResolvedDataLoaders<TMap> {
  const accessors = new Map<string, RequestScopedDataLoaderAccessor<unknown, unknown>>();

  for (const [name, def] of Object.entries(definitions)) {
    accessors.set(
      name,
      createDataLoader(def.batch, { ...def.options, key: Symbol(`konekti.dataloader.map.${name}`) }),
    );
  }

  return (context: GraphQLContext): ResolvedDataLoaders<TMap> => {
    const result: Record<string, DataLoader<unknown, unknown>> = {};
    for (const [name, accessor] of accessors) {
      result[name] = accessor(context);
    }
    return result as ResolvedDataLoaders<TMap>;
  };
}

export { DataLoader };
