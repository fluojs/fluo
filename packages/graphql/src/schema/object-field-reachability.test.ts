import { Container } from '@fluojs/di';
import {
  buildSchema,
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLUnionType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
} from 'graphql';
import { describe, expect, it } from 'vitest';

import type { GraphqlRootOutputType, ResolverDescriptor } from '../types.js';
import { createCodeFirstSchema } from './schema.js';

const deps = {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLUnionType,
  buildSchema,
  createGraphQLError: (message: string, options: { extensions?: Record<string, unknown> }) => new GraphQLError(message, options),
};

function makeRootDescriptor(outputType: GraphqlRootOutputType): ResolverDescriptor {
  return {
    handlers: [
      {
        argFields: [],
        fieldName: 'root',
        methodKey: 'root',
        methodName: 'root',
        outputType,
        parameterBindings: [],
        type: 'query',
      },
    ],
    moduleName: 'TestModule',
    scope: 'singleton',
    targetName: 'RootResolver',
    token: Symbol('RootResolver'),
    typeName: 'Query',
  };
}

function makeFieldDescriptor(
  typeName: string,
  fieldName: string,
  outputType?: GraphqlRootOutputType,
): ResolverDescriptor {
  return {
    handlers: [
      {
        argFields: [],
        fieldName,
        methodKey: fieldName,
        methodName: fieldName,
        outputType,
        parameterBindings: [],
        type: 'field',
      },
    ],
    moduleName: 'TestModule',
    scope: 'singleton',
    targetName: `${typeName}FieldResolver`,
    token: Symbol(`${typeName}FieldResolver`),
    typeName,
  };
}

describe('GraphQL object field resolver reachability', () => {
  it('attaches a field resolver to an object type reachable through an existing object field', () => {
    // Given
    const nestedType = new GraphQLObjectType({
      fields: {
        id: { type: GraphQLString },
        label: { type: GraphQLString },
      },
      name: 'NestedReachableTarget',
    });
    const rootType = new GraphQLObjectType({
      fields: {
        nested: { type: nestedType },
      },
      name: 'NestedReachabilityRoot',
    });

    // When
    const schema = createCodeFirstSchema(deps, new Container(), [
      makeRootDescriptor(rootType),
      makeFieldDescriptor('NestedReachableTarget', 'label'),
    ]);

    // Then
    const normalizedRoot = schema.getQueryType()?.getFields().root?.type;
    expect(isObjectType(normalizedRoot)).toBe(true);
    if (!isObjectType(normalizedRoot)) {
      throw new Error('Expected the root output to be an object type.');
    }

    const normalizedNested = normalizedRoot.getFields().nested?.type;
    expect(isObjectType(normalizedNested)).toBe(true);
    if (!isObjectType(normalizedNested)) {
      throw new Error('Expected the nested output to be an object type.');
    }

    expect(normalizedNested.getFields().label?.resolve).toBeTypeOf('function');
  });

  it('normalizes a self-referential field resolver output without recursive cache re-entry', () => {
    // Given
    const nodeType = new GraphQLObjectType({
      fields: {
        id: { type: GraphQLString },
      },
      name: 'SelfReferentialFieldResolverNode',
    });

    // When
    const schema = createCodeFirstSchema(deps, new Container(), [
      makeRootDescriptor(nodeType),
      makeFieldDescriptor('SelfReferentialFieldResolverNode', 'next', nodeType),
    ]);

    // Then
    const normalizedNode = schema.getQueryType()?.getFields().root?.type;
    expect(isObjectType(normalizedNode)).toBe(true);
    if (!isObjectType(normalizedNode)) {
      throw new Error('Expected the root output to be an object type.');
    }

    expect(normalizedNode.getFields().next?.type).toBe(normalizedNode);
  });

  it('attaches through list and non-null wrappers while preserving wrapper semantics', () => {
    // Given
    const wrappedTarget = new GraphQLObjectType({
      fields: {
        id: { type: GraphQLString },
        label: { type: GraphQLString },
      },
      name: 'WrappedReachableTarget',
    });
    const wrappedRoot = new GraphQLObjectType({
      fields: {
        nested: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(wrappedTarget))) },
      },
      name: 'WrappedReachabilityRoot',
    });

    // When
    const schema = createCodeFirstSchema(deps, new Container(), [
      makeRootDescriptor(wrappedRoot),
      makeFieldDescriptor('WrappedReachableTarget', 'label'),
    ]);

    // Then
    const normalizedRoot = schema.getQueryType()?.getFields().root?.type;
    if (!isObjectType(normalizedRoot)) {
      throw new Error('Expected the root output to be an object type.');
    }

    const wrappedNested = normalizedRoot.getFields().nested?.type;
    expect(wrappedNested?.toString()).toBe('[WrappedReachableTarget!]!');
    if (!isNonNullType(wrappedNested) || !isListType(wrappedNested.ofType)) {
      throw new Error('Expected the nested output to preserve non-null list wrappers.');
    }

    const wrappedItem = wrappedNested.ofType.ofType;
    if (!isNonNullType(wrappedItem) || !isObjectType(wrappedItem.ofType)) {
      throw new Error('Expected the list item to preserve its non-null object wrapper.');
    }

    expect(wrappedItem.ofType.getFields().label?.resolve).toBeTypeOf('function');
  });

  it('reuses a normalized union when a member field resolver outputs that union', () => {
    // Given
    const memberType = new GraphQLObjectType({
      fields: {
        id: { type: GraphQLString },
      },
      name: 'UnionBackEdgeMember',
    });
    const unionType = new GraphQLUnionType({
      name: 'UnionBackEdgeResult',
      resolveType: () => 'UnionBackEdgeMember',
      types: [memberType],
    });

    // When
    const schema = createCodeFirstSchema(deps, new Container(), [
      makeRootDescriptor(unionType),
      makeFieldDescriptor('UnionBackEdgeMember', 'related', unionType),
    ]);

    // Then
    const normalizedUnion = schema.getQueryType()?.getFields().root?.type;
    if (!isUnionType(normalizedUnion)) {
      throw new Error('Expected the root output to be a union type.');
    }

    const normalizedMember = normalizedUnion.getTypes()[0];
    expect(normalizedMember?.getFields().related?.type).toBe(normalizedUnion);
  });
});
