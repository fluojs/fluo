import type { MetadataPropertyKey } from '@fluojs/core';

import { getClassSerializationOptions, getFieldSerializationMetadata, type SerializationFieldMetadata } from './metadata.js';

interface SerializationContext {
  metadataCache: WeakMap<Function, { classOptions: ReturnType<typeof getClassSerializationOptions>; fieldMetadata: ReturnType<typeof getFieldSerializationMetadata> }>;
  references: WeakMap<object, { active: boolean; value: unknown }>;
}

function isObjectLike(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function applyTransforms(value: unknown, metadata: SerializationFieldMetadata): unknown {
  let transformed = value;

  for (const transform of metadata.transforms ?? []) {
    transformed = transform(transformed);
  }

  return transformed;
}

function resolveCandidateKeys(
  value: Record<string | symbol, unknown>,
  fieldMetadata: Map<MetadataPropertyKey, SerializationFieldMetadata>,
  excludeExtraneous: boolean,
): MetadataPropertyKey[] {
  if (excludeExtraneous) {
    return [...fieldMetadata.entries()]
      .filter(([, metadata]) => metadata.exposed === true)
      .map(([propertyKey]) => propertyKey);
  }

  const keys = new Set<MetadataPropertyKey>([
    ...Object.keys(value),
    ...Object.getOwnPropertySymbols(value),
  ]);

  for (const [propertyKey, metadata] of fieldMetadata) {
    if (metadata.exposed === true) {
      keys.add(propertyKey);
    }
  }

  return [...keys];
}

function getCachedMetadata(
  constructor: Function,
  context: SerializationContext,
): { classOptions: ReturnType<typeof getClassSerializationOptions>; fieldMetadata: ReturnType<typeof getFieldSerializationMetadata> } {
  const cached = context.metadataCache.get(constructor);

  if (cached) {
    return cached;
  }

  const next = {
    classOptions: getClassSerializationOptions(constructor),
    fieldMetadata: getFieldSerializationMetadata(constructor),
  };

  context.metadataCache.set(constructor, next);
  return next;
}

function getCircularOrSharedValue(value: object, context: SerializationContext): unknown {
  const cached = context.references.get(value);

  if (!cached) {
    return undefined;
  }

  if (cached.active) {
    return undefined;
  }

  return cached.value;
}

function markSerializationStart(value: object, serialized: unknown, context: SerializationContext): void {
  context.references.set(value, {
    active: true,
    value: serialized,
  });
}

function markSerializationComplete(value: object, context: SerializationContext): void {
  const cached = context.references.get(value);

  if (!cached) {
    return;
  }

  cached.active = false;
}

function serializeWithTrackedReference<TSerialized>(
  value: object,
  context: SerializationContext,
  create: () => TSerialized,
  fill: (serialized: TSerialized) => void,
): TSerialized {
  const cachedValue = getCircularOrSharedValue(value, context);

  if (context.references.has(value)) {
    return cachedValue as TSerialized;
  }

  const serialized = create();
  markSerializationStart(value, serialized, context);

  try {
    fill(serialized);
    return serialized;
  } finally {
    markSerializationComplete(value, context);
  }
}

function serializeClassInstance(
  value: Record<string | symbol, unknown>,
  context: SerializationContext,
): Record<string | symbol, unknown> {
  const constructor = value.constructor as Function;
  const { classOptions, fieldMetadata } = getCachedMetadata(constructor, context);
  const hasMetadata = fieldMetadata.size > 0 || classOptions.excludeExtraneous === true;

  if (!hasMetadata) {
    return serializeRecord(value, context);
  }

  return serializeWithTrackedReference<Record<string | symbol, unknown>>(value, context, () => ({}), (serialized) => {
    const candidateKeys = resolveCandidateKeys(value, fieldMetadata, classOptions.excludeExtraneous === true);

    for (const propertyKey of candidateKeys) {
      const metadata = fieldMetadata.get(propertyKey);

      if (metadata?.excluded) {
        continue;
      }

      const raw = value[propertyKey as keyof typeof value];

      if (raw === undefined && classOptions.excludeExtraneous === true && metadata?.exposed !== true) {
        continue;
      }

      const transformed = metadata ? applyTransforms(raw, metadata) : raw;
      serialized[propertyKey] = serializeInternal(transformed, context);
    }
  });
}

function serializeRecord(
  value: Record<string | symbol, unknown>,
  context: SerializationContext,
): Record<string | symbol, unknown> {
  const symbolKeys = Object.getOwnPropertySymbols(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key));
  const keys: Array<string | symbol> = [...Object.keys(value), ...symbolKeys];

  return serializeWithTrackedReference<Record<string | symbol, unknown>>(value, context, () => ({}), (serialized) => {
    for (const propertyKey of keys) {
      const propertyValue = value[propertyKey];
      serialized[propertyKey] = serializeInternal(propertyValue, context);
    }
  });
}

function serializeInternal<T = unknown>(value: T, context: SerializationContext): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return serializeWithTrackedReference<unknown[]>(value, context, () => [], (serialized) => {
      for (const item of value) {
        serialized.push(serializeInternal(item, context));
      }
    });
  }

  if (value instanceof Date) {
    return value;
  }

  if (isObjectLike(value)) {
    return serializeClassInstance(value, context);
  }

  return value;
}

/**
 * Serializes class instances and object graphs into JSON-safe plain values.
 *
 * Serialization honors `@Expose()`, `@Exclude()`, and `@Transform()` metadata.
 * Cycles and repeated references are handled without unbounded recursion.
 *
 * @typeParam T Input value type.
 * @param value Value or object graph to serialize.
 * @returns A plain JSON-safe structure ready for HTTP response writing.
 *
 * @example
 * ```ts
 * class UserEntity {
 *   id = '1';
 * }
 *
 * serialize(new UserEntity());
 * ```
 */
export function serialize<T = unknown>(value: T): unknown {
  const context: SerializationContext = {
    metadataCache: new WeakMap(),
    references: new WeakMap(),
  };

  return serializeInternal(value, context);
}
