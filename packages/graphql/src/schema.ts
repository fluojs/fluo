import type { Container } from '@konekti/di';
import type { MetadataPropertyKey } from '@konekti/core';
import type {
  GraphQLFieldConfigMap,
  GraphQLError as GraphQLErrorType,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLScalarType,
} from 'graphql';
import { DtoValidationError } from '@konekti/dto-validator';

import { createGraphqlInput, resolveArgScalarType, resolveOutputScalarType } from './input-pipeline.js';
import type { GraphQLContext, ResolverDescriptor, ResolverHandlerDescriptor, ResolverHandlerType } from './types.js';

type YogaGraphqlDeps = {
  GraphQLError: typeof GraphQLErrorType;
  GraphQLBoolean: GraphQLScalarType;
  GraphQLFloat: GraphQLScalarType;
  GraphQLID: GraphQLScalarType;
  GraphQLInt: GraphQLScalarType;
  GraphQLObjectType: typeof GraphQLObjectTypeType;
  GraphQLSchema: typeof GraphQLSchemaType;
  GraphQLString: GraphQLScalarType;
  buildSchema: (source: string) => GraphQLSchemaType;
};

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

function scalarByName(deps: YogaGraphqlDeps, scalar: 'string' | 'int' | 'float' | 'boolean' | 'id'): GraphQLScalarType {
  switch (scalar) {
    case 'int':
      return deps.GraphQLInt;
    case 'float':
      return deps.GraphQLFloat;
    case 'boolean':
      return deps.GraphQLBoolean;
    case 'id':
      return deps.GraphQLID;
    case 'string':
    default:
      return deps.GraphQLString;
  }
}

function pickFieldsByType(
  deps: YogaGraphqlDeps,
  descriptors: ResolverDescriptor[],
  handlerType: ResolverHandlerType,
  invokeResolver: (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
  ) => Promise<unknown>,
): GraphQLFieldConfigMap<unknown, GraphQLContext> {
  const fields: GraphQLFieldConfigMap<unknown, GraphQLContext> = {};

  for (const descriptor of descriptors) {
    for (const handler of descriptor.handlers) {
      if (handler.type !== handlerType) {
        continue;
      }

      const args = Object.fromEntries(
        handler.argFields.map((argField) => [
          argField.argName,
          {
            type: scalarByName(deps, resolveArgScalarType(handler, argField.argName)),
          },
        ]),
      );

      const outputType = scalarByName(deps, resolveOutputScalarType(handler));

      if (handler.type === 'subscription') {
        fields[handler.fieldName] = {
          args,
          resolve(payload: unknown): unknown {
            return payload;
          },
          subscribe: async (
            _source: unknown,
            rawArgs: Record<string, unknown>,
            contextValue: GraphQLContext,
          ): Promise<AsyncIterable<unknown>> => {
            const value = await invokeResolver(descriptor, handler, rawArgs, contextValue);

            if (!isAsyncIterable(value)) {
              throw new Error(`Subscription resolver ${descriptor.targetName}.${handler.methodName} must return AsyncIterable.`);
            }

            return value;
          },
          type: outputType,
        };

        continue;
      }

      fields[handler.fieldName] = {
        args,
        resolve: async (
          _source: unknown,
          rawArgs: Record<string, unknown>,
          contextValue: GraphQLContext,
        ): Promise<unknown> => invokeResolver(descriptor, handler, rawArgs, contextValue),
        type: outputType,
      };
    }
  }

  return fields;
}

function isGraphQLSchemaLike(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return (
    typeof (value as Record<string, unknown>).getQueryType === 'function' &&
    typeof (value as Record<string, unknown>).getTypeMap === 'function'
  );
}

export function resolveSchema(
  deps: YogaGraphqlDeps,
  optionsSchema: GraphQLSchemaType | string | undefined,
  createCodeFirstSchema: () => GraphQLSchemaType,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
): GraphQLSchemaType {
  if (isGraphQLSchemaLike(optionsSchema)) {
    markAllowedCrossRealmGraphqlObjects(optionsSchema);
    return optionsSchema as GraphQLSchemaType;
  }

  if (typeof optionsSchema === 'string') {
    return deps.buildSchema(optionsSchema);
  }

  return createCodeFirstSchema();
}

export function createCodeFirstSchema(
  deps: YogaGraphqlDeps,
  runtimeContainer: Container,
  resolverDescriptors: ResolverDescriptor[],
): GraphQLSchemaType {
  if (resolverDescriptors.length === 0) {
    throw new Error('GraphQL module requires either schema or at least one resolver decorated with @Resolver().');
  }

  const invokeResolver = async (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
  ): Promise<unknown> => {
    const instance = await runtimeContainer.resolve(descriptor.token);
    const value = (instance as Record<MetadataPropertyKey, unknown>)[handler.methodKey];

    if (typeof value !== 'function') {
      throw new Error(`Resolver handler ${descriptor.targetName}.${handler.methodName} is not callable.`);
    }

    let input: unknown;

    try {
      input = await createGraphqlInput(handler.inputClass, args, handler.argFields);
    } catch (error) {
      if (error instanceof DtoValidationError) {
        throw new deps.GraphQLError('Validation failed.', {
          extensions: {
            code: 'BAD_USER_INPUT',
            issues: error.issues,
          },
        });
      }

      throw error;
    }

    return value.call(instance, input, contextValue);
  };

  const queryFields = pickFieldsByType(deps, resolverDescriptors, 'query', invokeResolver);
  const mutationFields = pickFieldsByType(deps, resolverDescriptors, 'mutation', invokeResolver);
  const subscriptionFields = pickFieldsByType(deps, resolverDescriptors, 'subscription', invokeResolver);

  const queryType = new deps.GraphQLObjectType({
    fields:
      Object.keys(queryFields).length === 0
        ? {
            _empty: {
              resolve: () => 'ok',
              type: deps.GraphQLString,
            },
          }
        : queryFields,
    name: 'Query',
  });

  const mutationType =
    Object.keys(mutationFields).length === 0
      ? undefined
      : new deps.GraphQLObjectType({
          fields: mutationFields,
          name: 'Mutation',
        });

  const subscriptionType =
    Object.keys(subscriptionFields).length === 0
      ? undefined
      : new deps.GraphQLObjectType({
          fields: subscriptionFields,
          name: 'Subscription',
        });

  return new deps.GraphQLSchema({
    mutation: mutationType,
    query: queryType,
    subscription: subscriptionType,
  });
}
