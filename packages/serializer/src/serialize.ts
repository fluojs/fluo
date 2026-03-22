import { type MetadataPropertyKey } from '@konekti/core';

import { getClassSerializationOptions, getFieldSerializationMetadata, type SerializationFieldMetadata } from './metadata.js';

interface SerializationContext {
  metadataCache: WeakMap<Function, { classOptions: ReturnType<typeof getClassSerializationOptions>; fieldMetadata: ReturnType<typeof getFieldSerializationMetadata> }>;
  seen: WeakMap<object, unknown>;
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

function serializeClassInstance(
  value: Record<string | symbol, unknown>,
  context: SerializationContext,
): Record<string | symbol, unknown> {
  if (context.seen.has(value)) {
    return undefined as unknown as Record<string | symbol, unknown>;
  }

  const constructor = value.constructor as Function;
  const { classOptions, fieldMetadata } = getCachedMetadata(constructor, context);
  const hasMetadata = fieldMetadata.size > 0 || classOptions.excludeExtraneous === true;

  if (!hasMetadata) {
    if (isPlainObject(value)) {
      return serializeRecord(value, context);
    }

    return value;
  }

  const serialized: Record<string | symbol, unknown> = {};
  context.seen.set(value, serialized);
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

  return serialized;
}

function serializeRecord(
  value: Record<string | symbol, unknown>,
  context: SerializationContext,
): Record<string | symbol, unknown> {
  if (context.seen.has(value)) {
    return undefined as unknown as Record<string | symbol, unknown>;
  }

  const serialized: Record<string | symbol, unknown> = {};
  context.seen.set(value, serialized);

  for (const [propertyKey, propertyValue] of Object.entries(value)) {
    serialized[propertyKey] = serializeInternal(propertyValue, context);
  }

  return serialized;
}

function serializeInternal<T = unknown>(value: T, context: SerializationContext): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    if (context.seen.has(value)) {
      return undefined;
    }

    const serialized: unknown[] = [];
    context.seen.set(value, serialized);

    for (const item of value) {
      serialized.push(serializeInternal(item, context));
    }

    return serialized;
  }

  if (value instanceof Date) {
    return value;
  }

  if (isObjectLike(value)) {
    return serializeClassInstance(value, context);
  }

  return value;
}

export function serialize<T = unknown>(value: T): unknown {
  const context: SerializationContext = {
    metadataCache: new WeakMap(),
    seen: new WeakMap(),
  };

  return serializeInternal(value, context);
}
