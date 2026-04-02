import { getDtoValidationSchema, type Constructor, type DtoFieldValidationRule, type MetadataPropertyKey } from '@konekti/core';
import { DefaultValidator } from '@konekti/validation';

import { isGraphqlListTypeRef } from './types.js';
import type { GraphqlArgType, GraphqlRootOutputType, GraphqlScalarTypeName, ResolverHandlerDescriptor } from './types.js';

const defaultValidator = new DefaultValidator();

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

export function resolveArgType(handler: ResolverHandlerDescriptor, argName: string): GraphqlArgType {
  const explicit = handler.argTypes?.[argName];
  if (explicit) {
    return explicit;
  }

  return resolveArgScalarType(handler, argName);
}

export function resolveOutputType(handler: ResolverHandlerDescriptor): GraphqlRootOutputType {
  return handler.outputType ?? 'string';
}

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
    Object.assign(instance, args);
  } else {
    for (const descriptor of argFieldDescriptors) {
      if (Object.hasOwn(args, descriptor.argName)) {
        instance[descriptor.fieldName] = args[descriptor.argName];
      }
    }
  }

  await defaultValidator.validate(instance, inputClass as Constructor);

  return instance;
}
