import {
  GraphQLError,
  type FieldNode,
  Kind,
  type DocumentNode,
  type FragmentSpreadNode,
  type InlineFragmentNode,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';

import type { GraphqlRequestLimitsOptions } from './types.js';

const DEFAULT_GRAPHQL_REQUEST_LIMITS: Required<GraphqlRequestLimitsOptions> = {
  maxComplexity: 250,
  maxCost: 500,
  maxDepth: 12,
};

interface GraphqlValidationPluginContext {
  addValidationRule(rule: ValidationRule): void;
}

interface GraphqlValidationPlugin {
  onValidate?(context: GraphqlValidationPluginContext): void;
}

interface GraphqlDocumentMetrics {
  complexity: number;
  cost: number;
  maxDepth: number;
}

export function resolveGraphqlRequestLimits(
  limits: GraphqlRequestLimitsOptions | false | undefined,
): Required<GraphqlRequestLimitsOptions> | undefined {
  if (limits === false) {
    return undefined;
  }

  return {
    maxComplexity: limits?.maxComplexity ?? DEFAULT_GRAPHQL_REQUEST_LIMITS.maxComplexity,
    maxCost: limits?.maxCost ?? DEFAULT_GRAPHQL_REQUEST_LIMITS.maxCost,
    maxDepth: limits?.maxDepth ?? DEFAULT_GRAPHQL_REQUEST_LIMITS.maxDepth,
  };
}

export function createGraphqlValidationPlugin(options: {
  introspection: boolean;
  limits: Required<GraphqlRequestLimitsOptions> | undefined;
}): GraphqlValidationPlugin | undefined {
  const validationRules: ValidationRule[] = [];

  if (!options.introspection) {
    validationRules.push(createDisableIntrospectionRule());
  }

  if (options.limits) {
    validationRules.push(createMaxDepthRule(options.limits.maxDepth));
    validationRules.push(createMaxComplexityRule(options.limits.maxComplexity));
    validationRules.push(createMaxCostRule(options.limits.maxCost));
  }

  if (validationRules.length === 0) {
    return undefined;
  }

  return {
    onValidate({ addValidationRule }) {
      for (const rule of validationRules) {
        addValidationRule(rule);
      }
    },
  };
}

function createDisableIntrospectionRule(): ValidationRule {
  return (context: ValidationContext) => ({
    Field(node: FieldNode) {
      const fieldName = node.name.value;

      if (fieldName === '__schema' || fieldName === '__type') {
        context.reportError(new GraphQLError(`GraphQL introspection is disabled, but the query requested "${fieldName}".`));
      }
    },
  });
}

function createMaxDepthRule(maxDepth: number): ValidationRule {
  return (context: ValidationContext) => {
    const metrics = analyzeGraphqlDocument(context.getDocument());

    if (metrics.maxDepth > maxDepth) {
      context.reportError(
        new GraphQLError(`GraphQL query depth ${String(metrics.maxDepth)} exceeds the configured limit of ${String(maxDepth)}.`),
      );
    }

    return {};
  };
}

function createMaxComplexityRule(maxComplexity: number): ValidationRule {
  return (context: ValidationContext) => {
    const metrics = analyzeGraphqlDocument(context.getDocument());

    if (metrics.complexity > maxComplexity) {
      context.reportError(
        new GraphQLError(
          `GraphQL query complexity ${String(metrics.complexity)} exceeds the configured limit of ${String(maxComplexity)}.`,
        ),
      );
    }

    return {};
  };
}

function createMaxCostRule(maxCost: number): ValidationRule {
  return (context: ValidationContext) => {
    const metrics = analyzeGraphqlDocument(context.getDocument());

    if (metrics.cost > maxCost) {
      context.reportError(
        new GraphQLError(`GraphQL query cost ${String(metrics.cost)} exceeds the configured limit of ${String(maxCost)}.`),
      );
    }

    return {};
  };
}

function analyzeGraphqlDocument(document: DocumentNode): GraphqlDocumentMetrics {
  const fragments = new Map<string, FragmentDefinitionNode>();

  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  const metrics: GraphqlDocumentMetrics = {
    complexity: 0,
    cost: 0,
    maxDepth: 0,
  };

  const walkSelectionSet = (selectionSet: SelectionSetNode, depth: number, activeFragments: Set<string>): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        const nextDepth = depth + 1;
        metrics.maxDepth = Math.max(metrics.maxDepth, nextDepth);
        metrics.complexity += 1;
        metrics.cost += nextDepth;

        if (selection.selectionSet) {
          walkSelectionSet(selection.selectionSet, nextDepth, activeFragments);
        }

        continue;
      }

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        walkInlineFragment(selection, depth, activeFragments);
        continue;
      }

      if (selection.kind !== Kind.FRAGMENT_SPREAD) {
        continue;
      }

      walkFragmentSpread(selection, depth, activeFragments);
    }
  };

  const walkInlineFragment = (fragment: InlineFragmentNode, depth: number, activeFragments: Set<string>): void => {
    walkSelectionSet(fragment.selectionSet, depth, activeFragments);
  };

  const walkFragmentSpread = (fragmentSpread: FragmentSpreadNode, depth: number, activeFragments: Set<string>): void => {
    const fragmentName = fragmentSpread.name.value;

    if (activeFragments.has(fragmentName)) {
      return;
    }

    const fragment = fragments.get(fragmentName);

    if (!fragment) {
      return;
    }

    activeFragments.add(fragmentName);
    walkSelectionSet(fragment.selectionSet, depth, activeFragments);
    activeFragments.delete(fragmentName);
  };

  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      walkSelectionSet(definition.selectionSet, 0, new Set<string>());
    }
  }

  return metrics;
}
