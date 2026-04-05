import { type MetadataPropertyKey } from '@konekti/core';
import { metadataSymbol } from '@konekti/core/internal';

type StandardMetadataBag = Record<PropertyKey, unknown>;

export type TransformFunction = (value: unknown) => unknown;

export interface ClassSerializationOptions {
  excludeExtraneous?: boolean;
}

export interface SerializationFieldMetadata {
  excluded?: boolean;
  exposed?: boolean;
  transforms?: TransformFunction[];
}

const standardSerializationClassMetadataKey = Symbol.for('konekti.standard.serialization.class');
const standardSerializationFieldMetadataKey = Symbol.for('konekti.standard.serialization.field');

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

function getMetadataBagFromConstructor(constructor: Function): StandardMetadataBag | undefined {
  return (constructor as unknown as Record<PropertyKey, unknown>)[metadataSymbol] as StandardMetadataBag | undefined;
}

export function updateClassSerializationOptions(metadata: unknown, partial: ClassSerializationOptions): void {
  Object.assign(getClassMetadataObject(metadata), partial);
}

export function updateFieldSerializationMetadata(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  update: (current: SerializationFieldMetadata | undefined) => SerializationFieldMetadata,
): void {
  const map = getFieldMetadataMap(metadata);
  map.set(propertyKey, update(map.get(propertyKey)));
}

export function getClassSerializationOptions(constructor: Function): ClassSerializationOptions {
  const bag = getMetadataBagFromConstructor(constructor);
  return {
    ...(bag?.[standardSerializationClassMetadataKey] as ClassSerializationOptions | undefined),
  };
}

export function getFieldSerializationMetadata(constructor: Function): Map<MetadataPropertyKey, SerializationFieldMetadata> {
  const bag = getMetadataBagFromConstructor(constructor);
  const fieldMetadata = bag?.[standardSerializationFieldMetadataKey] as
    | Map<MetadataPropertyKey, SerializationFieldMetadata>
    | undefined;

  if (!fieldMetadata) {
    return new Map<MetadataPropertyKey, SerializationFieldMetadata>();
  }

  return new Map(
    [...fieldMetadata.entries()].map(([propertyKey, metadata]) => [
      propertyKey,
      {
        ...metadata,
        transforms: metadata.transforms ? [...metadata.transforms] : undefined,
      },
    ]),
  );
}
