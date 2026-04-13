import { type Constructor, type MetadataPropertyKey } from '@fluojs/core';
import { getDtoValidationSchema, type DtoFieldValidationRule } from '@fluojs/core/internal';
import { DefaultValidator } from '@fluojs/validation';

import { isGraphqlListTypeRef } from '../types.js';
import type { GraphqlArgType, GraphqlRootOutputType, GraphqlScalarTypeName, ResolverHandlerDescriptor } from '../types.js';

const defaultValidator = new DefaultValidator();
const blockedGraphqlInputKeys = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeGraphqlInputKey(fieldName: string): boolean {
  return !blockedGraphqlInputKeys.has(fieldName);
}

function hasRule(rules: readonly DtoFieldValidationRule[], kind: DtoFieldValidationRule['kind']): boolean {
  return rules.some((rule) => rule.kind === kind);
}

function inferScalarFromValidationRules(rules: readonly DtoFieldValidationRule[]): GraphqlScalarTypeName | undefined {
  if (hasRule(rules, 'int')) {
    return 'int';
  }

  if (hasRule(rules, 'number') || hasRule(rules, 'min') || hasRule(rules, 'max') || hasRule(rules, 'divisibleBy')) {
    return 'float';
  }

  if (hasRule(rules, 'boolean')) {
    return 'boolean';
  }

  if (hasRule(rules, 'string') || hasRule(rules, 'validatorjs')) {
    return 'string';
  }

  return undefined;
}

function inferScalarFromDefaultValue(value: unknown): GraphqlScalarTypeName | undefined {
  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  return undefined;
}

function toPropertyKey(fieldName: string): MetadataPropertyKey {
  return fieldName;
}

/**
 * Infers the scalar GraphQL type for one resolver argument from explicit metadata or DTO validation rules.
 *
 * @param handler Resolver descriptor that carries explicit arg metadata and DTO bindings.
 * @param argName GraphQL argument name to inspect.
 * @returns The inferred scalar type name used by the schema builder.
 */
export function resolveArgScalarType(handler: ResolverHandlerDescriptor, argName: string): GraphqlScalarTypeName {
  const explicit = handler.argTypes?.[argName];

  if (explicit && !isGraphqlListTypeRef(explicit)) {
    return explicit;
  }

  if (!handler.inputClass) {
    return 'string';
  }

  const mappedFieldName = handler.argFields.find((field) => field.argName === argName)?.fieldName;

  if (!mappedFieldName) {
    return 'string';
  }

  const validationEntry = getDtoValidationSchema(handler.inputClass as Constructor).find(
    (entry: { propertyKey: MetadataPropertyKey; rules: readonly DtoFieldValidationRule[] }) =>
      entry.propertyKey === toPropertyKey(mappedFieldName),
  );
  const inferredFromRules = validationEntry ? inferScalarFromValidationRules(validationEntry.rules) : undefined;

  if (inferredFromRules) {
    return inferredFromRules;
  }

  try {
    const seed = new (handler.inputClass as Constructor)() as Record<string, unknown>;
    return inferScalarFromDefaultValue(seed[mappedFieldName]) ?? 'string';
  } catch {
    return 'string';
  }
}

/**
 * Resolves the scalar GraphQL argument type for one resolver argument.
 *
 * @param handler Resolver descriptor that carries explicit arg metadata and DTO bindings.
 * @param argName GraphQL argument name to inspect.
 * @returns The inferred scalar type name used by the schema builder.
 */
export function resolveArgType(handler: ResolverHandlerDescriptor, argName: string): GraphqlArgType {
  const explicit = handler.argTypes?.[argName];
  if (explicit) {
    return explicit;
  }

  return resolveArgScalarType(handler, argName);
}

/**
 * Resolves the GraphQL output type for one resolver handler.
 *
 * @param handler Resolver descriptor that may define an explicit output type.
 * @returns The configured output type, or the default `string` scalar fallback.
 */
export function resolveOutputType(handler: ResolverHandlerDescriptor): GraphqlRootOutputType {
  return handler.outputType ?? 'string';
}

/**
 * Materializes and validates one resolver input object from GraphQL arguments.
 *
 * @param inputClass Optional DTO constructor used for instantiation and validation.
 * @param args GraphQL argument payload received for the resolver call.
 * @param argFieldDescriptors Mapping between GraphQL argument names and DTO field names.
 * @returns The validated DTO instance, raw argument record, or `undefined` when no input was provided.
 */
export async function createGraphqlInput(
  inputClass: Function | undefined,
  args: Record<string, unknown>,
  argFieldDescriptors: ResolverHandlerDescriptor['argFields'],
): Promise<unknown> {
  if (!inputClass) {
    return Object.keys(args).length === 0 ? undefined : args;
  }

  const instance = new (inputClass as Constructor)() as Record<string, unknown>;

  if (argFieldDescriptors.length === 0) {
    for (const [fieldName, value] of Object.entries(args)) {
      if (!isSafeGraphqlInputKey(fieldName)) {
        continue;
      }

      instance[fieldName] = value;
    }
  } else {
    for (const descriptor of argFieldDescriptors) {
      if (isSafeGraphqlInputKey(descriptor.fieldName) && Object.hasOwn(args, descriptor.argName)) {
        instance[descriptor.fieldName] = args[descriptor.argName];
      }
    }
  }

  await defaultValidator.validate(instance, inputClass as Constructor);

  return instance;
}
