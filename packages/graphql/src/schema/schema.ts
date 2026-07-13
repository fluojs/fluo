import type { MetadataPropertyKey } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import { DtoValidationError } from '@fluojs/validation';
import type {
  GraphQLEnumType,
  GraphQLError as GraphQLErrorType,
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLInputType,
  GraphQLInterfaceType,
  GraphQLList as GraphQLListType,
  GraphQLNonNull as GraphQLNonNullType,
  GraphQLObjectType as GraphQLObjectTypeType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema as GraphQLSchemaType,
  GraphQLUnionType as GraphQLUnionTypeType,
} from 'graphql';

import { createGraphqlInput, resolveArgType, resolveOutputType } from '../pipeline/input-pipeline.js';
import {
  GRAPHQL_OPERATION_CONTAINER,
  type GraphQLContext,
  type GraphqlArgType,
  type GraphqlRootOutputNamedType,
  type GraphqlScalarTypeName,
  isGraphqlListTypeRef,
  type ResolverDescriptor,
  type ResolverHandlerDescriptor,
  type ResolverHandlerType,
} from '../types.js';
import { ObjectFieldResolverRegistry } from './object-field-resolvers.js';

type YogaGraphqlDeps = {
  GraphQLError: typeof GraphQLErrorType;
  GraphQLBoolean: GraphQLScalarType;
  GraphQLFloat: GraphQLScalarType;
  GraphQLID: GraphQLScalarType;
  GraphQLInt: GraphQLScalarType;
  GraphQLList: typeof GraphQLListType;
  GraphQLNonNull: typeof GraphQLNonNullType;
  GraphQLObjectType: typeof GraphQLObjectTypeType;
  GraphQLSchema: typeof GraphQLSchemaType;
  GraphQLString: GraphQLScalarType;
  GraphQLUnionType: typeof GraphQLUnionTypeType;
  buildSchema: (source: string) => GraphQLSchemaType;
  createGraphQLError: (message: string, options: { extensions?: Record<string, unknown> }) => GraphQLErrorType;
};

type ObjectFieldTransformer = (
  typeName: string,
  fields: GraphQLFieldConfigMap<unknown, GraphQLContext>,
) => GraphQLFieldConfigMap<unknown, GraphQLContext>;

type ResolverInvoker = (
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
  args: Record<string, unknown>,
  contextValue: GraphQLContext,
  source?: unknown,
) => Promise<unknown>;

type GraphQLNullableOutputType =
  | GraphQLScalarType
  | GraphQLObjectTypeType
  | GraphQLInterfaceType
  | GraphQLUnionTypeType
  | GraphQLEnumType
  | GraphQLListType<GraphQLOutputType>;
type GraphQLNonNullOutputType = GraphQLNonNullType<GraphQLNullableOutputType>;

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

function normalizeFieldOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  type: GraphQLNullableOutputType,
  transformObjectFields: ObjectFieldTransformer,
): GraphQLNullableOutputType;
function normalizeFieldOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  type: GraphQLOutputType,
  transformObjectFields: ObjectFieldTransformer,
): GraphQLOutputType {
  if (isListOutputType(type)) {
    return new deps.GraphQLList(normalizeFieldOutputType(deps, outputTypeCache, type.ofType, transformObjectFields));
  }

  if (isNonNullOutputType(type)) {
    return new deps.GraphQLNonNull(normalizeFieldOutputType(deps, outputTypeCache, type.ofType, transformObjectFields));
  }

  const maybeScalarName = (type as { name?: unknown }).name;
  if (typeof maybeScalarName === 'string') {
    const builtinScalar = builtinScalarByGraphqlName(deps, maybeScalarName);
    if (builtinScalar) {
      return builtinScalar;
    }
  }

  if (isUnionOutputType(type)) {
    return normalizeUnionOutputType(deps, outputTypeCache, type, transformObjectFields);
  }

  if (isObjectOutputType(type)) {
    return normalizeObjectOutputType(deps, outputTypeCache, type, transformObjectFields);
  }

  return type;
}

function normalizeObjectOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  outputType: GraphQLObjectTypeType,
  transformObjectFields: ObjectFieldTransformer,
): GraphQLOutputType {
  const outputTypeName = outputType.name;
  const cached = outputTypeCache.get(outputTypeName);
  if (cached) {
    return cached;
  }

  const config = outputType.toConfig();
  const normalized = new deps.GraphQLObjectType({
    ...config,
    fields: () => {
      const clonedFields = Object.fromEntries(
        Object.entries(config.fields).map(([fieldName, fieldConfig]) => {
          const field = fieldConfig as GraphQLFieldConfig<unknown, GraphQLContext>;

          return [
            fieldName,
            {
              ...field,
              type: normalizeFieldOutputType(deps, outputTypeCache, field.type, transformObjectFields),
            },
          ];
        }),
      ) as GraphQLFieldConfigMap<unknown, GraphQLContext>;

      return transformObjectFields(outputTypeName, clonedFields);
    },
  });
  outputTypeCache.set(outputTypeName, normalized);
  normalized.getFields();

  return normalized;
}

function normalizeUnionOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  outputType: GraphQLUnionTypeType,
  transformObjectFields: ObjectFieldTransformer,
): GraphQLOutputType {
  const outputTypeName = outputType.name;
  const cached = outputTypeCache.get(outputTypeName);
  if (cached) {
    return cached;
  }

  const config = outputType.toConfig();
  const normalizedTypeByName = new Set(config.types.map((itemType) => itemType.name));

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
    types: () =>
      config.types.map((itemType) =>
        normalizeObjectOutputType(deps, outputTypeCache, itemType, transformObjectFields),
      ) as GraphQLObjectTypeType[],
  });
  outputTypeCache.set(outputTypeName, normalized);
  normalized.getTypes();

  return normalized;
}

function isUnionOutputType(value: GraphqlRootOutputNamedType | GraphQLOutputType): value is GraphQLUnionTypeType {
  return typeof value === 'object' && typeof (value as { getTypes?: unknown }).getTypes === 'function';
}

function isObjectOutputType(value: GraphQLOutputType): value is GraphQLObjectTypeType {
  return value[Symbol.toStringTag] === 'GraphQLObjectType';
}

function isListOutputType(value: GraphQLOutputType): value is GraphQLListType<GraphQLOutputType> {
  return value[Symbol.toStringTag] === 'GraphQLList';
}

function isNonNullOutputType(value: GraphQLOutputType): value is GraphQLNonNullOutputType {
  return value[Symbol.toStringTag] === 'GraphQLNonNull';
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
  transformObjectFields: ObjectFieldTransformer,
): GraphQLOutputType {
  if (typeof outputRef === 'string') {
    return scalarByName(deps, outputRef as GraphqlScalarTypeName);
  }

  markAllowedCrossRealmGraphqlObjects(outputRef);
  if (isUnionOutputType(outputRef)) {
    return normalizeUnionOutputType(deps, outputTypeCache, outputRef, transformObjectFields);
  }

  return normalizeObjectOutputType(deps, outputTypeCache, outputRef, transformObjectFields);
}

