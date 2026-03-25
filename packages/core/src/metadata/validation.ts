import {
  appendPropertyMapValue,
  getOrCreatePropertyMap,
  getStandardConstructorMetadataMap,
  getStandardMetadataBag,
  mergeMetadataPropertyKeys,
  standardMetadataKeys,
} from './shared.js';
import { createClonedWeakMapStore } from './store.js';
import type {
  ClassValidationRule,
  DtoBindingSchemaEntry,
  DtoFieldBindingMetadata,
  DtoFieldValidationRule,
  DtoValidationSchemaEntry,
  StandardDtoBindingRecord,
  StandardDtoValidationRecord,
} from './types.js';
import type { Constructor, MetadataPropertyKey } from '../types.js';

const dtoFieldBindingStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldBindingMetadata>>();
const dtoFieldValidationStore = new WeakMap<object, Map<MetadataPropertyKey, DtoFieldValidationRule[]>>();
const classValidationStore = createClonedWeakMapStore<Function, ClassValidationRule[]>((rules) => [...rules]);

function getStandardDtoBindingMap(target: object): Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardDtoBindingRecord>(target, standardMetadataKeys.dtoFieldBinding);
}

function getStandardDtoValidationMap(target: object): Map<MetadataPropertyKey, StandardDtoValidationRecord> | undefined {
  return getStandardConstructorMetadataMap<StandardDtoValidationRecord>(target, standardMetadataKeys.dtoFieldValidation);
}

function getStandardClassValidationRules(target: Function): ClassValidationRule[] | undefined {
  const rules = getStandardMetadataBag(target)?.[standardMetadataKeys.classValidation] as ClassValidationRule[] | undefined;

  return rules ? [...rules] : undefined;
}

export function getDtoFieldBindingMetadata(target: object, propertyKey: MetadataPropertyKey): DtoFieldBindingMetadata | undefined {
  const stored = dtoFieldBindingStore.get(target)?.get(propertyKey);
  const standard = getStandardDtoBindingMap(target)?.get(propertyKey);
  const source = stored?.source ?? standard?.source;

  if (!source) {
    return undefined;
  }

  return {
    key: stored?.key ?? standard?.key,
    optional: stored?.optional ?? standard?.optional,
    source,
  };
}

export function defineDtoFieldBindingMetadata(
  target: object,
  propertyKey: MetadataPropertyKey,
  metadata: DtoFieldBindingMetadata,
): void {
  getOrCreatePropertyMap(dtoFieldBindingStore, target).set(propertyKey, { ...metadata });
}

export function appendDtoFieldValidationRule(
  target: object,
  propertyKey: MetadataPropertyKey,
  rule: DtoFieldValidationRule,
): void {
  appendPropertyMapValue(dtoFieldValidationStore, target, propertyKey, rule);
}

export function appendClassValidationRule(target: Function, rule: ClassValidationRule): void {
  const rules = classValidationStore.read(target) ?? [];
  rules.push(rule);
  classValidationStore.write(target, rules);
}

export function getDtoBindingSchema(dto: Constructor): DtoBindingSchemaEntry[] {
  const stored = dtoFieldBindingStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldBindingMetadata>();
  const standard =
    (getStandardMetadataBag(dto)?.[standardMetadataKeys.dtoFieldBinding] as Map<MetadataPropertyKey, StandardDtoBindingRecord> | undefined) ??
    new Map<MetadataPropertyKey, StandardDtoBindingRecord>();
  const keys = mergeMetadataPropertyKeys(stored, standard);

  return keys
    .map((propertyKey) => ({
      propertyKey,
      metadata: getDtoFieldBindingMetadata(dto.prototype, propertyKey),
    }))
    .filter((entry): entry is DtoBindingSchemaEntry => entry.metadata !== undefined);
}

export function getDtoFieldValidationRules(target: object, propertyKey: MetadataPropertyKey): readonly DtoFieldValidationRule[] {
  const stored = dtoFieldValidationStore.get(target)?.get(propertyKey) ?? [];
  const standard = getStandardDtoValidationMap(target)?.get(propertyKey) ?? [];

  return [...standard, ...stored];
}

export function getDtoValidationSchema(dto: Constructor): DtoValidationSchemaEntry[] {
  const stored = dtoFieldValidationStore.get(dto.prototype) ?? new Map<MetadataPropertyKey, DtoFieldValidationRule[]>();
  const standard = getStandardDtoValidationMap(dto.prototype) ?? new Map<MetadataPropertyKey, StandardDtoValidationRecord>();
  const keys = mergeMetadataPropertyKeys(stored, standard);

  return keys
    .map((propertyKey) => ({
      propertyKey,
      rules: getDtoFieldValidationRules(dto.prototype, propertyKey),
    }))
    .filter((entry) => entry.rules.length > 0);
}

export function getClassValidationRules(target: Function): readonly ClassValidationRule[] {
  return [...(getStandardClassValidationRules(target) ?? []), ...(classValidationStore.read(target) ?? [])];
}
