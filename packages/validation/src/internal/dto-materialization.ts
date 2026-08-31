import type { Constructor } from '@fluojs/core';

import { DtoValidationError } from '../errors.js';
import type { MaterializeOptions, ValidationIssue } from '../types.js';
import { getCachedDtoMetadata } from './dto-metadata-cache.js';
import { assignSafeOwnEnumerableProperties, isPlainObject, isSafeOwnEnumerableProperty } from './object-utils.js';
import { joinFieldPath } from './validation-issues.js';

/**
 * Carries invocation-local DTO traversal state across materialization and validation.
 */
export interface NestedTraversalContext {
  readonly active: WeakSet<object>;
  readonly hydrateExistingInstances?: boolean;
  readonly undeclaredProperties?: MaterializeOptions['undeclaredProperties'];
  readonly materialized?: WeakMap<object, WeakMap<Constructor, object>>;
}

const materializationCycleTarget: Constructor = class {};

function getMaterializedInstance(
  rawValue: object,
  target: Constructor,
  context?: NestedTraversalContext,
): object | undefined {
  return context?.materialized?.get(rawValue)?.get(target);
}

function rememberMaterializedInstance(
  rawValue: object,
  target: Constructor,
  instance: object,
  context?: NestedTraversalContext,
): void {
  if (!context?.materialized) {
    return;
  }

  let instancesByTarget = context.materialized.get(rawValue);
  if (!instancesByTarget) {
    instancesByTarget = new WeakMap<Constructor, object>();
    context.materialized.set(rawValue, instancesByTarget);
  }

  instancesByTarget.set(target, instance);
}

function canMaterialize<T>(value: unknown, target: Constructor<T>): value is object {
  return value instanceof target || isPlainObject(value);
}

/**
 * Enters a traversal value when it is not already active.
 *
 * @param value Candidate traversal value.
 * @param context Invocation-local traversal state.
 * @returns Whether traversal may continue for the value.
 */
export function enterTraversal(value: unknown, context?: NestedTraversalContext): boolean {
  if (!context || typeof value !== 'object' || value === null) {
    return true;
  }

  if (context.active.has(value)) {
    return false;
  }

  context.active.add(value);
  return true;
}

/**
 * Releases a traversal value after materialization or validation completes.
 *
 * @param value Traversal value to release.
 * @param context Invocation-local traversal state.
 */
export function exitTraversal(value: unknown, context?: NestedTraversalContext): void {
  if (!context || typeof value !== 'object' || value === null) {
    return;
  }

  if (context.materialized?.get(value)?.has(materializationCycleTarget)) {
    return;
  }

  context.active.delete(value);
}

/**
 * Creates or reuses a nested DTO instance for a raw value.
 *
 * @param target Nested DTO constructor.
 * @param rawValue Raw nested value.
 * @param context Invocation-local traversal state.
 * @returns The materialized DTO value or the original unsupported value.
 */
