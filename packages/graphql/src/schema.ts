import type { Container } from '@konekti/di';
import type { MetadataPropertyKey } from '@konekti/core';
import type {
  GraphQLFieldConfigMap,
  GraphQLFieldConfig,
  GraphQLError as GraphQLErrorType,
  GraphQLFieldConfigArgumentMap,
  GraphQLInputType,
  GraphQLList as GraphQLListType,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLOutputType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLScalarType,
  GraphQLUnionType as GraphQLUnionTypeType,
} from 'graphql';
import { DtoValidationError } from '@konekti/validation';

import { createGraphqlInput, resolveArgType, resolveOutputType } from './input-pipeline.js';
import {
  GRAPHQL_OPERATION_CONTAINER,
  isGraphqlListTypeRef,
  type GraphQLContext,
  type GraphqlArgType,
  type GraphqlRootOutputNamedType,
  type GraphqlScalarTypeName,
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
  GraphQLList: typeof GraphQLListType;
  GraphQLObjectType: typeof GraphQLObjectTypeType;
  GraphQLSchema: typeof GraphQLSchemaType;
  GraphQLString: GraphQLScalarType;
  GraphQLUnionType: typeof GraphQLUnionTypeType;
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

function builtinScalarByGraphqlName(deps: YogaGraphqlDeps, scalarName: string): GraphQLScalarType | undefined {
  switch (scalarName) {
    case 'String':
      return deps.GraphQLString;
    case 'Int':
      return deps.GraphQLInt;
    case 'Float':
      return deps.GraphQLFloat;
    case 'Boolean':
      return deps.GraphQLBoolean;
    case 'ID':
      return deps.GraphQLID;
    default:
      return undefined;
  }
}

function normalizeFieldOutputType(deps: YogaGraphqlDeps, type: GraphQLOutputType): GraphQLOutputType {
  const maybeScalarName = (type as { name?: unknown }).name;
  if (typeof maybeScalarName === 'string') {
    return builtinScalarByGraphqlName(deps, maybeScalarName) ?? type;
  }

  return type;
}

function normalizeObjectOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  outputType: GraphQLObjectTypeType,
): GraphQLOutputType {
  const outputTypeName = outputType.name;
  const cached = outputTypeCache.get(outputTypeName);
  if (cached) {
    return cached;
  }

  const config = outputType.toConfig();
  const clonedFields = Object.fromEntries(
    Object.entries(config.fields).map(([fieldName, fieldConfig]) => {
      const field = fieldConfig as GraphQLFieldConfig<unknown, GraphQLContext>;

      return [
        fieldName,
        {
          ...field,
          type: normalizeFieldOutputType(deps, field.type),
        },
      ];
    }),
  ) as GraphQLFieldConfigMap<unknown, GraphQLContext>;

  const normalized = new deps.GraphQLObjectType({
    ...config,
    fields: clonedFields,
  });
  outputTypeCache.set(outputTypeName, normalized);

  return normalized;
}

function normalizeUnionOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  outputType: GraphQLUnionTypeType,
): GraphQLOutputType {
  const outputTypeName = outputType.name;
  const cached = outputTypeCache.get(outputTypeName);
  if (cached) {
    return cached;
  }

  const config = outputType.toConfig();
  const normalizedTypes = config.types.map((itemType) => normalizeObjectOutputType(deps, outputTypeCache, itemType));
  const normalizedTypeByName = new Set(
    normalizedTypes
      .map((itemType) => (itemType as { name?: unknown }).name)
      .filter((name): name is string => typeof name === 'string'),
  );

  const normalized = new deps.GraphQLUnionType({
    ...config,
    resolveType: async (...args) => {
      if (!config.resolveType) {
        return undefined;
      }

      const resolved = await config.resolveType(...args);

      if (typeof resolved === 'string' || resolved === null || resolved === undefined) {
        return typeof resolved === 'string' && normalizedTypeByName.has(resolved) ? resolved : resolved;
      }

      const resolvedName = (resolved as { name?: unknown }).name;
      if (typeof resolvedName === 'string') {
        return normalizedTypeByName.has(resolvedName) ? resolvedName : undefined;
      }

      return undefined;
    },
    types: normalizedTypes as GraphQLObjectTypeType[],
  });
  outputTypeCache.set(outputTypeName, normalized);

  return normalized;
}

