import { describe, expect, it } from 'vitest';

import { parse, validate, GraphQLObjectType, GraphQLSchema, GraphQLString, type ExecutionResult, type ValidationRule } from 'graphql';

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

function executeWithGuardrails(options: {
  introspection: boolean;
  limits?: false | { maxComplexity?: number; maxCost?: number; maxDepth?: number };
  operationName?: string;
  query: string;
}): ExecutionResult | undefined {
  const plugin = createGraphqlValidationPlugin({
    introspection: options.introspection,
    limits: resolveGraphqlRequestLimits(options.limits),
  });
  let result: ExecutionResult | undefined;

  plugin?.onExecute?.({
    args: {
      document: parse(options.query),
      operationName: options.operationName,
    },
    setResultAndStopExecution(nextResult) {
      result = nextResult;
    },
  });

  return result;
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

  it('rejects selected operations that exceed configured depth, complexity, or cost', () => {
    const depthErrors = executeWithGuardrails({
      introspection: true,
      limits: { maxDepth: 2 },
      query: 'query DeepOp { nested { child { value } } }',
    });
    const complexityErrors = executeWithGuardrails({
      introspection: true,
      limits: { maxComplexity: 2 },
      query: 'query WideOp { a: greeting b: greeting c: greeting }',
    });
    const costErrors = executeWithGuardrails({
      introspection: true,
      limits: { maxCost: 5 },
      query: 'query CostlyOp { nested { child { value } } }',
    });

    expect(depthErrors?.errors?.[0]?.message).toBe('GraphQL query depth 3 exceeds the configured limit of 2.');
    expect(complexityErrors?.errors?.[0]?.message).toBe('GraphQL query complexity 3 exceeds the configured limit of 2.');
    expect(costErrors?.errors?.[0]?.message).toBe('GraphQL query cost 6 exceeds the configured limit of 5.');
  });
});
