import {
  GraphQLError,
  type ExecutionArgs,
  type FieldNode,
  Kind,
  type DocumentNode,
  type FragmentSpreadNode,
  type InlineFragmentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
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
  onExecute?(payload: GraphqlOperationHookPayload): void;
  onSubscribe?(payload: GraphqlOperationHookPayload): void;
  onValidate?(context: GraphqlValidationPluginContext): void;
}

interface GraphqlOperationHookPayload {
  args: Pick<ExecutionArgs, 'document' | 'operationName'>;
  setResultAndStopExecution(result: { errors: GraphQLError[] }): void;
}

interface GraphqlDocumentMetrics {
  complexity: number;
  cost: number;
  maxDepth: number;
}

interface GraphqlLimitCheck {
  actual: number;
  label: 'depth' | 'complexity' | 'cost';
  limit: number;
}

/**
 * Resolve the effective GraphQL request budget configuration for one module instance.
 *
 * @param limits User-provided request limit overrides, or `false` to disable built-in budgets.
 * @returns The normalized request limits, or `undefined` when guardrails are explicitly disabled.
 */
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

/**
 * Create the GraphQL plugin that enforces introspection and request-budget guardrails.
 *
 * @param options Effective guardrail settings for introspection and per-request limits.
 * @returns An Envelop-compatible plugin when at least one guardrail is enabled.
 */
export function createGraphqlValidationPlugin(options: {
  introspection: boolean;
  limits: Required<GraphqlRequestLimitsOptions> | undefined;
}): GraphqlValidationPlugin | undefined {
  const validationRules: ValidationRule[] = [];

  if (!options.introspection) {
    validationRules.push(createDisableIntrospectionRule());
  }

  if (validationRules.length === 0 && !options.limits) {
    return undefined;
  }

  const enforceRequestLimits = options.limits
    ? (payload: GraphqlOperationHookPayload) => {
        const errors = evaluateGraphqlRequestLimits(payload.args.document, payload.args.operationName, options.limits!);

        if (errors.length > 0) {
          payload.setResultAndStopExecution({ errors });
        }
      }
    : undefined;

  return {
    ...(enforceRequestLimits
      ? {
          onExecute: enforceRequestLimits,
          onSubscribe: enforceRequestLimits,
        }
      : {}),
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

function evaluateGraphqlRequestLimits(
  document: DocumentNode,
  operationName: string | null | undefined,
  limits: Required<GraphqlRequestLimitsOptions>,
): GraphQLError[] {
  const metrics = analyzeGraphqlOperation(document, operationName);

  if (!metrics) {
    return [];
  }

  const checks: GraphqlLimitCheck[] = [
    {
      actual: metrics.maxDepth,
      label: 'depth',
      limit: limits.maxDepth,
    },
    {
      actual: metrics.complexity,
      label: 'complexity',
      limit: limits.maxComplexity,
    },
    {
      actual: metrics.cost,
      label: 'cost',
      limit: limits.maxCost,
    },
  ];

  return checks.flatMap((check) => {
    if (check.actual <= check.limit) {
      return [];
    }

    return [
      new GraphQLError(
        `GraphQL query ${check.label} ${String(check.actual)} exceeds the configured limit of ${String(check.limit)}.`,
      ),
    ];
  });
}

function analyzeGraphqlOperation(
  document: DocumentNode,
  operationName: string | null | undefined,
): GraphqlDocumentMetrics | undefined {
  const fragments = new Map<string, FragmentDefinitionNode>();
  const operations: OperationDefinitionNode[] = [];

  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
      continue;
    }

    if (definition.kind === Kind.OPERATION_DEFINITION) {
      operations.push(definition);
    }
  }

  const operation = resolveOperationDefinition(operations, operationName);

  if (!operation) {
    return undefined;
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

  walkSelectionSet(operation.selectionSet, 0, new Set<string>());

  return metrics;
}

function resolveOperationDefinition(
  operations: readonly OperationDefinitionNode[],
  operationName: string | null | undefined,
): OperationDefinitionNode | undefined {
  if (operationName) {
    return operations.find((operation) => operation.name?.value === operationName);
  }

  return operations.length === 1 ? operations[0] : undefined;
}
