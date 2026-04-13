import type { MetadataPropertyKey, Token } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import type { FrameworkRequest, Principal } from '@fluojs/http';
import type { GraphQLObjectType, GraphQLSchema, GraphQLUnionType } from 'graphql';

/**
 * GraphQL context key that stores the per-operation DI container.
 *
 * Resolvers can use this symbol indirectly through framework helpers when they
 * need request-scoped provider resolution inside one GraphQL operation.
 */
export const GRAPHQL_OPERATION_CONTAINER = Symbol.for('fluo.graphql.operation.container');

/**
 * GraphQL context key that stores the per-operation DataLoader cache.
 *
 * `createDataLoader(...)` and related helpers use this cache so singleton
 * resolvers still get loader isolation per GraphQL operation.
 */
export const GRAPHQL_REQUEST_SCOPED_LOADER_CACHE = Symbol.for('fluo.graphql.request_scoped_loader_cache');

/**
 * Minimal request information exposed to GraphQL context factories.
 */
export interface GraphqlRequestContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  socket?: unknown;
}

/**
 * Mutable GraphQL execution context shared across resolvers for one operation.
 *
 * @remarks
 * This context always includes the underlying Fluo request and may carry the
 * operation DI container, request-scoped DataLoader cache, subscription socket,
 * and user-defined values returned from `GraphqlModule.forRoot({ context })`.
 */
export interface GraphQLContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  [GRAPHQL_OPERATION_CONTAINER]?: Container;
  [GRAPHQL_REQUEST_SCOPED_LOADER_CACHE]?: Map<string | symbol, unknown>;
  [key: string]: unknown;
  socket?: unknown;
}

/**
 * WebSocket-specific subscription settings for `GraphqlModule`.
 */
export interface GraphqlWebSocketSubscriptionsOptions {
  connectionInitWaitTimeoutMs?: number;
  enabled?: boolean;
  keepAliveMs?: number;
}

/**
 * Subscription transport settings for the GraphQL runtime.
 */
export interface GraphqlSubscriptionsOptions {
  websocket?: GraphqlWebSocketSubscriptionsOptions;
}

/**
 * Per-request validation budgets enforced before GraphQL execution begins.
 */
export interface GraphqlRequestLimitsOptions {
  maxComplexity?: number;
  maxCost?: number;
  maxDepth?: number;
}

/**
 * Resolver-level metadata captured by `@Resolver(...)`.
 */
export interface ResolverMetadata {
  typeName: string;
}

/**
 * Supported GraphQL operation handler categories.
 */
export type ResolverHandlerType = 'query' | 'mutation' | 'subscription';

/**
 * Scalar names supported by the code-first schema helpers.
 */
export type GraphqlScalarTypeName = 'string' | 'int' | 'float' | 'boolean' | 'id';

/**
 * Wrapper used by `listOf(...)` to describe GraphQL list output or argument types.
 */
export interface GraphqlListTypeRef<TType> {
  kind: 'list';
  ofType: TType;
}

/**
 * Wrap a scalar or root output type reference as a GraphQL list type.
 *
 * @typeParam TType Item type carried by the list wrapper.
 * @param ofType Scalar or object type reference for each list entry.
 * @returns A lightweight marker object understood by the GraphQL schema builder.
 *
 * @example
 * ```ts
 * @Query({ outputType: listOf('string') })
 * listTags() {
 *   return ['framework', 'typescript'];
 * }
 * ```
 */
export function listOf<TType>(ofType: TType): GraphqlListTypeRef<TType> {
  return {
    kind: 'list',
    ofType,
  };
}

/**
 * Check whether a value is a `listOf(...)` wrapper understood by the schema builder.
 *
 * @param value Unknown value to inspect.
 * @returns `true` when the value is a GraphQL list type wrapper.
 */
export function isGraphqlListTypeRef(value: unknown): value is GraphqlListTypeRef<unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { kind?: unknown; ofType?: unknown };
  return candidate.kind === 'list' && 'ofType' in candidate;
}

/**
 * Supported argument type references for resolver parameters.
 */
export type GraphqlArgType = GraphqlScalarTypeName | GraphqlListTypeRef<GraphqlScalarTypeName>;

/**
 * Named output types allowed at the root query, mutation, and subscription level.
 */
export type GraphqlRootOutputNamedType = GraphqlScalarTypeName | GraphQLObjectType | GraphQLUnionType;

/**
 * Root output type references accepted by resolver metadata.
 */
export type GraphqlRootOutputType = GraphqlRootOutputNamedType | GraphqlListTypeRef<GraphqlRootOutputNamedType>;

/**
 * Operation-level metadata captured from `@Query(...)`, `@Mutation(...)`, and `@Subscription(...)`.
 */
export interface ResolverHandlerMetadata {
  type: ResolverHandlerType;
  fieldName?: string;
  topics?: string | string[];
  inputClass?: Function;
  argTypes?: Record<string, GraphqlArgType>;
  outputType?: GraphqlRootOutputType;
}

/**
 * Describes how one method parameter maps to a named GraphQL argument.
 */
export interface ArgFieldMetadata {
  argName: string;
  fieldName: string;
}

/**
 * Normalized resolver method descriptor used during schema discovery.
 */
export interface ResolverHandlerDescriptor {
  type: ResolverHandlerType;
  methodKey: MetadataPropertyKey;
  methodName: string;
  fieldName: string;
  topics?: string | string[];
  inputClass?: Function;
  argFields: ArgFieldMetadata[];
  argTypes?: Record<string, GraphqlArgType>;
  outputType?: GraphqlRootOutputType;
}

/**
 * Fully discovered resolver descriptor used by the GraphQL runtime.
 */
export interface ResolverDescriptor {
  typeName: string;
  handlers: ResolverHandlerDescriptor[];
  token: Token;
  targetName: string;
  moduleName: string;
  scope: 'singleton' | 'request' | 'transient';
}

/**
 * Public options for `GraphqlModule.forRoot(...)` and `forRootAsync(...)`.
 *
 * @remarks
 * Keep README examples for end-to-end module wiring. Source hover docs here are
 * meant to clarify how each option shapes the per-request execution pipeline.
 */
export interface GraphqlModuleOptions {
  schema?: GraphQLSchema | string;
  resolvers?: Function[];
  context?: (ctx: GraphqlRequestContext) => Record<string, unknown>;
  graphiql?: boolean;
  /**
   * Enables schema introspection queries.
   *
   * When omitted, introspection remains disabled unless `graphiql` is explicitly enabled.
   */
  introspection?: boolean;
  /**
   * Configures built-in request budgets for document depth, field complexity, and aggregate query cost.
   *
   * Pass `false` to disable these guardrails and preserve legacy unbounded behavior.
   */
  limits?: GraphqlRequestLimitsOptions | false;
  plugins?: unknown[];
  subscriptions?: GraphqlSubscriptionsOptions;
}
