import { describe, expect, it } from 'vitest';
import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  buildSchema,
} from 'graphql';

import type { Container } from '@konekti/di';

import { createCodeFirstSchema } from './schema.js';
import { listOf } from './types.js';
import type { ResolverDescriptor } from './types.js';

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
  buildSchema,
};

const fakeContainer = {} as unknown as Container;

function makeDescriptor(
  targetName: string,
  fieldName: string,
  options?: {
    argTypes?: ResolverDescriptor['handlers'][number]['argTypes'];
    argFields?: ResolverDescriptor['handlers'][number]['argFields'];
    outputType?: ResolverDescriptor['handlers'][number]['outputType'];
    type?: ResolverDescriptor['handlers'][number]['type'];
  },
): ResolverDescriptor {
  return {
    handlers: [
      {
        argFields: options?.argFields ?? [],
        argTypes: options?.argTypes,
        fieldName,
        methodKey: 'resolve',
        methodName: 'resolve',
        outputType: options?.outputType,
        type: options?.type ?? 'query',
      },
    ],
    moduleName: 'TestModule',
    scope: 'singleton',
    targetName,
    token: Symbol(targetName),
    typeName: 'Query',
  };
}

describe('createCodeFirstSchema – duplicate fieldName detection', () => {
  it('throws when two resolvers register the same query fieldName', () => {
    const descriptors: ResolverDescriptor[] = [
      makeDescriptor('QueryA', 'user'),
      makeDescriptor('QueryB', 'user'),
    ];

    expect(() => createCodeFirstSchema(deps, fakeContainer, descriptors)).toThrow(
      /field "user" on query type is registered more than once/,
    );
  });

  it('throws when two resolvers register the same mutation fieldName', () => {
    const descriptors: ResolverDescriptor[] = [
      {
        ...makeDescriptor('MutationA', 'createUser'),
        handlers: [{ argFields: [], fieldName: 'createUser', methodKey: 'exec', methodName: 'exec', type: 'mutation' }],
      },
      {
        ...makeDescriptor('MutationB', 'createUser'),
        handlers: [{ argFields: [], fieldName: 'createUser', methodKey: 'exec', methodName: 'exec', type: 'mutation' }],
      },
    ];

    expect(() => createCodeFirstSchema(deps, fakeContainer, descriptors)).toThrow(
      /field "createUser" on mutation type is registered more than once/,
    );
  });

  it('allows distinct fieldNames across multiple resolvers', () => {
    const descriptors: ResolverDescriptor[] = [
      makeDescriptor('QueryA', 'user'),
      makeDescriptor('QueryB', 'post'),
    ];

    expect(() => createCodeFirstSchema(deps, fakeContainer, descriptors)).not.toThrow();
  });
});

describe('createCodeFirstSchema – root object output foundation', () => {
  it('supports named object output types for query/mutation/subscription fields', () => {
    const payloadType = new GraphQLObjectType({
      fields: {
        status: { type: GraphQLString },
        value: { type: GraphQLInt },
      },
      name: 'RootOperationPayload',
    });

    const schema = createCodeFirstSchema(deps, fakeContainer, [
      makeDescriptor('QueryResolver', 'summary', { outputType: payloadType, type: 'query' }),
      makeDescriptor('MutationResolver', 'updateSummary', { outputType: payloadType, type: 'mutation' }),
      makeDescriptor('SubscriptionResolver', 'summaryStream', { outputType: payloadType, type: 'subscription' }),
    ]);

    const queryOutput = schema.getQueryType()?.getFields().summary?.type;
    const mutationOutput = schema.getMutationType()?.getFields().updateSummary?.type;
    const subscriptionOutput = schema.getSubscriptionType()?.getFields().summaryStream?.type;

    expect('name' in (queryOutput ?? {}) ? (queryOutput as { name: string }).name : undefined).toBe('RootOperationPayload');
    expect('name' in (mutationOutput ?? {}) ? (mutationOutput as { name: string }).name : undefined).toBe('RootOperationPayload');
    expect('name' in (subscriptionOutput ?? {}) ? (subscriptionOutput as { name: string }).name : undefined).toBe(
      'RootOperationPayload',
    );
  });

  it('supports list arg types and list outputs for root operations', () => {
    const payloadType = new GraphQLObjectType({
      fields: {
        status: { type: GraphQLString },
      },
      name: 'ListPayload',
    });

    const schema = createCodeFirstSchema(deps, fakeContainer, [
      makeDescriptor('QueryResolver', 'tags', {
        argFields: [{ argName: 'values', fieldName: 'values' }],
        argTypes: {
          values: listOf('string'),
        },
        outputType: listOf('string'),
        type: 'query',
      }),
      makeDescriptor('MutationResolver', 'updateItems', {
        outputType: listOf(payloadType),
        type: 'mutation',
      }),
      makeDescriptor('SubscriptionResolver', 'itemStream', {
        outputType: listOf(payloadType),
        type: 'subscription',
      }),
    ]);

    const valuesArgType = schema.getQueryType()?.getFields().tags?.args[0]?.type;
    const queryOutput = schema.getQueryType()?.getFields().tags?.type;
    const mutationOutput = schema.getMutationType()?.getFields().updateItems?.type;
    const subscriptionOutput = schema.getSubscriptionType()?.getFields().itemStream?.type;

    expect(valuesArgType instanceof GraphQLList).toBe(true);
    expect(valuesArgType?.toString()).toBe('[String]');

    expect(queryOutput instanceof GraphQLList).toBe(true);
    expect(queryOutput?.toString()).toBe('[String]');

    expect(mutationOutput instanceof GraphQLList).toBe(true);
    expect(mutationOutput?.toString()).toBe('[ListPayload]');

    expect(subscriptionOutput instanceof GraphQLList).toBe(true);
    expect(subscriptionOutput?.toString()).toBe('[ListPayload]');
  });
});
