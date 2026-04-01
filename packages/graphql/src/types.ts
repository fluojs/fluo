import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { Container } from '@konekti/di';
import type { FrameworkRequest, Principal } from '@konekti/http';
import type { GraphQLObjectType, GraphQLSchema, GraphQLUnionType } from 'graphql';

export const GRAPHQL_OPERATION_CONTAINER = Symbol.for('konekti.graphql.operation.container');
export const GRAPHQL_REQUEST_SCOPED_LOADER_CACHE = Symbol.for('konekti.graphql.request_scoped_loader_cache');

export interface GraphqlRequestContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  socket?: unknown;
}

export interface GraphQLContext {
  request: FrameworkRequest;
  connectionParams?: Record<string, unknown>;
  principal?: Principal;
  [GRAPHQL_OPERATION_CONTAINER]?: Container;
  [GRAPHQL_REQUEST_SCOPED_LOADER_CACHE]?: Map<string | symbol, unknown>;
  [key: string]: unknown;
  socket?: unknown;
}

export interface GraphqlWebSocketSubscriptionsOptions {
  connectionInitWaitTimeoutMs?: number;
  enabled?: boolean;
  keepAliveMs?: number;
}

export interface GraphqlSubscriptionsOptions {
  websocket?: GraphqlWebSocketSubscriptionsOptions;
}

export interface ResolverMetadata {
  typeName: string;
}

export type ResolverHandlerType = 'query' | 'mutation' | 'subscription';

export type GraphqlScalarTypeName = 'string' | 'int' | 'float' | 'boolean' | 'id';

export interface GraphqlListTypeRef<TType> {
  kind: 'list';
  ofType: TType;
}

export function listOf<TType>(ofType: TType): GraphqlListTypeRef<TType> {
  return {
    kind: 'list',
    ofType,
  };
}

export function isGraphqlListTypeRef(value: unknown): value is GraphqlListTypeRef<unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { kind?: unknown; ofType?: unknown };
  return candidate.kind === 'list' && 'ofType' in candidate;
}

export type GraphqlArgType = GraphqlScalarTypeName | GraphqlListTypeRef<GraphqlScalarTypeName>;
export type GraphqlRootOutputNamedType = GraphqlScalarTypeName | GraphQLObjectType | GraphQLUnionType;
export type GraphqlRootOutputType = GraphqlRootOutputNamedType | GraphqlListTypeRef<GraphqlRootOutputNamedType>;

export interface ResolverHandlerMetadata {
  type: ResolverHandlerType;
  fieldName?: string;
  topics?: string | string[];
  inputClass?: Function;
  argTypes?: Record<string, GraphqlArgType>;
  outputType?: GraphqlRootOutputType;
}

export interface ArgFieldMetadata {
  argName: string;
  fieldName: string;
}

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

export interface ResolverDescriptor {
  typeName: string;
  handlers: ResolverHandlerDescriptor[];
  token: Token;
  targetName: string;
  moduleName: string;
  scope: 'singleton' | 'request' | 'transient';
}

export interface GraphqlModuleOptions {
  schema?: GraphQLSchema | string;
  resolvers?: Function[];
  context?: (ctx: GraphqlRequestContext) => Record<string, unknown>;
  graphiql?: boolean;
  plugins?: unknown[];
  subscriptions?: GraphqlSubscriptionsOptions;
}
