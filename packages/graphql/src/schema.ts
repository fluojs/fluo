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
import {
  GRAPHQL_OPERATION_CONTAINER,
  type GraphQLContext,
  type ResolverDescriptor,
  type ResolverHandlerDescriptor,
  type ResolverHandlerType,
} from './types.js';

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

function createFieldArgs(deps: YogaGraphqlDeps, handler: ResolverHandlerDescriptor) {
  return Object.fromEntries(
    handler.argFields.map((argField) => [
      argField.argName,
      {
        type: scalarByName(deps, resolveArgScalarType(handler, argField.argName)),
      },
    ]),
  );
}

function createSubscriptionField(
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
  args: ReturnType<typeof createFieldArgs>,
  outputType: GraphQLScalarType,
  invokeResolver: (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
  ) => Promise<unknown>,
) {
  return {
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
}

function createOperationField(
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
  args: ReturnType<typeof createFieldArgs>,
  outputType: GraphQLScalarType,
  invokeResolver: (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
  ) => Promise<unknown>,
) {
  return {
    args,
    resolve: async (
      _source: unknown,
      rawArgs: Record<string, unknown>,
      contextValue: GraphQLContext,
    ): Promise<unknown> => invokeResolver(descriptor, handler, rawArgs, contextValue),
    type: outputType,
  };
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

      const args = createFieldArgs(deps, handler);

      const outputType = scalarByName(deps, resolveOutputScalarType(handler));

      if (handler.type === 'subscription') {
        fields[handler.fieldName] = createSubscriptionField(descriptor, handler, args, outputType, invokeResolver);

        continue;
      }

      fields[handler.fieldName] = createOperationField(descriptor, handler, args, outputType, invokeResolver);
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

function toGraphqlValidationError(deps: YogaGraphqlDeps, error: DtoValidationError): GraphQLErrorType {
  return new deps.GraphQLError('Validation failed.', {
    extensions: {
      code: 'BAD_USER_INPUT',
      issues: error.issues,
    },
  });
}

async function createResolverInput(
  deps: YogaGraphqlDeps,
  handler: ResolverHandlerDescriptor,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await createGraphqlInput(handler.inputClass, args, handler.argFields);
  } catch (error) {
    if (error instanceof DtoValidationError) {
      throw toGraphqlValidationError(deps, error);
    }

    throw error;
  }
}

function resolveResolverMethod(
  instance: unknown,
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
): (this: unknown, input: unknown, contextValue: GraphQLContext) => unknown {
  const value = (instance as Record<MetadataPropertyKey, unknown>)[handler.methodKey];

  if (typeof value !== 'function') {
    throw new Error(`Resolver handler ${descriptor.targetName}.${handler.methodName} is not callable.`);
  }

  return value as (this: unknown, input: unknown, contextValue: GraphQLContext) => unknown;
}

function createResolverInvoker(
  deps: YogaGraphqlDeps,
  runtimeContainer: Container,
): (
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
  args: Record<string, unknown>,
  contextValue: GraphQLContext,
) => Promise<unknown> {
  return async (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
  ): Promise<unknown> => {
    if (descriptor.scope === 'singleton') {
      const instance = await runtimeContainer.resolve(descriptor.token);
      const resolverMethod = resolveResolverMethod(instance, descriptor, handler);
      const input = await createResolverInput(deps, handler, args);
      return resolverMethod.call(instance, input, contextValue);
    }

    const operationContainer = contextValue[GRAPHQL_OPERATION_CONTAINER] ?? runtimeContainer.createRequestScope();
    const disposeOperationContainer = contextValue[GRAPHQL_OPERATION_CONTAINER] === undefined;

    try {
      const instance = await operationContainer.resolve(descriptor.token);
      const resolverMethod = resolveResolverMethod(instance, descriptor, handler);
      const input = await createResolverInput(deps, handler, args);
      return await resolverMethod.call(instance, input, contextValue);
    } finally {
      if (disposeOperationContainer) {
        await operationContainer.dispose();
      }
    }
  };
}

function createQueryRootType(
  deps: YogaGraphqlDeps,
  queryFields: GraphQLFieldConfigMap<unknown, GraphQLContext>,
): GraphQLObjectTypeType {
  if (Object.keys(queryFields).length === 0) {
    return new deps.GraphQLObjectType({
      fields: {
        _empty: {
          resolve: () => 'ok',
          type: deps.GraphQLString,
        },
      },
      name: 'Query',
    });
  }

  return new deps.GraphQLObjectType({
    fields: queryFields,
    name: 'Query',
  });
}

function createOptionalRootType(
  deps: YogaGraphqlDeps,
  name: 'Mutation' | 'Subscription',
  fields: GraphQLFieldConfigMap<unknown, GraphQLContext>,
): GraphQLObjectTypeType | undefined {
  if (Object.keys(fields).length === 0) {
    return undefined;
  }

  return new deps.GraphQLObjectType({
    fields,
    name,
  });
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

  const invokeResolver = createResolverInvoker(deps, runtimeContainer);

  const queryFields = pickFieldsByType(deps, resolverDescriptors, 'query', invokeResolver);
  const mutationFields = pickFieldsByType(deps, resolverDescriptors, 'mutation', invokeResolver);
  const subscriptionFields = pickFieldsByType(deps, resolverDescriptors, 'subscription', invokeResolver);

  const queryType = createQueryRootType(deps, queryFields);
  const mutationType = createOptionalRootType(deps, 'Mutation', mutationFields);
  const subscriptionType = createOptionalRootType(deps, 'Subscription', subscriptionFields);

  return new deps.GraphQLSchema({
    mutation: mutationType,
    query: queryType,
    subscription: subscriptionType,
  });
}
