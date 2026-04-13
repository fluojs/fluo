import { describe, expect, it } from 'vitest';

import { parse, validate, GraphQLObjectType, GraphQLSchema, GraphQLString, type ValidationRule } from 'graphql';

import { createGraphqlValidationPlugin, resolveGraphqlRequestLimits } from './guardrails.js';

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    fields: {
      greeting: {
        type: GraphQLString,
      },
      nested: {
        type: new GraphQLObjectType({
          name: 'NestedQuery',
          fields: {
            child: {
              type: new GraphQLObjectType({
                name: 'NestedChildQuery',
                fields: {
                  value: {
                    type: GraphQLString,
                  },
                },
              }),
            },
          },
        }),
      },
    },
    name: 'Query',
  }),
});

function createValidationRules(options: { introspection: boolean; limits?: false | { maxComplexity?: number; maxCost?: number; maxDepth?: number } }) {
  const plugin = createGraphqlValidationPlugin({
    introspection: options.introspection,
    limits: resolveGraphqlRequestLimits(options.limits),
  });
  const rules: ValidationRule[] = [];

  plugin?.onValidate?.({
    addValidationRule(rule) {
      rules.push(rule);
    },
  });

  return rules;
}

describe('graphql guardrails', () => {
  it('enables conservative request limits by default', () => {
    expect(resolveGraphqlRequestLimits(undefined)).toEqual({
      maxComplexity: 250,
      maxCost: 500,
      maxDepth: 12,
    });
  });

  it('disables introspection unless explicitly enabled', () => {
    const errors = validate(schema, parse('{ __schema { queryType { name } } }'), createValidationRules({ introspection: false }));

    expect(errors[0]?.message).toContain('introspection');
  });

  it('rejects documents that exceed configured depth, complexity, or cost', () => {
    const depthErrors = validate(
      schema,
      parse('{ nested { child { value } } }'),
      createValidationRules({ introspection: true, limits: { maxDepth: 2 } }),
    );
    const complexityErrors = validate(
      schema,
      parse('{ a: greeting b: greeting c: greeting }'),
      createValidationRules({ introspection: true, limits: { maxComplexity: 2 } }),
    );
    const costErrors = validate(
      schema,
      parse('{ nested { child { value } } }'),
      createValidationRules({ introspection: true, limits: { maxCost: 5 } }),
    );

    expect(depthErrors[0]?.message).toBe('GraphQL query depth 3 exceeds the configured limit of 2.');
    expect(complexityErrors[0]?.message).toBe('GraphQL query complexity 3 exceeds the configured limit of 2.');
    expect(costErrors[0]?.message).toBe('GraphQL query cost 6 exceeds the configured limit of 5.');
  });
});