export function createNestedDtoInstance<T>(
  target: Constructor<T>,
  rawValue: unknown,
  context?: NestedTraversalContext,
  fieldPrefix?: string,
): T {
  if (rawValue instanceof target && context?.hydrateExistingInstances !== true) {
    return rawValue as T;
  }

  if (!canMaterialize(rawValue, target)) {
    return rawValue as T;
  }

  const rawObject: object = rawValue;
  const rememberedInstance = getMaterializedInstance(rawObject, target, context);
  if (rememberedInstance) {
    return rememberedInstance as T;
  }

  if (context?.active.has(rawObject)) {
    rememberMaterializedInstance(rawObject, materializationCycleTarget, rawObject, context);
    return rawValue as T;
  }

  const instance = (rawValue instanceof target ? rawValue : new target()) as Record<PropertyKey, unknown>;
  rememberMaterializedInstance(rawObject, target, instance, context);

  if (!enterTraversal(rawValue, context)) {
    return rawValue as T;
  }

  try {
    const metadata = getCachedDtoMetadata(target);

    if (isPlainObject(rawValue)) {
      if (context?.undeclaredProperties === 'reject') {
        const declaredKeys = new Set<PropertyKey>([
          ...Reflect.ownKeys(instance),
          ...metadata.mergedPropertyKeys,
          ...Array.from(metadata.bindingMap.values()).flatMap((binding) => binding.key === undefined ? [] : [binding.key]),
        ]);
        const issues = Reflect.ownKeys(rawValue)
          .filter((key) => isSafeOwnEnumerableProperty(rawValue, key) && !declaredKeys.has(key))
          .map((key): ValidationIssue => {
            const field = fieldPrefix ? joinFieldPath(fieldPrefix, String(key)) : String(key);
            return {
              code: 'UNDECLARED_PROPERTY',
              field,
              message: `${field} is not declared by the DTO.`,
            };
          });

        if (issues.length > 0) {
          throw new DtoValidationError('Validation failed.', issues);
        }
      }

      assignSafeOwnEnumerableProperties(instance, rawValue);

      for (const propertyKey of metadata.mergedPropertyKeys) {
        const sourceKey = metadata.bindingMap.get(propertyKey)?.key;
        if (!sourceKey) continue;
        instance[propertyKey] = rawValue[sourceKey];
      }
    }

    for (const nestedEntry of metadata.nestedDtoTransforms) {
      const hasConflictingTarget = metadata.nestedDtoTransforms.some(
        (candidate) => candidate.propertyKey === nestedEntry.propertyKey && candidate.target !== nestedEntry.target,
      );
      if (hasConflictingTarget) {
        continue;
      }

      const currentValue = instance[nestedEntry.propertyKey];
      if (currentValue === undefined || currentValue === null) {
        continue;
      }

      const fieldPath = fieldPrefix
        ? joinFieldPath(fieldPrefix, String(nestedEntry.propertyKey))
        : String(nestedEntry.propertyKey);
      instance[nestedEntry.propertyKey] = transformNestedCollectionValue(currentValue, nestedEntry.target, context, fieldPath);
    }

    return instance as T;
  } finally {
    exitTraversal(rawValue, context);
  }
}

function transformNestedValue(
  value: unknown,
  target: Constructor,
  context: NestedTraversalContext | undefined,
  fieldPrefix: string,
): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (value instanceof target && context?.hydrateExistingInstances !== true) {
    return value;
  }

  if (!(value instanceof target) && !isPlainObject(value)) {
    return value;
  }

  return createNestedDtoInstance(target, value, context, fieldPrefix);
}

function transformNestedCollectionValue(
  value: unknown,
  target: Constructor,
  context: NestedTraversalContext | undefined,
  fieldPrefix: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => transformNestedValue(item, target, context, `${fieldPrefix}[${String(index)}]`));
  }

  if (value instanceof Set) {
    return new Set(Array.from(
      value.values(),
      (item, index) => transformNestedValue(item, target, context, `${fieldPrefix}[${String(index)}]`),
    ));
  }

  if (value instanceof Map) {
    return new Map(Array.from(
      value.entries(),
      ([key, item], index) => [key, transformNestedValue(item, target, context, `${fieldPrefix}[${String(index)}]`)],
    ));
  }

  return transformNestedValue(value, target, context, fieldPrefix);
}

function buildInvalidRootIssue(): ValidationIssue {
  return {
    code: 'INVALID_DTO',
    message: 'DTO root value must be a plain object.',
  };
}

/**
 * Asserts that a root value can be validated as the requested DTO.
 *
 * @param value Root value to validate.
 * @param target Requested DTO constructor.
 */
export function assertValidRootValue(value: unknown, target: Constructor): void {
  if (value instanceof target || isPlainObject(value)) {
    return;
  }

  throw new DtoValidationError('Validation failed.', [buildInvalidRootIssue()]);
}
