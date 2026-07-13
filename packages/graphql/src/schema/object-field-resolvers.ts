import type { GraphQLFieldConfigMap, GraphQLOutputType } from 'graphql';

import type {
  GraphQLContext as FluoGraphQLContext,
  GraphqlRootOutputType,
  ResolverDescriptor,
  ResolverHandlerDescriptor,
} from '../types.js';

type ObjectFieldResolverEntry = {
  readonly descriptor: ResolverDescriptor;
  readonly handler: ResolverHandlerDescriptor;
};

type ResolveOutputType = (outputType: GraphqlRootOutputType) => GraphQLOutputType;

type InvokeObjectFieldResolver = (
  descriptor: ResolverDescriptor,
  handler: ResolverHandlerDescriptor,
  source: unknown,
  contextValue: FluoGraphQLContext,
) => Promise<unknown>;

function assertNever(value: never): never {
  throw new Error(`Unsupported GraphQL field resolver parameter binding: ${String(value)}`);
}

/**
 * Indexes object field resolver descriptors and attaches them to matching code-first object types.
 */
export class ObjectFieldResolverRegistry {
  private readonly attachedTypeNames = new Set<string>();
  private readonly entriesByTypeName = new Map<string, Map<string, ObjectFieldResolverEntry>>();

  constructor(descriptors: readonly ResolverDescriptor[]) {
    for (const descriptor of descriptors) {
      for (const handler of descriptor.handlers) {
        if (handler.type !== 'field') {
          continue;
        }

        const fields = this.entriesByTypeName.get(descriptor.typeName) ?? new Map<string, ObjectFieldResolverEntry>();

        if (fields.has(handler.fieldName)) {
          throw new Error(
            `GraphQL schema conflict: object field resolver "${descriptor.typeName}.${handler.fieldName}" is registered more than once.`,
          );
        }

        fields.set(handler.fieldName, { descriptor, handler });
        this.entriesByTypeName.set(descriptor.typeName, fields);
      }
    }
  }

  attach(
    typeName: string,
    fields: GraphQLFieldConfigMap<unknown, FluoGraphQLContext>,
    resolveOutputType: ResolveOutputType,
    invokeResolver: InvokeObjectFieldResolver,
  ): GraphQLFieldConfigMap<unknown, FluoGraphQLContext> {
    const resolverFields = this.entriesByTypeName.get(typeName);

    if (!resolverFields) {
      return fields;
    }

    this.attachedTypeNames.add(typeName);
    const attachedFields: GraphQLFieldConfigMap<unknown, FluoGraphQLContext> = { ...fields };

    for (const [fieldName, entry] of resolverFields) {
      const existingField = attachedFields[fieldName];
      const outputType = entry.handler.outputType ? resolveOutputType(entry.handler.outputType) : existingField?.type;

      if (!outputType) {
        throw new Error(
          `GraphQL object field resolver "${typeName}.${fieldName}" must target an existing field or declare a type.`,
        );
      }

      attachedFields[fieldName] = {
        ...existingField,
        resolve: async (source: unknown, _args: Record<string, unknown>, contextValue: FluoGraphQLContext) =>
          invokeResolver(entry.descriptor, entry.handler, source, contextValue),
        type: outputType,
      };
    }

    return attachedFields;
  }

  createMethodArguments(
    handler: ResolverHandlerDescriptor,
    parent: unknown,
    contextValue: FluoGraphQLContext,
  ): unknown[] {
    const lastBinding = handler.parameterBindings.at(-1);
    const methodArguments = Array.from<unknown>({ length: (lastBinding?.index ?? -1) + 1 });

    for (const binding of handler.parameterBindings) {
      switch (binding.kind) {
        case 'parent':
          methodArguments[binding.index] = parent;
          break;
        case 'context':
          methodArguments[binding.index] = contextValue;
          break;
        default:
          assertNever(binding.kind);
      }
    }

    return methodArguments;
  }

  assertAllTargetsAttached(): void {
    for (const typeName of this.entriesByTypeName.keys()) {
      if (!this.attachedTypeNames.has(typeName)) {
        throw new Error(
          `GraphQL object field resolver target type "${typeName}" is not reachable from a code-first root operation output type.`,
        );
      }
    }
  }
}
