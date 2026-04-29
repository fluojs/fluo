import { type MetadataPropertyKey } from '@fluojs/core';
import { getOwnStandardConstructorMetadataBag, metadataSymbol } from '@fluojs/core/internal';

type StandardMetadataBag = Record<PropertyKey, unknown>;

/**
 * Defines the transform function type.
 */
export type TransformFunction = (value: unknown) => unknown;

/**
 * Describes the class serialization options contract.
 */
export interface ClassSerializationOptions {
  excludeExtraneous?: boolean;
}

/**
 * Describes the serialization field metadata contract.
 */
export interface SerializationFieldMetadata {
  excluded?: boolean;
  exposed?: boolean;
  transforms?: TransformFunction[];
}

const standardSerializationClassMetadataKey = Symbol.for('fluo.standard.serialization.class');
const standardSerializationFieldMetadataKey = Symbol.for('fluo.standard.serialization.field');

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  if (metadata === null || metadata === undefined) {
    throw new Error('Decorator metadata is not available. Ensure your environment supports TC39 decorator metadata (Stage 3).');
  }

  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function getFieldMetadataMap(metadata: unknown): Map<MetadataPropertyKey, SerializationFieldMetadata> {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardSerializationFieldMetadataKey] as Map<MetadataPropertyKey, SerializationFieldMetadata> | undefined;

  if (current) {
    return current;
  }

  const created = new Map<MetadataPropertyKey, SerializationFieldMetadata>();
  bag[standardSerializationFieldMetadataKey] = created;
  return created;
}

function getClassMetadataObject(metadata: unknown): ClassSerializationOptions {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardSerializationClassMetadataKey] as ClassSerializationOptions | undefined;

  if (current) {
    return current;
  }

  const created: ClassSerializationOptions = {};
  bag[standardSerializationClassMetadataKey] = created;
  return created;
}

function getOwnMetadataBagFromConstructor(constructor: Function): StandardMetadataBag | undefined {
  return getOwnStandardConstructorMetadataBag(constructor);
}

function getConstructorMetadataBags(constructor: Function): StandardMetadataBag[] {
  const bags: StandardMetadataBag[] = [];
  let current: Function | null = constructor;

  while (current && current !== Function.prototype) {
    const bag = getOwnMetadataBagFromConstructor(current);

    if (bag) {
      bags.unshift(bag);
    }

    current = Object.getPrototypeOf(current) as Function | null;
  }

  return bags;
}

/**
 * Update class serialization options.
 *
 * @param metadata The metadata.
 * @param partial The partial.
 */
export function updateClassSerializationOptions(metadata: unknown, partial: ClassSerializationOptions): void {
  Object.assign(getClassMetadataObject(metadata), partial);
}

/**
 * Update field serialization metadata.
 *
 * @param metadata The metadata.
 * @param propertyKey The property key.
 * @param update The update.
 */
export function updateFieldSerializationMetadata(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  update: (current: SerializationFieldMetadata | undefined) => SerializationFieldMetadata,
): void {
  const map = getFieldMetadataMap(metadata);
  map.set(propertyKey, update(map.get(propertyKey)));
}

/**
 * Get class serialization options.
 *
 * @param constructor The constructor.
 * @returns The get class serialization options result.
 */
export function getClassSerializationOptions(constructor: Function): ClassSerializationOptions {
  return getConstructorMetadataBags(constructor).reduce<ClassSerializationOptions>((options, bag) => ({
    ...options,
    ...(bag[standardSerializationClassMetadataKey] as ClassSerializationOptions | undefined),
  }), {});
}

/**
 * Get field serialization metadata.
 *
 * @param constructor The constructor.
 * @returns The get field serialization metadata result.
 */
export function getFieldSerializationMetadata(constructor: Function): Map<MetadataPropertyKey, SerializationFieldMetadata> {
  const merged = new Map<MetadataPropertyKey, SerializationFieldMetadata>();

  for (const bag of getConstructorMetadataBags(constructor)) {
    const fieldMetadata = bag[standardSerializationFieldMetadataKey] as
      | Map<MetadataPropertyKey, SerializationFieldMetadata>
      | undefined;

    if (!fieldMetadata) {
      continue;
    }

    for (const [propertyKey, metadata] of fieldMetadata.entries()) {
      const current = merged.get(propertyKey);
      merged.set(propertyKey, {
        ...current,
        ...metadata,
        transforms: [...(current?.transforms ?? []), ...(metadata.transforms ?? [])],
      });
    }
  }

  return merged;
}
