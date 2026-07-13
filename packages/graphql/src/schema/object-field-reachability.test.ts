import { Container } from '@fluojs/di';
import {
  buildSchema,
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  GraphQLUnionType,
  isObjectType,
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
});
