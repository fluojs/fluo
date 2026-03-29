import { describe, expect, it } from 'vitest';
import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  buildSchema,
} from 'graphql';

import type { Container } from '@konekti/di';

import { createCodeFirstSchema } from './schema.js';
import type { ResolverDescriptor } from './types.js';

const deps = {
  GraphQLBoolean,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  buildSchema,
};

const fakeContainer = {} as unknown as Container;

function makeDescriptor(targetName: string, fieldName: string): ResolverDescriptor {
  return {
    handlers: [
      {
        argFields: [],
        fieldName,
        methodKey: 'resolve',
        methodName: 'resolve',
        type: 'query',
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
