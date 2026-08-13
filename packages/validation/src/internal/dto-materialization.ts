import type { Constructor } from '@fluojs/core';

import { DtoValidationError } from '../errors.js';
import type { ValidationIssue } from '../types.js';
import { getCachedDtoMetadata } from './dto-metadata-cache.js';
import { assignSafeOwnEnumerableProperties, isPlainObject } from './object-utils.js';

export interface NestedTraversalContext {
  readonly active: WeakSet<object>;
  readonly hydrateExistingInstances?: boolean;
  readonly materialized?: WeakMap<object, WeakMap<Constructor, object>>;
}

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

export function exitTraversal(value: unknown, context?: NestedTraversalContext): void {
  if (!context || typeof value !== 'object' || value === null) {
    return;
  }

  context.active.delete(value);
}

export function createNestedDtoInstance<T>(
  target: Constructor<T>,
  rawValue: unknown,
  context?: NestedTraversalContext,
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
      assignSafeOwnEnumerableProperties(instance, rawValue);

      for (const propertyKey of metadata.mergedPropertyKeys) {
        const sourceKey = metadata.bindingMap.get(propertyKey)?.key;
        if (!sourceKey) continue;
        instance[propertyKey] = rawValue[sourceKey];
      }
    }

    for (const nestedEntry of metadata.nestedDtoTransforms) {
      const currentValue = instance[nestedEntry.propertyKey];
      if (currentValue === undefined || currentValue === null) {
        continue;
      }

      instance[nestedEntry.propertyKey] = transformNestedCollectionValue(currentValue, nestedEntry.target, context);
    }

    return instance as T;
  } finally {
    exitTraversal(rawValue, context);
  }
}

function transformNestedValue(value: unknown, target: Constructor, context?: NestedTraversalContext): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (value instanceof target && context?.hydrateExistingInstances !== true) {
    return value;
  }

  if (!(value instanceof target) && !isPlainObject(value)) {
    return value;
  }

  return createNestedDtoInstance(target, value, context);
}

function transformNestedCollectionValue(value: unknown, target: Constructor, context?: NestedTraversalContext): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformNestedValue(item, target, context));
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (item) => transformNestedValue(item, target, context)));
  }

  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, item]) => [key, transformNestedValue(item, target, context)]));
  }

  return transformNestedValue(value, target, context);
}

function buildInvalidRootIssue(): ValidationIssue {
  return {
    code: 'INVALID_DTO',
    message: 'DTO root value must be a plain object.',
  };
}

export function assertValidRootValue(value: unknown, target: Constructor): void {
  if (value instanceof target || isPlainObject(value)) {
    return;
  }

  throw new DtoValidationError('Validation failed.', [buildInvalidRootIssue()]);
}