function resolveRootOutputType(
  deps: YogaGraphqlDeps,
  outputTypeCache: Map<string, GraphQLOutputType>,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
  outputRef: ReturnType<typeof resolveOutputType>,
  transformObjectFields: ObjectFieldTransformer,
): GraphQLOutputType {
  if (isGraphqlListTypeRef(outputRef)) {
    const listItemType = resolveNamedRootOutputType(
      deps,
      outputTypeCache,
      markAllowedCrossRealmGraphqlObjects,
      outputRef.ofType as GraphqlRootOutputNamedType,
      transformObjectFields,
    );
    return new deps.GraphQLList(listItemType);
  }

  return resolveNamedRootOutputType(
    deps,
    outputTypeCache,
    markAllowedCrossRealmGraphqlObjects,
    outputRef,
    transformObjectFields,
  );
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
  invokeResolver: ResolverInvoker,
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
  invokeResolver: ResolverInvoker,
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
  transformObjectFields: ObjectFieldTransformer,
  invokeResolver: ResolverInvoker,
): GraphQLFieldConfigMap<unknown, GraphQLContext> {
  const fields: GraphQLFieldConfigMap<unknown, GraphQLContext> = {};

  for (const descriptor of descriptors) {
    for (const handler of descriptor.handlers) {
      if (handler.type !== handlerType) {
        continue;
      }

      const args = createFieldArgs(deps, handler);

      const outputRef = resolveOutputType(handler);
      const outputType = resolveRootOutputType(
        deps,
        outputTypeCache,
        markAllowedCrossRealmGraphqlObjects,
        outputRef,
        transformObjectFields,
      );

      if (Object.hasOwn(fields, handler.fieldName)) {
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

function toGraphqlValidationError(
  deps: YogaGraphqlDeps,
  error: DtoValidationError,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
): GraphQLErrorType {
  const graphqlError = deps.createGraphQLError('Validation failed.', {
    extensions: {
      code: 'BAD_USER_INPUT',
      issues: error.issues,
    },
  });

  markAllowedCrossRealmGraphqlObjects(graphqlError);

  return graphqlError;
}

async function createResolverInput(
  deps: YogaGraphqlDeps,
  handler: ResolverHandlerDescriptor,
  args: Record<string, unknown>,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
): Promise<unknown> {
  try {
    return await createGraphqlInput(handler.inputClass, args, handler.argFields);
  } catch (error) {
    if (error instanceof DtoValidationError) {
      throw toGraphqlValidationError(deps, error, markAllowedCrossRealmGraphqlObjects);
    }

    throw error;
  }
}

function resolveResolverMethod(
  instance: unknown,
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
): (this: unknown, ...args: unknown[]) => unknown {
  const value = (instance as Record<MetadataPropertyKey, unknown>)[handler.methodKey];

  if (typeof value !== 'function') {
    throw new Error(`Resolver handler ${descriptor.targetName}.${handler.methodName} is not callable.`);
  }

  return value as (this: unknown, ...args: unknown[]) => unknown;
}

function createResolverInvoker(
  deps: YogaGraphqlDeps,
  runtimeContainer: Container,
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void,
  objectFieldResolvers: ObjectFieldResolverRegistry,
): ResolverInvoker {
  return async (
    descriptor: ResolverDescriptor,
    handler: ResolverHandlerDescriptor,
    args: Record<string, unknown>,
    contextValue: GraphQLContext,
    source?: unknown,
  ): Promise<unknown> => {
    if (descriptor.scope === 'singleton') {
      const instance = await runtimeContainer.resolve(descriptor.token);
      const resolverMethod = resolveResolverMethod(instance, descriptor, handler);
      const methodArguments =
        handler.type === 'field'
          ? objectFieldResolvers.createMethodArguments(handler, source, contextValue)
          : [await createResolverInput(deps, handler, args, markAllowedCrossRealmGraphqlObjects), contextValue];
      return resolverMethod.call(instance, ...methodArguments);
    }

    const operationContainer = contextValue[GRAPHQL_OPERATION_CONTAINER] ?? runtimeContainer.createRequestScope();
    const disposeOperationContainer = contextValue[GRAPHQL_OPERATION_CONTAINER] === undefined;

    try {
      const instance = await operationContainer.resolve(descriptor.token);
      const resolverMethod = resolveResolverMethod(instance, descriptor, handler);
      const methodArguments =
        handler.type === 'field'
          ? objectFieldResolvers.createMethodArguments(handler, source, contextValue)
          : [await createResolverInput(deps, handler, args, markAllowedCrossRealmGraphqlObjects), contextValue];
      return await resolverMethod.call(instance, ...methodArguments);
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

/**
 * Resolve schema.
 *
 * @param deps The deps.
 * @param optionsSchema The options schema.
 * @param createCodeFirstSchema The create code first schema.
 * @param markAllowedCrossRealmGraphqlObjects The mark allowed cross realm graphql objects.
 * @returns The resolve schema result.
 */
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

/**
 * Create code first schema.
 *
 * @param deps The deps.
 * @param runtimeContainer The runtime container.
 * @param resolverDescriptors The resolver descriptors.
 * @param markAllowedCrossRealmGraphqlObjects The mark allowed cross realm graphql objects.
 * @returns The create code first schema result.
 */
export function createCodeFirstSchema(
  deps: YogaGraphqlDeps,
  runtimeContainer: Container,
  resolverDescriptors: ResolverDescriptor[],
  markAllowedCrossRealmGraphqlObjects: (value: unknown) => void = () => {},
): GraphQLSchemaType {
  if (resolverDescriptors.length === 0) {
    throw new Error('GraphQL module requires either schema or at least one resolver decorated with @Resolver().');
  }

  const objectFieldResolvers = new ObjectFieldResolverRegistry(resolverDescriptors);
  const invokeResolver = createResolverInvoker(
    deps,
    runtimeContainer,
    markAllowedCrossRealmGraphqlObjects,
    objectFieldResolvers,
  );
  const outputTypeCache = new Map<string, GraphQLOutputType>();

  function attachObjectFieldResolvers(
    typeName: string,
    fields: GraphQLFieldConfigMap<unknown, GraphQLContext>,
  ): GraphQLFieldConfigMap<unknown, GraphQLContext> {
    return objectFieldResolvers.attach(
      typeName,
      fields,
      (outputType) =>
        resolveRootOutputType(
          deps,
          outputTypeCache,
          markAllowedCrossRealmGraphqlObjects,
          outputType,
          attachObjectFieldResolvers,
        ),
      (descriptor, handler, source, contextValue) => invokeResolver(descriptor, handler, {}, contextValue, source),
    );
  }

  const queryFields = pickFieldsByType(
    deps,
    resolverDescriptors,
    'query',
    markAllowedCrossRealmGraphqlObjects,
    outputTypeCache,
    attachObjectFieldResolvers,
    invokeResolver,
  );
  const mutationFields = pickFieldsByType(
    deps,
    resolverDescriptors,
    'mutation',
    markAllowedCrossRealmGraphqlObjects,
    outputTypeCache,
    attachObjectFieldResolvers,
    invokeResolver,
  );
  const subscriptionFields = pickFieldsByType(
    deps,
    resolverDescriptors,
    'subscription',
    markAllowedCrossRealmGraphqlObjects,
    outputTypeCache,
    attachObjectFieldResolvers,
    invokeResolver,
  );

  objectFieldResolvers.assertAllTargetsAttached();

  const queryType = createQueryRootType(deps, queryFields);
  const mutationType = createOptionalRootType(deps, 'Mutation', mutationFields);
  const subscriptionType = createOptionalRootType(deps, 'Subscription', subscriptionFields);

  const schema = new deps.GraphQLSchema({
    mutation: mutationType,
    query: queryType,
    subscription: subscriptionType,
  });

  markAllowedCrossRealmGraphqlObjects(schema);

  return schema;
}