function isUnionOutputType(value: GraphqlRootOutputNamedType): value is GraphQLUnionTypeType {
  return typeof value === 'object' && typeof (value as { getTypes?: unknown }).getTypes === 'function';
}

function resolveArgGraphqlType(deps: YogaGraphqlDeps, argType: GraphqlArgType): GraphQLInputType {
  if (isGraphqlListTypeRef(argType)) {
    return new deps.GraphQLList(scalarByName(deps, argType.ofType as GraphqlScalarTypeName));
  }

  return scalarByName(deps, argType as GraphqlScalarTypeName);
}

function resolveNamedRootOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
  outputRef: GraphqlRootOutputNamedType,
): GraphQLOutputType {
  if (typeof outputRef === 'string') {
    return scalarByName(deps, outputRef as GraphqlScalarTypeName);
  }

  markAllowedCrossRealmGraphqlObjects(outputRef);
  if (isUnionOutputType(outputRef)) {
    return normalizeUnionOutputType(deps, outputTypeCache, outputRef);
  }

  return normalizeObjectOutputType(deps, outputTypeCache, outputRef);
}

function resolveRootOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
  outputRef: ReturnType<typeof resolveOutputType>,
): GraphQLOutputType {
  if (isGraphqlListTypeRef(outputRef)) {
    const listItemType = resolveNamedRootOutputType(
      deps,
      outputTypeCache,
      markAllowedCrossRealmGraphqlObjects,
      outputRef.ofType as GraphqlRootOutputNamedType,
    );
    return new deps.GraphQLList(listItemType);
  }

  return resolveNamedRootOutputType(deps, outputTypeCache, markAllowedCrossRealmGraphqlObjects, outputRef);
}

function createFieldArgs(deps: YogaGraphqlDeps, handler: ResolverHandlerDescriptor) {
  return Object.fromEntries(
    handler.argFields.map((argField) => [
      argField.argName,
      {
        type: resolveArgGraphqlType(deps, resolveArgType(handler, argField.argName)),
      },
    ]),
  );
}

function createSubscriptionField(
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
  args: GraphQLFieldConfigArgumentMap,
  outputType: GraphQLOutputType,
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
  args: GraphQLFieldConfigArgumentMap,
  outputType: GraphQLOutputType,
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
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
  outputTypeCache: Map<string, GraphQLOutputType>,
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

      const outputRef = resolveOutputType(handler);
      const outputType = resolveRootOutputType(deps, outputTypeCache, markAllowedCrossRealmGraphqlObjects, outputRef);

      if (Object.prototype.hasOwnProperty.call(fields, handler.fieldName)) {
        throw new Error(
          `GraphQL schema conflict: field "${handler.fieldName}" on ${handlerType} type is registered more than once. ` +
            `Found duplicate in resolver "${descriptor.targetName}". Each field name must be unique across all resolvers.`,
        );
      }

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
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void = () => {},
): GraphQLSchemaType {
  if (resolverDescriptors.length === 0) {
    throw new Error('GraphQL module requires either schema or at least one resolver decorated with @Resolver().');
  }

  const invokeResolver = createResolverInvoker(deps, runtimeContainer);
  const outputTypeCache = new Map<string, GraphQLOutputType>();

  const queryFields = pickFieldsByType(
    deps,
    resolverDescriptors,
    'query',
    markAllowedCrossRealmGraphqlObjects,
    outputTypeCache,
    invokeResolver,
  );
  const mutationFields = pickFieldsByType(
    deps,
    resolverDescriptors,
    'mutation',
    markAllowedCrossRealmGraphqlObjects,
    outputTypeCache,
    invokeResolver,
  );
  const subscriptionFields = pickFieldsByType(
    deps,
    resolverDescriptors,
    'subscription',
    markAllowedCrossRealmGraphqlObjects,
    outputTypeCache,
    invokeResolver,
  );

  const queryType = createQueryRootType(deps, queryFields);
  const mutationType = createOptionalRootType(deps, 'Mutation', mutationFields);
  const subscriptionType = createOptionalRootType(deps, 'Subscription', subscriptionFields);

  return new deps.GraphQLSchema({
    mutation: mutationType,
    query: queryType,
    subscription: subscriptionType,
  });
}
