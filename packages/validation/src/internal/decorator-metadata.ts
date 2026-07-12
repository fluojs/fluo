import type { MetadataPropertyKey } from '@fluojs/core';
import type { ClassValidationRule, DtoFieldValidationRule } from '@fluojs/core/request-pipeline';

export type ClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
export type FieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;

type StandardMetadataBag = Record<PropertyKey, unknown>;

const standardDtoValidationMetadataKey = Symbol.for('fluo.standard.dto-validation');
const standardClassValidationMetadataKey = Symbol.for('fluo.standard.class-validation');

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  if (metadata === null || metadata === undefined) {
    throw new Error('Decorator metadata is not available. Ensure your environment supports TC39 decorator metadata (Stage 3).');
  }

  return metadata as StandardMetadataBag;
}

function getStandardDtoValidationMap(metadata: unknown): Map<MetadataPropertyKey, DtoFieldValidationRule[]> {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardDtoValidationMetadataKey] as Map<MetadataPropertyKey, DtoFieldValidationRule[]> | undefined;

  if (current && Object.hasOwn(bag, standardDtoValidationMetadataKey)) {
    return current;
  }

  const created = new Map<MetadataPropertyKey, DtoFieldValidationRule[]>();

  for (const [propertyKey, rules] of current ?? []) {
    created.set(propertyKey, [...rules]);
  }

  bag[standardDtoValidationMetadataKey] = created;
  return created;
}

function getStandardClassValidationList(metadata: unknown): ClassValidationRule[] {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[standardClassValidationMetadataKey] as ClassValidationRule[] | undefined;

  if (current && Object.hasOwn(bag, standardClassValidationMetadataKey)) {
    return current;
  }

  const created: ClassValidationRule[] = [...(current ?? [])];
  bag[standardClassValidationMetadataKey] = created;
  return created;
}

export function appendStandardDtoValidationRule(
  metadata: unknown,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  const map = getStandardDtoValidationMap(metadata);
  map.set(propertyKey, [...(map.get(propertyKey) ?? []), rule]);
}

export function appendStandardClassValidationRule(metadata: unknown, rule: ClassValidationRule): void {
  getStandardClassValidationList(metadata).push(rule);
}
