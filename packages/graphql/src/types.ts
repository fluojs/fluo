import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { FrameworkRequest, Principal } from '@konekti/http';
import type { GraphQLSchema } from 'graphql';

export interface GraphqlRequestContext {
  request: FrameworkRequest;
  principal?: Principal;
}

export interface GraphQLContext {
  request: FrameworkRequest;
  principal?: Principal;
  [key: string]: unknown;
}

export interface ResolverMetadata {
  typeName: string;
}

export type ResolverHandlerType = 'query' | 'mutation' | 'subscription';

export interface ResolverHandlerMetadata {
  type: ResolverHandlerType;
  fieldName?: string;
  topics?: string | string[];
  inputClass?: Function;
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
}

export interface ResolverDescriptor {
  typeName: string;
  handlers: ResolverHandlerDescriptor[];
  token: Token;
  targetName: string;
  moduleName: string;
}

export interface GraphqlModuleOptions {
  schema?: GraphQLSchema | string;
  resolvers?: Function[];
  context?: (ctx: GraphqlRequestContext) => Record<string, unknown>;
  graphiql?: boolean;
}
